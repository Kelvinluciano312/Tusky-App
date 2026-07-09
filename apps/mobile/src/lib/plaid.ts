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
