import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createPlaidLinkSession } from 'react-native-plaid-link-sdk';

import { supabase } from '@/lib/supabase';

/**
 * Runs the full connect-a-bank flow:
 * link token (edge fn) → native Plaid Link → exchange token (edge fn).
 * Returns status the UI can render; invalidates account queries on success.
 */
export function useConnectBank() {
  const queryClient = useQueryClient();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectBank = async () => {
    setError(null);
    setIsConnecting(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('plaid-create-link-token');
      if (fnError || !data?.link_token) {
        throw new Error('Could not start the bank connection. Try again in a moment.');
      }

      const session = await createPlaidLinkSession({
        token: data.link_token,
        onEvent: () => {}, // required by the SDK; per-step analytics can hook in later
        onSuccess: async (success) => {
          try {
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
            await queryClient.invalidateQueries({ queryKey: ['accounts'] });
            // Populate the new bank's transactions without waiting for a manual pull.
            await supabase.functions.invoke('plaid-sync-transactions');
            await queryClient.invalidateQueries({ queryKey: ['transactions'] });
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
 * Runs a transaction sync for every connected bank. Invalidates accounts too,
 * because a sync refreshes balances as well as transactions.
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not refresh transactions.');
    } finally {
      setIsSyncing(false);
    }
  };

  return { sync, isSyncing, error };
}
