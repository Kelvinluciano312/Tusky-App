import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  dollarsToMinCents,
  type AlertDraft,
  type TransactionAlert,
} from '@/lib/transaction-alerts';
import { supabase } from '@/lib/supabase';

const COLUMNS =
  'id, user_id, merchant_entity_id, merchant_key, category_id, min_cents, enabled, merchant_label, category_label, created_at, updated_at';

export function useTransactionAlerts(userId: string | undefined) {
  return useQuery({
    queryKey: ['transaction-alerts', userId],
    enabled: !!userId,
    queryFn: async (): Promise<TransactionAlert[]> => {
      const { data, error } = await supabase
        .from('transaction_alerts')
        .select(COLUMNS)
        .eq('user_id', userId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as TransactionAlert[];
    },
  });
}

export function useUpsertTransactionAlert(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id?: string; draft: AlertDraft }) => {
      if (!userId) throw new Error('Not signed in');
      const minCents = dollarsToMinCents(input.draft.minDollars);
      const useMerchant = !!(input.draft.merchantEntityId || input.draft.merchantKey);
      const useCategory = !!input.draft.categoryId;
      if (!useMerchant && !useCategory && minCents == null) {
        throw new Error('Pick a merchant, a category, or a minimum amount.');
      }
      const row = {
        user_id: userId,
        merchant_entity_id: useMerchant ? input.draft.merchantEntityId : null,
        merchant_key: useMerchant ? input.draft.merchantKey : null,
        merchant_label: useMerchant ? input.draft.merchantLabel : null,
        category_id: useCategory ? input.draft.categoryId : null,
        category_label: useCategory ? input.draft.categoryLabel : null,
        min_cents: minCents,
        enabled: input.draft.enabled,
      };
      if (input.id) {
        const { data, error } = await supabase
          .from('transaction_alerts')
          .update(row)
          .eq('id', input.id)
          .eq('user_id', userId)
          .select(COLUMNS)
          .single();
        if (error) throw error;
        return data as TransactionAlert;
      }
      const { data, error } = await supabase.from('transaction_alerts').insert(row).select(COLUMNS).single();
      if (error) throw error;
      return data as TransactionAlert;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['transaction-alerts', userId] });
    },
  });
}

export function useSetTransactionAlertEnabled(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; enabled: boolean }) => {
      if (!userId) throw new Error('Not signed in');
      const { error } = await supabase
        .from('transaction_alerts')
        .update({ enabled: input.enabled })
        .eq('id', input.id)
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['transaction-alerts', userId] });
    },
  });
}

export function useDeleteTransactionAlert(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!userId) throw new Error('Not signed in');
      const { error } = await supabase.from('transaction_alerts').delete().eq('id', id).eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['transaction-alerts', userId] });
    },
  });
}
