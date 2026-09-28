import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createPlaidLinkSession } from 'react-native-plaid-link-sdk';

import { readFunctionError } from '@/lib/functions';
import { HIDDEN_DEPENDENT_KEYS } from '@/lib/queries';
import { supabase } from '@/lib/supabase';

/** Everything a bank's arrival, departure or sync can change on screen. */
const BANK_DEPENDENT_KEYS = [['plaid_items'], ...HIDDEN_DEPENDENT_KEYS];

function invalidateBankData(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all(BANK_DEPENDENT_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

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
                  // Name and mask only: the server's duplicate check compares them.
                  accounts: success.metadata.accounts.map(({ name, mask }) => ({ name, mask })),
                },
              });
              if (exchangeError) {
                const { status, message } = await readFunctionError(exchangeError);
                if (status === 409 && message === 'duplicate') {
                  throw new Error(
                    `${institution?.name ?? 'This bank'} is already connected in your herd. If it stopped syncing, whoever connected it can use Reconnect in Settings.`,
                  );
                }
                throw new Error('The bank responded, but saving the connection failed.');
              }
            }
            // Update mode skips the exchange entirely — the access_token did not
            // change, so the sync below is all that is needed to restore the Item.
            await supabase.functions.invoke('plaid-sync-transactions');
            // Detection runs at the end of every sync, so recurring is among these.
            await invalidateBankData(queryClient);
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
        const { message } = await readFunctionError(fnError);
        throw new Error(`Sync failed: ${message ?? fnError.message}`);
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
      // plaid_items is among these: a sync can flip an Item to login_required
      // (or back to active), and without it the Reconnect prompt never appears.
      // Detection runs at the end of every sync, so recurring is too.
      await invalidateBankData(queryClient);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not refresh transactions.');
    } finally {
      setIsSyncing(false);
    }
  };

  return { sync, isSyncing, error };
}

/**
 * Disconnect a bank. 'archive' keeps its history; 'delete' removes it. Either
 * way the Item is removed at Plaid first, which is what stops its billing.
 * Resolves true on success, so the screen can leave.
 */
export function useDisconnectBank() {
  const queryClient = useQueryClient();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disconnect = async (itemId: string, mode: 'archive' | 'delete'): Promise<boolean> => {
    setError(null);
    setIsDisconnecting(true);
    try {
      const { error: fnError } = await supabase.functions.invoke('plaid-disconnect-item', {
        body: { item_id: itemId, mode },
      });
      if (fnError) {
        // The function's own wording: busy, Plaid failed, or unknown bank.
        const { message } = await readFunctionError(fnError);
        setError(message ?? 'Could not disconnect the bank. Try again in a moment.');
        return false;
      }
      await invalidateBankData(queryClient);
      return true;
    } catch {
      setError('Could not disconnect the bank. Try again in a moment.');
      return false;
    } finally {
      setIsDisconnecting(false);
    }
  };

  return { disconnect, isDisconnecting, error };
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
