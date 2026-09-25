import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { readFunctionError } from '@/lib/functions';
import type { MerchantRule, MerchantRules } from '@/lib/merchants';
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
  /** Built-ins only; a custom category has none. */
  slug: string | null;
  /** The user's name for it: their rename of a built-in, or their own category's. */
  name: string;
  kind: 'income' | 'expense' | 'transfer';
  icon: string;
  /** The user's colour for it, as with name. */
  color: string;
  sort_order: number;
  /** null for a group; a child's group otherwise. */
  parent_id: string | null;
  /** Hidden by this user: out of the picker and Budgets' suggestions; its transactions and budget stay. */
  hidden: boolean;
  /** The user's own category, always a child of a built-in group. */
  is_custom: boolean;
  /** A built-in this user renamed, recoloured or hid. Reset deletes the override. */
  overridden: boolean;
};

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    staleTime: 1000 * 60 * 60, // the taxonomy only changes with a migration
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from('user_categories')
        .select('id, slug, name, kind, icon, color, sort_order, parent_id, hidden, is_custom, overridden')
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
  /** normalizeMerchant(merchant_name ?? name), generated in SQL; '' for a name with no letters. Merchant rules key on it. */
  merchant_key: string | null;
  logo_url: string | null;
  /** Positive = money in, negative = money out (inverted from Plaid on ingest). */
  amount: number;
  iso_currency_code: string;
  date: string;
  pending: boolean;
  category_id: string | null;
  category_is_manual: boolean;
  /** The user's memo (Phase 8); null when none. */
  notes: string | null;
};

const PAGE_SIZE = 50;
type PageCursor = { date: string; id: string } | null;

const TRANSACTION_COLUMNS =
  'id, account_id, name, merchant_name, merchant_key, logo_url, amount, iso_currency_code, date, pending, category_id, category_is_manual, notes';

/**
 * Keyset pagination on (date, id), NOT offset. Sync inserts rows while the user
 * scrolls; with OFFSET every insertion shifts later pages, duplicating and
 * skipping rows. The (herd_id, date desc, id desc) index serves this directly.
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
 * `herd_id` is deliberately absent from the payload. PostgREST builds the insert
 * column list from the payload's keys, so an omitted column takes its default
 * (`private.my_herd_id()`) rather than null, and Postgres resolves defaults before
 * ON CONFLICT arbitration. That keeps the repo's rule that no client query ever
 * names an owner, with the RLS with-check doing the actual enforcing.
 */
export function useSetBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ categoryId, amount }: { categoryId: string; amount: number }) => {
      const { error } = await supabase
        .from('budgets')
        .upsert({ category_id: categoryId, amount }, { onConflict: 'herd_id,category_id' });
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
  /** The same key as transactions.merchant_key, so a merchant's rename shows here too. */
  merchant_key: string;
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
  'id, account_id, name, merchant_key, category_id, direction, frequency, average_amount, last_amount, previous_amount, amount_change, last_date, next_date, dismissed';

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

/** What a category edit changes on screen. Names resolve on the client, so these three are enough. */
const CATEGORY_EDIT_KEYS = [['categories'], ['reports'], ['budgets']];

export type CategoryPatch = { name?: string | null; color?: string | null; hidden?: boolean };

/**
 * Rename, recolour or hide a built-in for this user; a null patch resets it
 * (deletes the override). The upsert names only the patched columns, so the
 * others keep their stored values. Optimistic on `hidden`, so the switch
 * never lags.
 */
export function useCategoryOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ categoryId, patch }: { categoryId: string; patch: CategoryPatch | null }) => {
      const { error } =
        patch === null
          ? await supabase.from('category_overrides').delete().eq('category_id', categoryId)
          : await supabase
              .from('category_overrides')
              .upsert({ category_id: categoryId, ...patch }, { onConflict: 'herd_id,category_id' });
      if (error) throw error;
    },
    onMutate: async ({ categoryId, patch }) => {
      const hidden = patch?.hidden;
      if (hidden === undefined) return {};
      await queryClient.cancelQueries({ queryKey: ['categories'] });
      const previous = queryClient.getQueryData<Category[]>(['categories']);
      queryClient.setQueryData<Category[]>(['categories'], (old) =>
        old?.map((c) => (c.id === categoryId ? { ...c, hidden } : c)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['categories'], context.previous);
    },
    onSettled: () => {
      for (const queryKey of CATEGORY_EDIT_KEYS) queryClient.invalidateQueries({ queryKey });
    },
  });
}

/**
 * Add a custom category under a group. The payload names exactly the granted
 * columns; herd_id, kind and sort_order come from defaults and the tree trigger.
 */
export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ parentId, name, icon, color }: { parentId: string; name: string; icon: string; color: string }) => {
      const { error } = await supabase.from('categories').insert({ parent_id: parentId, name, icon, color });
      if (error) throw error;
    },
    onSettled: () => {
      for (const queryKey of CATEGORY_EDIT_KEYS) queryClient.invalidateQueries({ queryKey });
    },
  });
}

/** Edit one of the user's own categories. RLS refuses a built-in. */
export function useUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, name, icon, color }: { id: string; name: string; icon: string; color: string }) => {
      const { error } = await supabase.from('categories').update({ name, icon, color }).eq('id', id);
      if (error) throw error;
    },
    onSettled: () => {
      for (const queryKey of CATEGORY_EDIT_KEYS) queryClient.invalidateQueries({ queryKey });
    },
  });
}

/**
 * Delete one of the user's own categories through delete-category, which
 * moves its transactions and streams to the group first. Everything that
 * shows a category id can change.
 */
