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

const ACCOUNT_COLUMNS =
  'id, item_id, name, official_name, mask, type, subtype, current_balance, available_balance, iso_currency_code, hidden';


/**
 * Home's accounts. A disconnected (archived) bank's accounts are excluded in
 * SQL rather than filtered here, so the hero never counts them while the
 * banks list is still loading. `!inner` drops the row instead of nulling the
 * embed, the same idiom as the feed's `accounts!inner(hidden)`.
 */
export function useAccounts() {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: async (): Promise<Account[]> => {
      // A bank's accounts arrive in one upsert and share a created_at. Ties come
      // back in physical order, and an UPDATE moves the row — so without the
      // tiebreakers, hiding an account made it jump to the top of the list.
      const { data, error } = await supabase
        .from('accounts')
        .select(`${ACCOUNT_COLUMNS}, plaid_items!inner(status)`)
        .neq('plaid_items.status', 'archived')
        .order('created_at', { ascending: true })
        .order('name', { ascending: true })
        .order('id', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Every account of one bank, hidden ones included — the bank screen is the one
 * place hidden accounts are listed, so they can be unhidden. Keyed under
 * ['accounts'] so every existing accounts invalidation covers it by prefix.
 */
export function useItemAccounts(itemId: string) {
  return useQuery({
    queryKey: ['accounts', itemId],
    queryFn: async (): Promise<Account[]> => {
      // Same tiebreakers as useAccounts, for the same reason.
      const { data, error } = await supabase
        .from('accounts')
        .select(ACCOUNT_COLUMNS)
        .eq('item_id', itemId)
        .order('created_at', { ascending: true })
        .order('name', { ascending: true })
        .order('id', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Every query whose rows `accounts.hidden` or a bank's presence filters in SQL.
 * Hiding an account, connecting or disconnecting a bank, and syncing must
 * refetch all of them, or one screen goes stale while the rest move.
 */
export const HIDDEN_DEPENDENT_KEYS = [['accounts'], ['transactions'], ['reports'], ['net_worth'], ['recurring']];

/**
 * Hide or unhide one account. Optimistic on the bank screen's list, because a
 * Switch that lags the finger reads as broken; rolled back if the write fails.
 */
export function useSetAccountHidden() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ accountId, hidden }: { accountId: string; itemId: string; hidden: boolean }) => {
      const { error } = await supabase.from('accounts').update({ hidden }).eq('id', accountId);
      if (error) throw error;
    },
    onMutate: async ({ accountId, itemId, hidden }) => {
      const key = ['accounts', itemId];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Account[]>(key);
      queryClient.setQueryData<Account[]>(key, (old) =>
        old?.map((a) => (a.id === accountId ? { ...a, hidden } : a)),
      );
      return { previous };
    },
    onError: (_err, { itemId }, context) => {
      if (context?.previous) queryClient.setQueryData(['accounts', itemId], context.previous);
    },
    onSettled: () => {
      for (const queryKey of HIDDEN_DEPENDENT_KEYS) queryClient.invalidateQueries({ queryKey });
    },
  });
}

export type ItemStatus = 'active' | 'login_required' | 'archived';

export type PlaidItem = {
  id: string;
  institution_id: string | null;
  institution_name: string | null;
  status: ItemStatus;
  created_at: string;
};

export function usePlaidItems() {
  return useQuery({
    queryKey: ['plaid_items'],
    queryFn: async (): Promise<PlaidItem[]> => {
      const { data, error } = await supabase
        .from('plaid_items')
        .select('id, institution_id, institution_name, status, created_at')
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
  /** null for a group; a child's group otherwise. */
  parent_id: string | null;
};

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    staleTime: 1000 * 60 * 60, // the taxonomy only changes with a migration
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, slug, name, kind, icon, color, sort_order, parent_id')
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
 *
 * Hidden accounts leave the feed as well as net worth, as in Monarch. `!inner`
 * makes the embedded filter drop the transaction rather than null the embed.
 */
export function useTransactions() {
  return useInfiniteQuery({
    queryKey: ['transactions'],
    initialPageParam: null as PageCursor,
    queryFn: async ({ pageParam }): Promise<Transaction[]> => {
      let query = supabase
        .from('transactions')
        .select(`${TRANSACTION_COLUMNS}, accounts!inner(hidden)`)
        .eq('accounts.hidden', false)
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
      // Budgets and reports read the same rows through a view; without this a
      // recategorized transaction moves the feed and leaves the budget bar stale.
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });
}

export type MonthlyTotal = {
  /** 'YYYY-MM-01' — the view truncates every date to the first of its month. */
  month: string;
  category_id: string | null;
  iso_currency_code: string;
  /** Ledger sign, so expenses are NEGATIVE. Read it through `spentFor`. */
  total: number;
  transaction_count: number;
};

/**
 * Monthly spend per category, from the `monthly_category_totals` view. Hidden
 * accounts are excluded in SQL, matching the feed and net worth.
 *
 * The key is the repo's first parameterized one. Its `'reports'` prefix is load
 * bearing: `invalidateQueries({ queryKey: ['reports'] })` then covers every range
 * any screen has cached, which is what keeps budgets in step with the feed.
 */
export function useMonthlyTotals(from: string, to: string) {
  return useQuery({
    queryKey: ['reports', from, to],
    queryFn: async (): Promise<MonthlyTotal[]> => {
      const { data, error } = await supabase
        .from('monthly_category_totals')
        .select('month, category_id, iso_currency_code, total, transaction_count')
        .gte('month', from)
        .lte('month', to);
      if (error) throw error;
      return data;
    },
  });
}

export type Budget = {
  id: string;
  category_id: string;
  /** Always positive: what you intend to spend, not a signed ledger entry. */
  amount: number;
};

export function useBudgets() {
  return useQuery({
    queryKey: ['budgets'],
    queryFn: async (): Promise<Budget[]> => {
      const { data, error } = await supabase
        .from('budgets')
        .select('id, category_id, amount')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Create or change the budget for a category — one amount per category, applied
 * to every month.
 *
 * `user_id` is deliberately absent from the payload. PostgREST builds the insert
 * column list from the payload's keys, so an omitted column takes its default
 * (`auth.uid()`) rather than null, and Postgres resolves defaults before ON
 * CONFLICT arbitration. That keeps the repo's rule that no client query ever
 * names a user id, with the RLS with-check doing the actual enforcing.
 */
export function useSetBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ categoryId, amount }: { categoryId: string; amount: number }) => {
      const { error } = await supabase
        .from('budgets')
        .upsert({ category_id: categoryId, amount }, { onConflict: 'user_id,category_id' });
      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
}

export function useDeleteBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (budgetId: string) => {
      const { error } = await supabase.from('budgets').delete().eq('id', budgetId);
      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['budgets'] });
    },
  });
}

export type NetWorthPoint = {
  /** 'YYYY-MM-DD'. */
  date: string;
  /** Already signed and filtered by the view: credit and loan count against you. */
  net_worth: number;
};

/**
 * Net worth per day, from the `daily_net_worth` view. Only days a sync ran have
 * a row — gaps are real, not interpolated.
 *
 * The order is not optional. The view has no ORDER BY, its group-by yields an
 * arbitrary aggregate order, and PostgREST adds no default; a polyline fed
 * unordered rows draws a scribble. The limit is not optional either: PostgREST's
 * max_rows truncates SILENTLY, and under ascending order it is the newest points
 * that vanish — a chart frozen weeks in the past with no error anywhere.
 */
export function useNetWorthHistory(from: string, to: string) {
  return useQuery({
    queryKey: ['net_worth', from, to],
    queryFn: async (): Promise<NetWorthPoint[]> => {
      const { data, error } = await supabase
        .from('daily_net_worth')
        .select('date, net_worth')
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true })
        .limit(400);
      if (error) throw error;
      return data;
    },
  });
}

export type RecurringStream = {
  id: string;
  account_id: string;
  name: string;
  category_id: string | null;
  direction: 'outflow' | 'inflow';
  frequency: 'weekly' | 'biweekly' | 'monthly';
  /** Ledger sign, like Transaction.amount: bills are negative. */
  average_amount: number;
  last_amount: number;
  previous_amount: number;
  /** |last| − |previous|, only when a fixed price moved; positive = costs (or pays) more. */
  amount_change: number | null;
  last_date: string;
  /** 'YYYY-MM-DD' — predicted; may be in the past if a charge is late. */
  next_date: string;
  dismissed: boolean;
};

const STREAM_COLUMNS =
  'id, account_id, name, category_id, direction, frequency, average_amount, last_amount, previous_amount, amount_change, last_date, next_date, dismissed';

/**
 * Recurring streams, written by detection at the end of each sync. Hidden
 * accounts drop out exactly as they do from the feed — `!inner` makes the
 * embedded filter drop the row rather than null the embed.
 */
export function useRecurringStreams() {
  return useQuery({
    queryKey: ['recurring'],
    queryFn: async (): Promise<RecurringStream[]> => {
      const { data, error } = await supabase
        .from('recurring_streams')
        .select(`${STREAM_COLUMNS}, accounts!inner(hidden)`)
        .eq('accounts.hidden', false)
        .order('next_date', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * "Not recurring" and its undo. The column grant makes `dismissed` the only
 * thing a client can write, and detection never touches it, so it sticks.
 */
export function useSetStreamDismissed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, dismissed }: { id: string; dismissed: boolean }) => {
      const { error } = await supabase.from('recurring_streams').update({ dismissed }).eq('id', id);
      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring'] });
    },
  });
}
