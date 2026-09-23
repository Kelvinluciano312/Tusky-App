import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createPlaidLinkSession } from 'react-native-plaid-link-sdk';

import { supabase } from '@/lib/supabase';

/**
 * Connect a bank, or repair one.
 *
 * New connection: link token → native Plaid Link → exchange token.
 * Update mode (itemId given): link token carries the existing access_token, and
 * there is NO exchange — Plaid leaves the Item's access_token unchanged. A
 * successful sync afterwards is what returns the Item to `active`.
 */
export function useConnectBank() {
  const queryClient = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectBank = async (itemId?: string) => {
    setError(null);
    setIsConnecting(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('plaid-create-link-token', {
        body: itemId ? { item_id: itemId } : {},
      });
      if (fnError || !data?.link_token) {
        throw new Error('Could not start the bank connection. Try again in a moment.');
      }

      const session = await createPlaidLinkSession({
        token: data.link_token,
        onEvent: () => {}, // required by the SDK; per-step analytics can hook in later
        onSuccess: async (success) => {
          try {
            if (!itemId) {
              const institution = success.metadata?.institution;
              const { error: exchangeError } = await supabase.functions.invoke('plaid-exchange-token', {
                body: {
                  public_token: success.publicToken,
                  institution_id: institution?.id,
                  institution_name: institution?.name,
                },
              });
              if (exchangeError) {
                throw new Error('The bank responded, but saving the connection failed.');
              }
            }
            // Update mode skips the exchange entirely — the access_token did not
            // change, so the sync below is all that is needed to restore the Item.
            await supabase.functions.invoke('plaid-sync-transactions');
            await queryClient.invalidateQueries({ queryKey: ['accounts'] });
            await queryClient.invalidateQueries({ queryKey: ['transactions'] });
            await queryClient.invalidateQueries({ queryKey: ['plaid_items'] });
            await queryClient.invalidateQueries({ queryKey: ['reports'] });
            await queryClient.invalidateQueries({ queryKey: ['net_worth'] });
            // Detection runs at the end of every sync.
            await queryClient.invalidateQueries({ queryKey: ['recurring'] });
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Something went wrong saving the connection.');
          } finally {
            setIsConnecting(false);
          }
        },
        onExit: (exit) => {
          if (exit.error?.errorMessage) {
            setError(exit.error.errorMessage);
          }
          setIsConnecting(false);
        },
      });

      await session.open();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the bank connection.');
      setIsConnecting(false);
    }
  };

  return { connectBank, isConnecting, error };
}

/**
 * Runs a transaction sync for every connected bank.
 *
 * A sync now refreshes account balances too, and records a net worth snapshot
 * for the day — hence the accounts and net_worth invalidations. What comes back
 * is Plaid's CACHED balance, refreshed on their cadence (roughly daily), so
 * syncing repeatedly will not move the number.
 */
export function useSyncTransactions() {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sync = async () => {
    setError(null);
    setIsSyncing(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('plaid-sync-transactions');
      if (fnError) {
        // FunctionsHttpError carries the response; its body says what actually failed.
        let detail = fnError.message;
        try {
          const body = await (fnError as { context?: Response }).context?.json();
          if (body?.error) detail = body.error;
        } catch {
          // non-JSON body; keep the transport message
        }
        throw new Error(`Sync failed: ${detail}`);
      }
      const failed = (data?.results ?? []).filter(
        (r: { status: string }) => r.status === 'error' || r.status === 'login_required',
      );
      if (failed.length > 0) {
        const loginRequired = failed.some((r: { status: string }) => r.status === 'login_required');
        const detail = (failed[0] as { message?: string }).message;
        setError(
          loginRequired
            ? 'A bank needs to be reconnected in Settings.'
            : `Sync failed: ${detail ?? 'unknown error'}`,
        );
      }
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      await queryClient.invalidateQueries({ queryKey: ['accounts'] });
      // A sync can flip an Item to login_required (or back to active), so
      // Settings must re-read it — otherwise the Reconnect prompt never appears.
      await queryClient.invalidateQueries({ queryKey: ['plaid_items'] });
      await queryClient.invalidateQueries({ queryKey: ['reports'] });
      await queryClient.invalidateQueries({ queryKey: ['net_worth'] });
      // Detection runs at the end of every sync.
      await queryClient.invalidateQueries({ queryKey: ['recurring'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not refresh transactions.');
    } finally {
      setIsSyncing(false);
    }
  };

  return { sync, isSyncing, error };
}

/**
 * DEV ONLY. Drives Plaid Sandbox so the webhook paths can be tested on demand.
 * The Edge Function refuses outside Sandbox, and callers should gate the UI on
 * __DEV__.
 *
 * Neither action syncs afterwards: the webhook is what should react, and a sync
 * from here would hide whether it did. Its effect shows up when the app next
 * refetches — background and reopen it.
 */
export function useSandboxTools() {
  const [isBusy, setIsBusy] = useState(false);

  const run = async (itemId: string, action: 'reset_login' | 'fire_webhook') => {
    setIsBusy(true);
    try {
      await supabase.functions.invoke('plaid-sandbox', { body: { item_id: itemId, action } });
    } finally {
      setIsBusy(false);
    }
  };

  return {
    /** Forces ITEM_LOGIN_REQUIRED; Plaid then fires an ITEM ERROR webhook. */
    resetLogin: (itemId: string) => run(itemId, 'reset_login'),
    /** Asks Plaid to fire SYNC_UPDATES_AVAILABLE at plaid-webhook. */
    fireWebhook: (itemId: string) => run(itemId, 'fire_webhook'),
    isBusy,
  };
}
