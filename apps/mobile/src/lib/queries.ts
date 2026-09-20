import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

export type Account = {
  id: string;
  item_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  current_balance: number | null;
  available_balance: number | null;
  iso_currency_code: string;
  hidden: boolean;
};

export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase
        .from('accounts')
        .select(
          'id, item_id, name, official_name, mask, type, subtype, current_balance, available_balance, iso_currency_code, hidden',
        )
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export type PlaidItem = {
  id: string;
  institution_id: string | null;
  institution_name: string | null;
  status: string;
};

export function usePlaidItems() {
  return useQuery({
    queryKey: ['plaid_items'],
    queryFn: async (): Promise<PlaidItem[]> => {
      const { data, error } = await supabase
        .from('plaid_items')
        .select('id, institution_id, institution_name, status')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export type Category = {
  id: string;
  slug: string;
  name: string;
  kind: 'income' | 'expense' | 'transfer';
  icon: string;
  color: string;
  sort_order: number;
};

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    staleTime: 1000 * 60 * 60, // the taxonomy only changes with a migration
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name, kind, icon, color, sort_order')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

export type Transaction = {
  id: string;
  account_id: string;
  name: string;
  merchant_name: string | null;
  logo_url: string | null;
  /** Positive = money in, negative = money out (inverted from Plaid on ingest). */
  amount: number;
  iso_currency_code: string;
  date: string;
  pending: boolean;
  category_id: string | null;
  category_is_manual: boolean;
};

const PAGE_SIZE = 50;
type PageCursor = { date: string; id: string } | null;

const TRANSACTION_COLUMNS =
  'id, account_id, name, merchant_name, logo_url, amount, iso_currency_code, date, pending, category_id, category_is_manual';

/**
 * Keyset pagination on (date, id), NOT offset. Sync inserts rows while the user
 * scrolls; with OFFSET every insertion shifts later pages, duplicating and
 * skipping rows. The (user_id, date desc, id desc) index serves this directly.
 */
export function useTransactions() {
  return useInfiniteQuery({
    queryKey: ['transactions'],
    initialPageParam: null as PageCursor,
    queryFn: async ({ pageParam }): Promise<Transaction[]> => {
      let query = supabase
        .from('transactions')
        .select(TRANSACTION_COLUMNS)
        .order('date', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);

      if (pageParam) {
        query = query.or(
          `date.lt.${pageParam.date},and(date.eq.${pageParam.date},id.lt.${pageParam.id})`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    getNextPageParam: (lastPage): PageCursor => {
      if (lastPage.length < PAGE_SIZE) return null;
      const last = lastPage[lastPage.length - 1];
      return { date: last.date, id: last.id };
    },
  });
}

type TransactionPages = { pages: Transaction[][]; pageParams: unknown[] };

/**
 * Recategorize. A direct PostgREST write — no Plaid secret is involved, and the
 * column-level grant means only these two columns are writable by the client.
 */
export function useSetTransactionCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ transactionId, categoryId }: { transactionId: string; categoryId: string }) => {
      const { error } = await supabase
        .from('transactions')
        .update({ category_id: categoryId, category_is_manual: true })
        .eq('id', transactionId);
      if (error) throw error;
    },
    onMutate: async ({ transactionId, categoryId }) => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] });
      const previous = queryClient.getQueryData<TransactionPages>(['transactions']);
      queryClient.setQueryData<TransactionPages>(['transactions'], (old) =>
        !old ? old : {
          ...old,
          pages: old.pages.map((page) =>
            page.map((t) =>
              t.id === transactionId ? { ...t, category_id: categoryId, category_is_manual: true } : t,
            ),
          ),
        },
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['transactions'], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });
}