export function useDeleteCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (categoryId: string): Promise<{ moved: number }> => {
      const { data, error } = await supabase.functions.invoke('delete-category', {
        body: { category_id: categoryId },
      });
      if (error) {
        const { message } = await readFunctionError(error);
        throw new Error(message ?? 'Could not delete the category. Try again in a moment.');
      }
      return { moved: (data as { moved?: number } | null)?.moved ?? 0 };
    },
    onSettled: () => {
      for (const queryKey of [...CATEGORY_EDIT_KEYS, ...HIDDEN_DEPENDENT_KEYS]) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

/** How many of the user's transactions sit in one category, for the delete confirmation. */
export async function countCategoryTransactions(categoryId: string): Promise<number> {
  const { count, error } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId);
  if (error) throw error;
  return count ?? 0;
}

/** The user's merchant rules, by merchant_key: renames and "always categorize as". Read-only; writes go through set-merchant-rule. */
export function useMerchantRules() {
  return useQuery({
    queryKey: ['merchant_rules'],
    queryFn: async (): Promise<MerchantRules> => {
      const { data, error } = await supabase.from('merchant_rules').select('merchant_key, category_id, display_name');
      if (error) throw error;
      return new Map((data as MerchantRule[]).map((r) => [r.merchant_key, r]));
    },
  });
}

/** What a rule write can change: names everywhere, and categories on the merchant's past rows. */
const RULE_DEPENDENT_KEYS = [['merchant_rules'], ['transactions'], ['reports'], ['recurring']];

/**
 * Set or clear one merchant's rule. An omitted field keeps its stored value,
 * null clears it; the function deletes the rule once both are null, and
 * re-resolves the merchant's non-manual rows when the category part changes.
 */
export function useSetMerchantRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      merchantKey: string;
      categoryId?: string | null;
      displayName?: string | null;
    }): Promise<{ updated: number }> => {
      const { data, error } = await supabase.functions.invoke('set-merchant-rule', {
        body: { merchant_key: input.merchantKey, category_id: input.categoryId, display_name: input.displayName },
      });
      if (error) {
        const { message } = await readFunctionError(error);
        throw new Error(message ?? 'Could not save the rule. Try again in a moment.');
      }
      return { updated: (data as { updated?: number } | null)?.updated ?? 0 };
    },
    onSettled: () => {
      for (const queryKey of RULE_DEPENDENT_KEYS) queryClient.invalidateQueries({ queryKey });
    },
  });
}

export type TransactionDetail = Transaction & { accounts: { name: string; mask: string | null } | null };

/** One transaction, with its account, for the detail screen. Under ['transactions'], so every feed invalidation refreshes it. */
export function useTransaction(id: string) {
  return useQuery({
    queryKey: ['transactions', 'detail', id],
    queryFn: async (): Promise<TransactionDetail> => {
      const { data, error } = await supabase
        .from('transactions')
        .select(`${TRANSACTION_COLUMNS}, accounts(name, mask)`)
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as unknown as TransactionDetail;
    },
  });
}

// The review queue (Phase 8): unreviewed, posted rows on shown accounts. Pending
// rows post under a new id, so they wait. Both queries below use this filter.

/** How many transactions wait for review. Under ['transactions'], so syncs and edits refresh it. */
export function useReviewCount() {
  return useQuery({
    queryKey: ['transactions', 'review-count'],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from('transactions')
        .select('id, accounts!inner(hidden)', { count: 'exact', head: true })
        .is('reviewed_at', null)
        .eq('pending', false)
        .eq('accounts.hidden', false);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

const REVIEW_BATCH = 200;

/**
 * The queue's ids, oldest first, snapshotted once per visit. Deliberately NOT
 * under ['transactions']: marking a card reviewed invalidates that key, and a
 * live queue would drop the card being swiped. Cards read their row through
 * useTransaction, which does stay live.
 */
export function useReviewQueue() {
  return useQuery({
    queryKey: ['review-queue'],
    staleTime: Infinity,
    gcTime: 0,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, accounts!inner(hidden)')
        .is('reviewed_at', null)
        .eq('pending', false)
        .eq('accounts.hidden', false)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
        .limit(REVIEW_BATCH);
      if (error) throw error;
      return data.map((r) => r.id);
    },
  });
}

export function useMarkReviewed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (transactionId: string) => {
      const { error } = await supabase
        .from('transactions')
        .update({ reviewed_at: new Date().toISOString() })
        .eq('id', transactionId);
      if (error) throw error;
    },
    // Only the count shows review state; refetching the feed per swipe is waste.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['transactions', 'review-count'] }),
  });
}

export function useSetTransactionNotes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ transactionId, notes }: { transactionId: string; notes: string | null }) => {
      const { error } = await supabase.from('transactions').update({ notes }).eq('id', transactionId);
      if (error) throw error;
    },
    onMutate: async ({ transactionId, notes }) => {
      const queryKey = ['transactions', 'detail', transactionId];
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TransactionDetail>(queryKey);
      if (previous) queryClient.setQueryData<TransactionDetail>(queryKey, { ...previous, notes });
      return { previous };
    },
    onError: (_err, { transactionId }, context) => {
      if (context?.previous) queryClient.setQueryData(['transactions', 'detail', transactionId], context.previous);
    },
    onSettled: (_data, _err, { transactionId }) =>
      queryClient.invalidateQueries({ queryKey: ['transactions', 'detail', transactionId] }),
  });
}


export type Profile = { user_id: string; display_name: string };

/** The signed-in user's profile (Phase 9a). Created at signup by a trigger, so it always exists. */
export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['profile', userId],
    enabled: !!userId,
    queryFn: async (): Promise<Profile> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .eq('user_id', userId!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

export function useSetDisplayName() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, displayName }: { userId: string; displayName: string }) => {
      const { error } = await supabase.from('profiles').update({ display_name: displayName }).eq('user_id', userId);
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['profile'] }),
  });
}
