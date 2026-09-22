# Phase 2 Transaction Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull transactions from Plaid into Supabase on a cursor, categorize them against a curated taxonomy, and show them in a date-grouped feed where the user can correct a category.

**Architecture:** One Edge Function (`plaid-sync-transactions`) owns all Plaid access, because `plaid_tokens` is service-role-only. It claims each item via a conditional update, runs `/transactions/sync` to exhaustion, applies the batch idempotently, then commits the cursor last. The app reads `transactions` directly over PostgREST with keyset pagination and writes only `category_id` / `category_is_manual` through column-level grants.

**Tech Stack:** Expo SDK 57 (expo-router, React Query v5), Supabase (Postgres + Deno Edge Functions, `npm:` imports), Plaid Node SDK v30, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-20-phase-2-transaction-sync-design.md`

## Global Constraints

- Read `apps/mobile/AGENTS.md` before writing Expo code — SDK 57 APIs differ from training data. Versioned docs: https://docs.gradle.org → use https://docs.expo.dev/versions/v57.0.0/
- All Plaid calls go through Edge Functions. The app never sees an access token.
- New tables: enable RLS, add `(select auth.uid()) = user_id` policies, and **explicit** `grant` to `authenticated`. The cloud default does auto-expose via default privileges — grant deliberately and revoke what should not be reachable.
- Every monetary amount renders via `Amount` (`@/components/ui/amount`); text via `AppText` variants; colors/spacing only from `@/constants/theme`.
- Plaid PFC category → our `category_id` must never overwrite a user's manual override.
- `transactions.amount` is **sign-inverted from Plaid**: positive = money in, negative = money out.
- Do NOT pass `options.transactions_url_taxonomy` — `plaid@30` pins a Plaid-Version that rejects it with `UNKNOWN_FIELDS` (verified live).
- Run `npm run typecheck && npx expo lint` (in `apps/mobile`) before every commit.
- Migrations are new files in `supabase/migrations/`. Never edit an applied migration.
- Path alias is `@/` → `apps/mobile/src/`.

**Deviation from spec:** the spec says category `color` comes from `theme.ts`. `theme.ts` has no category ramp, and duplicating a 16-colour ramp in two places invites drift. Category colours are stored as hex in the database as the single source of truth. Chosen to read acceptably on both the dark and light palettes.

---

### Task 1: Schema and seed data

**Files:**
- Create: `supabase/migrations/<timestamp>_phase2_transactions.sql`

**Interfaces:**
- Consumes: `public.plaid_items`, `public.accounts`, `public.set_updated_at()` from the Phase 1 migration.
- Produces: tables `public.categories`, `public.plaid_category_map`, `public.transactions`; column `plaid_items.sync_locked_at`. Category slugs referenced by later tasks: `uncategorized` is the mandatory fallback.

- [ ] **Step 1: Create the migration file**

Generate the timestamp so it sorts after the existing migrations:

```bash
cd /home/dahvincis/Desktop/projects/Tusky-App
touch "supabase/migrations/$(date +%Y%m%d%H%M%S)_phase2_transactions.sql"
```

- [ ] **Step 2: Write the taxonomy tables and seed**

```sql
-- Phase 2: transactions, curated category taxonomy, and the PFC mapping.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  kind text not null check (kind in ('income', 'expense', 'transfer')),
  icon text not null,          -- lucide-react-native icon name
  color text not null,         -- hex, single source of truth (see plan note)
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.categories enable row level security;

create policy "Categories are readable by all signed-in users"
  on public.categories for select
  using (auth.role() = 'authenticated');

grant select on public.categories to authenticated;

insert into public.categories (slug, name, kind, icon, color, sort_order) values
  ('income',                   'Income',                'income',   'TrendingUp',       '#55C084',  1),
  ('transfer',                 'Transfer',              'transfer', 'ArrowLeftRight',   '#94A198',  2),
  ('food_and_dining',          'Food & Dining',         'expense',  'UtensilsCrossed',  '#E07856',  3),
  ('bills_and_utilities',      'Bills & Utilities',     'expense',  'Zap',              '#D9A441',  4),
  ('transportation',           'Transportation',        'expense',  'Car',              '#4E9BD1',  5),
  ('shopping',                 'Shopping',              'expense',  'ShoppingBag',      '#A97ACD',  6),
  ('entertainment',            'Entertainment',         'expense',  'Clapperboard',     '#D96BA0',  7),
  ('travel',                   'Travel',                'expense',  'Plane',            '#46B3A8',  8),
  ('medical',                  'Medical',               'expense',  'HeartPulse',       '#E05A5A',  9),
  ('personal_care',            'Personal Care',         'expense',  'Sparkles',         '#C98BB8', 10),
  ('home',                     'Home',                  'expense',  'House',            '#8C9F5B', 11),
  ('services',                 'Services',              'expense',  'Wrench',           '#7C8BA1', 12),
  ('loan_payments',            'Loan Payments',         'expense',  'Landmark',         '#B5784B', 13),
  ('bank_fees',                'Bank Fees',             'expense',  'Receipt',          '#9A8C7A', 14),
  ('government_and_nonprofit', 'Government & Nonprofit','expense',  'Building2',        '#6F8FA6', 15),
  ('uncategorized',            'Uncategorized',         'expense',  'CircleDashed',     '#94A198', 99);

-- PFC v2 primary -> our category. Many-to-one: both transfer directions collapse.
create table public.plaid_category_map (
  pfc_primary text primary key,
  category_id uuid not null references public.categories (id)
);

alter table public.plaid_category_map enable row level security;

create policy "Category map is readable by all signed-in users"
  on public.plaid_category_map for select
  using (auth.role() = 'authenticated');

grant select on public.plaid_category_map to authenticated;

insert into public.plaid_category_map (pfc_primary, category_id)
select v.pfc, c.id from (values
  ('INCOME',                    'income'),
  ('TRANSFER_IN',               'transfer'),
  ('TRANSFER_OUT',              'transfer'),
  ('FOOD_AND_DRINK',            'food_and_dining'),
  ('RENT_AND_UTILITIES',        'bills_and_utilities'),
  ('TRANSPORTATION',            'transportation'),
  ('GENERAL_MERCHANDISE',       'shopping'),
  ('ENTERTAINMENT',             'entertainment'),
  ('TRAVEL',                    'travel'),
  ('MEDICAL',                   'medical'),
  ('PERSONAL_CARE',             'personal_care'),
  ('HOME_IMPROVEMENT',          'home'),
  ('GENERAL_SERVICES',          'services'),
  ('LOAN_PAYMENTS',             'loan_payments'),
  ('BANK_FEES',                 'bank_fees'),
  ('GOVERNMENT_AND_NON_PROFIT', 'government_and_nonprofit')
) as v(pfc, slug)
join public.categories c on c.slug = v.slug;
```

- [ ] **Step 3: Write the transactions table and the item lock column**

Append to the same file:

```sql
-- Sync claim. Service-role only: no grant, so no client policy is needed.
alter table public.plaid_items add column sync_locked_at timestamptz;

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  item_id uuid not null references public.plaid_items (id) on delete cascade,
  plaid_transaction_id text not null unique,
  name text not null,
  merchant_name text,
  logo_url text,
  -- SIGN INVERTED from Plaid: positive = money in, negative = money out.
  amount numeric(14, 2) not null,
  iso_currency_code text not null default 'USD',
  date date not null,
  datetime timestamptz,
  pending boolean not null default false,
  pending_transaction_id text,
  payment_channel text,
  pfc_primary text,
  pfc_detailed text,
  pfc_confidence text,
  category_id uuid references public.categories (id),
  category_is_manual boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transactions_feed_idx on public.transactions (user_id, date desc, id desc);
create index transactions_account_id_idx on public.transactions (account_id);
create index transactions_item_id_idx on public.transactions (item_id);

create trigger transactions_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

alter table public.transactions enable row level security;

create policy "Users can view their own transactions"
  on public.transactions for select
  using ((select auth.uid()) = user_id);

create policy "Users can recategorize their own transactions"
  on public.transactions for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select on public.transactions to authenticated;
-- Column-level: a client may recategorize, never rewrite an amount or a date.
grant update (category_id, category_is_manual) on public.transactions to authenticated;
```

- [ ] **Step 4: Verify the SQL parses**

There is no local Postgres. Check it by eye against the Phase 1 migration for pattern match, then confirm at push time:

```bash
cd /home/dahvincis/Desktop/projects/Tusky-App
npx supabase db push          # requires `supabase login` + `link` first
```

Expected: applies cleanly, reports the new migration. If `login` has not been run this machine, stop and ask — do not attempt to authenticate non-interactively.

- [ ] **Step 5: Verify the grants landed as intended**

```bash
cd apps/mobile && set -a && . ./.env && set +a
# transactions: readable (empty, RLS) not permission-denied
curl -s -o /dev/null -w "transactions %{http_code}\n" \
  "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/transactions?select=id&limit=1" -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY"
# categories: readable
curl -s "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/categories?select=slug&limit=3" -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY"
```

Expected: `transactions 200` with `[]`, and categories returning rows (they are not user-scoped).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(db): phase 2 schema — transactions, category taxonomy, PFC map"
```

---

### Task 2: Pure categorization logic + tests

Extracting the two decision branches as pure functions is what makes them testable without a database or a Plaid account.

**Files:**
- Create: `supabase/functions/_shared/categorize.ts`
- Test: `supabase/functions/_shared/categorize.test.ts`

**Interfaces:**
- Produces:
  - `type CategoryMap = Record<string, string>` — PFC primary → category UUID
  - `resolveCategoryId(map: CategoryMap, pfcPrimary: string | null | undefined, fallbackId: string): string`
  - `type ExistingCategory = { category_id: string | null; category_is_manual: boolean } | null`
  - `pickCategoryId(existing: ExistingCategory, incomingId: string): string` — the override rule
  - `toSignedAmount(plaidAmount: number): number` — the sign inversion

- [ ] **Step 1: Write the failing tests**

```ts
import { assertEquals } from 'jsr:@std/assert';

import { pickCategoryId, resolveCategoryId, toSignedAmount } from './categorize.ts';

const MAP = { FOOD_AND_DRINK: 'cat-food', INCOME: 'cat-income' };
const FALLBACK = 'cat-uncategorized';

Deno.test('resolveCategoryId maps a known PFC primary', () => {
  assertEquals(resolveCategoryId(MAP, 'FOOD_AND_DRINK', FALLBACK), 'cat-food');
});

Deno.test('resolveCategoryId falls back for an unknown primary', () => {
  assertEquals(resolveCategoryId(MAP, 'CRYPTO_MOONSHOTS', FALLBACK), FALLBACK);
});

Deno.test('resolveCategoryId falls back for null/undefined', () => {
  assertEquals(resolveCategoryId(MAP, null, FALLBACK), FALLBACK);
  assertEquals(resolveCategoryId(MAP, undefined, FALLBACK), FALLBACK);
});

Deno.test('pickCategoryId keeps a manual override', () => {
  const existing = { category_id: 'cat-user-chose', category_is_manual: true };
  assertEquals(pickCategoryId(existing, 'cat-food'), 'cat-user-chose');
});

Deno.test('pickCategoryId takes the incoming category when not manual', () => {
  const existing = { category_id: 'cat-old', category_is_manual: false };
  assertEquals(pickCategoryId(existing, 'cat-food'), 'cat-food');
});

Deno.test('pickCategoryId takes the incoming category for a new transaction', () => {
  assertEquals(pickCategoryId(null, 'cat-food'), 'cat-food');
});

Deno.test('pickCategoryId ignores a manual flag with no category set', () => {
  const existing = { category_id: null, category_is_manual: true };
  assertEquals(pickCategoryId(existing, 'cat-food'), 'cat-food');
});

Deno.test('toSignedAmount inverts Plaid outflow to negative', () => {
  assertEquals(toSignedAmount(28.34), -28.34);
});

Deno.test('toSignedAmount inverts Plaid inflow to positive', () => {
  assertEquals(toSignedAmount(-2400), 2400);
});

Deno.test('toSignedAmount leaves zero alone', () => {
  assertEquals(toSignedAmount(0), 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Deno is not installed on this machine. Install it user-locally (no sudo):

```bash
curl -fsSL https://deno.land/install.sh | sh
export PATH="$HOME/.deno/bin:$PATH"
cd /home/dahvincis/Desktop/projects/Tusky-App
deno test supabase/functions/_shared/categorize.test.ts
```

Expected: FAIL — `Module not found "./categorize.ts"`.

If installing Deno is unwanted, stop and ask rather than skipping the tests.

- [ ] **Step 3: Write the implementation**

```ts
/** PFC primary (e.g. 'FOOD_AND_DRINK') -> our category UUID. */
export type CategoryMap = Record<string, string>;

export type ExistingCategory = {
  category_id: string | null;
  category_is_manual: boolean;
} | null;

/**
 * Resolve a Plaid PFC primary to one of our categories. An unmapped or absent
 * primary resolves to the fallback so a transaction can never be dropped.
 */
export function resolveCategoryId(
  map: CategoryMap,
  pfcPrimary: string | null | undefined,
  fallbackId: string,
): string {
  if (!pfcPrimary) return fallbackId;
  return map[pfcPrimary] ?? fallbackId;
}

/**
 * The override rule: a user's manual category always wins over Plaid's guess.
 * Enforced here, and applied in the upsert's conflict clause, so no call site
 * can bypass it. A manual flag with no category set is incoherent — treat it
 * as unset rather than writing null.
 */
export function pickCategoryId(existing: ExistingCategory, incomingId: string): string {
  if (existing?.category_is_manual && existing.category_id) return existing.category_id;
  return incomingId;
}

/**
 * Plaid returns amount positive for outflow. We store the intuitive convention:
 * positive is money in, negative is money out. `|| 0` avoids a -0 result.
 */
export function toSignedAmount(plaidAmount: number): number {
  return -plaidAmount || 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
deno test supabase/functions/_shared/categorize.test.ts
```

Expected: `ok | 9 passed | 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/categorize.ts supabase/functions/_shared/categorize.test.ts
git commit -m "feat(functions): pure categorization, override, and sign helpers with tests"
```

---

### Task 3: The sync Edge Function

**Files:**
- Create: `supabase/functions/plaid-sync-transactions/index.ts`

**Interfaces:**
- Consumes: `corsHeaders`, `getAdminClient`, `getAuthedUser`, `getPlaidClient`, `jsonResponse` from `../_shared/lib.ts`; `resolveCategoryId`, `pickCategoryId`, `toSignedAmount`, `CategoryMap` from `../_shared/categorize.ts`.
- Produces: `POST /functions/v1/plaid-sync-transactions`, no body required. Returns `{ results: Array<{ item_id: string; status: 'synced' | 'skipped' | 'login_required' | 'error'; added: number; modified: number; removed: number }> }`.

- [ ] **Step 1: Write the function**

```ts
import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, jsonResponse } from '../_shared/lib.ts';
import { type CategoryMap, pickCategoryId, resolveCategoryId, toSignedAmount } from '../_shared/categorize.ts';

const PAGE_SIZE = 500;
const FIRST_SYNC_DAYS = 90;
const MAX_MUTATION_RETRIES = 3;
/** A claim older than this is treated as abandoned by a dead invocation. */
const STALE_CLAIM_MS = 5 * 60_000;

type ItemResult = {
  item_id: string;
  status: 'synced' | 'skipped' | 'login_required' | 'error';
  added: number;
  modified: number;
  removed: number;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  const plaid = getPlaidClient();

  // Taxonomy, loaded once per invocation.
  const { data: mapRows, error: mapError } = await admin
    .from('plaid_category_map')
    .select('pfc_primary, category_id');
  if (mapError) {
    console.error('failed to load category map', mapError);
    return jsonResponse({ error: 'Could not load categories' }, 500);
  }
  const categoryMap: CategoryMap = Object.fromEntries(
    (mapRows ?? []).map((r) => [r.pfc_primary, r.category_id]),
  );

  const { data: fallback, error: fallbackError } = await admin
    .from('categories').select('id').eq('slug', 'uncategorized').single();
  if (fallbackError || !fallback) {
    console.error('uncategorized category missing', fallbackError);
    return jsonResponse({ error: 'Could not load categories' }, 500);
  }
  const fallbackId: string = fallback.id;

  const { data: items, error: itemsError } = await admin
    .from('plaid_items')
    .select('id, plaid_item_id, status')
    .eq('user_id', user.id)
    .eq('status', 'active');
  if (itemsError) {
    console.error('failed to load items', itemsError);
    return jsonResponse({ error: 'Could not load connected banks' }, 500);
  }

  const results: ItemResult[] = [];

  for (const item of items ?? []) {
    const result: ItemResult = { item_id: item.id, status: 'synced', added: 0, modified: 0, removed: 0 };

    // Claim the item. Atomic, survives across HTTP calls, self-healing when stale.
    const { data: claimed } = await admin
      .from('plaid_items')
      .update({ sync_locked_at: new Date().toISOString() })
      .eq('id', item.id)
      .or(`sync_locked_at.is.null,sync_locked_at.lt.${new Date(Date.now() - STALE_CLAIM_MS).toISOString()}`)
      .select('id, sync_cursor')
      .maybeSingle();

    if (!claimed) {
      results.push({ ...result, status: 'skipped' });
      continue;
    }

    try {
      const { data: tokenRow, error: tokenError } = await admin
        .from('plaid_tokens').select('access_token').eq('item_id', item.id).single();
      if (tokenError || !tokenRow) throw new Error('access token missing');

      const accessToken: string = tokenRow.access_token;
      const startCursor: string | null = claimed.sync_cursor;

      // Map Plaid account ids to our account uuids for this item.
      const { data: accountRows } = await admin
        .from('accounts').select('id, plaid_account_id').eq('item_id', item.id);
      const accountByPlaidId = new Map<string, string>(
        (accountRows ?? []).map((a) => [a.plaid_account_id, a.id]),
      );

      // deno-lint-ignore no-explicit-any
      let added: any[] = [];
      // deno-lint-ignore no-explicit-any
      let modified: any[] = [];
      let removed: { transaction_id: string }[] = [];
      let finalCursor: string | null = startCursor;

      for (let attempt = 0; attempt < MAX_MUTATION_RETRIES; attempt++) {
        added = []; modified = []; removed = [];
        let cursor = startCursor;   // ALWAYS restart from here, never mid-sequence
        let hasMore = true;
        try {
          while (hasMore) {
            const { data } = await plaid.transactionsSync({
              access_token: accessToken,
              cursor: cursor ?? undefined,
              count: PAGE_SIZE,
              ...(cursor ? {} : { options: { days_requested: FIRST_SYNC_DAYS } }),
              // deno-lint-ignore no-explicit-any
            } as any);
            added.push(...data.added);
            modified.push(...data.modified);
            removed.push(...data.removed);
            hasMore = data.has_more;
            cursor = data.next_cursor;
          }
          finalCursor = cursor;
          break;
        } catch (err) {
          const code = (err as { response?: { data?: { error_code?: string } } })
            ?.response?.data?.error_code;
          if (code === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && attempt < MAX_MUTATION_RETRIES - 1) {
            continue;  // restart the whole loop from startCursor
          }
          if (code === 'ITEM_LOGIN_REQUIRED') {
            await admin.from('plaid_items').update({ status: 'login_required' }).eq('id', item.id);
            results.push({ ...result, status: 'login_required' });
            throw new Error('__handled__');
          }
          throw err;
        }
      }

      const upserts = [...added, ...modified];
      if (upserts.length > 0) {
        // Existing rows, so a manual override survives re-sync.
        const ids = upserts.map((t) => t.transaction_id);
        const { data: existingRows } = await admin
          .from('transactions')
          .select('plaid_transaction_id, category_id, category_is_manual')
          .in('plaid_transaction_id', ids);
        const existingByPlaidId = new Map(
          (existingRows ?? []).map((r) => [r.plaid_transaction_id, r]),
        );

        const rows = upserts
          .filter((t) => accountByPlaidId.has(t.account_id))
          .map((t) => {
            const incoming = resolveCategoryId(categoryMap, t.personal_finance_category?.primary, fallbackId);
            const existing = existingByPlaidId.get(t.transaction_id) ?? null;
            return {
              user_id: user.id,
              account_id: accountByPlaidId.get(t.account_id)!,
              item_id: item.id,
              plaid_transaction_id: t.transaction_id,
              name: t.name,
              merchant_name: t.merchant_name ?? null,
              logo_url: t.logo_url ?? null,
              amount: toSignedAmount(t.amount),
              iso_currency_code: t.iso_currency_code ?? 'USD',
              date: t.date,
              datetime: t.datetime ?? null,
              pending: t.pending ?? false,
              pending_transaction_id: t.pending_transaction_id ?? null,
              payment_channel: t.payment_channel ?? null,
              pfc_primary: t.personal_finance_category?.primary ?? null,
              pfc_detailed: t.personal_finance_category?.detailed ?? null,
              pfc_confidence: t.personal_finance_category?.confidence_level ?? null,
              category_id: pickCategoryId(existing, incoming),
              category_is_manual: existing?.category_is_manual ?? false,
            };
          });

        if (rows.length > 0) {
          const { error } = await admin
            .from('transactions').upsert(rows, { onConflict: 'plaid_transaction_id' });
          if (error) throw error;
        }
      }

      if (removed.length > 0) {
        const { error } = await admin
          .from('transactions').delete()
          .in('plaid_transaction_id', removed.map((r) => r.transaction_id));
        if (error) throw error;
      }

      // Cursor last: a crash before here means the next run re-applies the same
      // window idempotently rather than skipping it.
      await admin.from('plaid_items').update({ sync_cursor: finalCursor }).eq('id', item.id);

      results.push({ ...result, added: added.length, modified: modified.length, removed: removed.length });
    } catch (err) {
      if ((err as Error).message !== '__handled__') {
        console.error(`sync failed for item ${item.id}`, err);
        results.push({ ...result, status: 'error' });
      }
    } finally {
      // Always free the claim, including on a thrown error.
      await admin.from('plaid_items').update({ sync_locked_at: null }).eq('id', item.id);
    }
  }

  return jsonResponse({ results });
});
```

- [ ] **Step 2: Deploy it**

```bash
cd /home/dahvincis/Desktop/projects/Tusky-App
npx supabase functions deploy plaid-sync-transactions --use-api
```

Expected: deploys. Requires `supabase login` + `link` — if not authenticated, stop and ask.

- [ ] **Step 3: Verify it rejects anonymous callers**

```bash
cd apps/mobile && set -a && . ./.env && set +a
curl -s -X POST "$EXPO_PUBLIC_SUPABASE_URL/functions/v1/plaid-sync-transactions" \
  -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY" -H "Content-Type: application/json" -d '{}'
```

Expected: `{"error":"Unauthorized"}` — proving the auth gate fires before any Plaid call.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/plaid-sync-transactions/
git commit -m "feat(functions): cursor-based transaction sync with claim and override"
```

---

### Task 4: App data layer

**Files:**
- Modify: `apps/mobile/src/lib/queries.ts`

**Interfaces:**
- Consumes: `supabase` from `@/lib/supabase`.
- Produces:
  - `type Category = { id, slug, name, kind: 'income'|'expense'|'transfer', icon, color, sort_order }`
  - `type Transaction = { id, account_id, name, merchant_name, logo_url, amount, iso_currency_code, date, pending, category_id, category_is_manual }`
  - `useCategories()` → `UseQueryResult<Category[]>`
  - `useTransactions()` → `UseInfiniteQueryResult` with `data.pages: Transaction[][]`
  - `useSetTransactionCategory()` → mutation taking `{ transactionId: string; categoryId: string }`

- [ ] **Step 1: Append the types and hooks**

```ts
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
    staleTime: 1000 * 60 * 60, // taxonomy only changes with a migration
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
      const previous = queryClient.getQueryData(['transactions']);
      queryClient.setQueryData(
        ['transactions'],
        // deno-lint-ignore no-explicit-any
        (old: any) => !old ? old : {
          ...old,
          pages: old.pages.map((page: Transaction[]) =>
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
```

Replace the existing `import { useQuery } from '@tanstack/react-query';` at the top of the file with the combined import shown above.

- [ ] **Step 2: Typecheck and lint**

```bash
cd apps/mobile && npm run typecheck && npx expo lint
```

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/lib/queries.ts
git commit -m "feat(app): transactions and categories queries with keyset pagination"
```

---

### Task 5: Sync trigger hook

**Files:**
- Modify: `apps/mobile/src/lib/plaid.ts`

**Interfaces:**
- Produces: `useSyncTransactions()` → `{ sync: () => Promise<void>; isSyncing: boolean; error: string | null }`.
- Modifies: `useConnectBank` calls sync once after a successful exchange.

- [ ] **Step 1: Add the hook**

Append to `plaid.ts`:

```ts
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
      const { error: fnError } = await supabase.functions.invoke('plaid-sync-transactions');
      if (fnError) throw new Error('Could not refresh transactions. Try again in a moment.');
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
```

- [ ] **Step 2: Sync once after a bank is connected**

In `useConnectBank`'s `onSuccess`, after the existing
`await queryClient.invalidateQueries({ queryKey: ['accounts'] });`, add:

```ts
            // Populate the new bank's transactions without a manual pull.
            await supabase.functions.invoke('plaid-sync-transactions');
            await queryClient.invalidateQueries({ queryKey: ['transactions'] });
```

- [ ] **Step 3: Typecheck and lint**

```bash
cd apps/mobile && npm run typecheck && npx expo lint
```

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/lib/plaid.ts
git commit -m "feat(app): transaction sync trigger, fired on connect and pull-to-refresh"
```

---

### Task 6: Transaction row and category chip

**Files:**
- Create: `apps/mobile/src/components/ui/category-icon.tsx`
- Create: `apps/mobile/src/components/transaction-row.tsx`

**Interfaces:**
- Consumes: `Transaction`, `Category` from `@/lib/queries`; `Amount`, `AppText`, `useTheme`, `Spacing`, `Radius`.
- Produces: `<CategoryIcon name={string|undefined} size={number} color={string} />` and `categoryIcon(name)`; `<TransactionRow transaction={...} category={...} onPress={() => {}} />`.

**Why `CategoryIcon` exists:** binding a resolved component to a local and rendering
`<Icon />` trips the React Compiler lint `react-hooks/static-components` ("Cannot create
components during render"). Resolving by name and rendering through `createElement` is the
escape, and it keeps the lookup in one place for both consumers. Verified: without this,
`npx expo lint` fails.

- [ ] **Step 0: Create the shared icon component**

```tsx
import * as Icons from 'lucide-react-native';
import { createElement } from 'react';

/** Resolve a stored lucide icon name, falling back so a bad seed never crashes a row. */
export function categoryIcon(name: string | undefined): Icons.LucideIcon {
  if (!name) return Icons.CircleDashed;
  return (Icons as unknown as Record<string, Icons.LucideIcon>)[name] ?? Icons.CircleDashed;
}

type Props = { name: string | undefined; size: number; color: string };

export function CategoryIcon({ name, size, color }: Props) {
  return createElement(categoryIcon(name), { size, color, strokeWidth: 1.75 });
}
```

- [ ] **Step 1: Write the component**

```tsx
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { Amount } from '@/components/ui/amount';
import { AppText } from '@/components/ui/app-text';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Category, Transaction } from '@/lib/queries';

type Props = {
  transaction: Transaction;
  category?: Category;
  onPress: () => void;
};

export function TransactionRow({ transaction, category, onPress }: Props) {
  const colors = useTheme();
  const tint = category?.color ?? colors.textDim;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm + 2,
        paddingVertical: Spacing.sm + 2,
        paddingHorizontal: Spacing.md,
        backgroundColor: pressed ? colors.elevated : 'transparent',
      })}>
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: Radius.full,
          backgroundColor: colors.elevated,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}>
        {transaction.logo_url ? (
          <Image source={{ uri: transaction.logo_url }} style={{ width: 38, height: 38 }} contentFit="cover" />
        ) : (
          <CategoryIcon name={category?.icon} size={18} color={tint} />
        )}
      </View>

      <View style={{ flex: 1, paddingRight: Spacing.sm }}>
        <AppText variant="label" numberOfLines={1}>
          {transaction.merchant_name ?? transaction.name}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.xs }}>
          <View style={{ width: 7, height: 7, borderRadius: Radius.full, backgroundColor: tint }} />
          <AppText variant="caption" tone="dim" numberOfLines={1}>
            {category?.name ?? 'Uncategorized'}
            {transaction.pending ? ' · Pending' : ''}
          </AppText>
        </View>
      </View>

      <Amount value={transaction.amount} size={15} signColor showPlus />
    </Pressable>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
cd apps/mobile && npm run typecheck && npx expo lint
```

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/ui/category-icon.tsx apps/mobile/src/components/transaction-row.tsx
git commit -m "feat(app): transaction row with category chip and merchant logo"
```

---

### Task 7: Category picker

**Files:**
- Create: `apps/mobile/src/components/category-picker.tsx`

**Interfaces:**
- Consumes: `useCategories`, `Category` from `@/lib/queries`; `CategoryIcon` from `@/components/ui/category-icon`.
- Produces: `<CategoryPicker visible={boolean} selectedId={string | null} onSelect={(c: Category) => void} onClose={() => void} />`.

- [ ] **Step 1: Write the component**

```tsx
import { Check } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { CategoryIcon } from '@/components/ui/category-icon';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { type Category, useCategories } from '@/lib/queries';

const KIND_LABEL: Record<Category['kind'], string> = {
  income: 'Income',
  expense: 'Expenses',
  transfer: 'Transfers',
};
const KIND_ORDER: Category['kind'][] = ['expense', 'income', 'transfer'];

type Props = {
  visible: boolean;
  selectedId: string | null;
  onSelect: (category: Category) => void;
  onClose: () => void;
};

export function CategoryPicker({ visible, selectedId, onSelect, onClose }: Props) {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { data: categories = [] } = useCategories();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
      <View
        style={{
          maxHeight: '75%',
          backgroundColor: colors.surface,
          borderTopLeftRadius: Radius.xl,
          borderTopRightRadius: Radius.xl,
          paddingTop: Spacing.lg,
          paddingBottom: insets.bottom + Spacing.md,
        }}>
        <AppText variant="title" style={{ paddingHorizontal: Spacing.md, marginBottom: Spacing.sm }}>
          Category
        </AppText>

        <ScrollView>
          {KIND_ORDER.map((kind) => {
            const group = categories.filter((c) => c.kind === kind);
            if (group.length === 0) return null;
            return (
              <View key={kind}>
                <AppText
                  variant="caption"
                  tone="dim"
                  style={{ paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: Spacing.xs, textTransform: 'uppercase', letterSpacing: 1.1 }}>
                  {KIND_LABEL[kind]}
                </AppText>
                {group.map((category) => {
                  const selected = category.id === selectedId;
                  return (
                    <Pressable
                      key={category.id}
                      onPress={() => onSelect(category)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: Spacing.sm + 2,
                        paddingVertical: Spacing.sm + 2,
                        paddingHorizontal: Spacing.md,
                        backgroundColor: pressed ? colors.elevated : 'transparent',
                      })}>
                      <View
                        style={{
                          width: 34, height: 34, borderRadius: Radius.full,
                          backgroundColor: colors.elevated,
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                        <CategoryIcon name={category.icon} size={17} color={category.color} />
                      </View>
                      <AppText variant="label" style={{ flex: 1 }}>{category.name}</AppText>
                      {selected ? <Check size={18} color={colors.brand} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
cd apps/mobile && npm run typecheck && npx expo lint
```

Expected: both clean.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/category-picker.tsx
git commit -m "feat(app): category picker grouped by kind"
```

---

### Task 8: Transactions screen

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/transactions.tsx` (full replacement)

**Interfaces:**
- Consumes: `useTransactions`, `useCategories`, `useSetTransactionCategory` from `@/lib/queries`; `useSyncTransactions` from `@/lib/plaid`; `TransactionRow`, `CategoryPicker`, `EmptyState`.

- [ ] **Step 1: Replace the stub**

```tsx
import { ArrowLeftRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CategoryPicker } from '@/components/category-picker';
import { TransactionRow } from '@/components/transaction-row';
import { AppText } from '@/components/ui/app-text';
import { EmptyState } from '@/components/ui/empty-state';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useSyncTransactions } from '@/lib/plaid';
import { type Transaction, useCategories, useSetTransactionCategory, useTransactions } from '@/lib/queries';

function formatSectionDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  const today = new Date();
  const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export default function TransactionsScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { sync, isSyncing } = useSyncTransactions();
  const setCategory = useSetTransactionCategory();
  const [editing, setEditing] = useState<Transaction | null>(null);

  const categoriesById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  // Flat pages -> one section per date, order already guaranteed by the query.
  const sections = useMemo(() => {
    const all = data?.pages.flat() ?? [];
    const byDate: { title: string; data: Transaction[] }[] = [];
    for (const transaction of all) {
      const title = formatSectionDate(transaction.date);
      const current = byDate[byDate.length - 1];
      if (current && current.title === title) current.data.push(transaction);
      else byDate.push({ title, data: [transaction] });
    }
    return byDate;
  }, [data]);

  if (!isLoading && sections.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
        <EmptyState
          icon={ArrowLeftRight}
          title="No transactions yet"
          message="Transactions appear here automatically after you connect a bank."
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <AppText variant="display" style={{ paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm }}>
        Transactions
      </AppText>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        refreshControl={
          <RefreshControl refreshing={isSyncing} onRefresh={sync} tintColor={colors.textDim} />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
        renderSectionHeader={({ section }) => (
          <AppText
            variant="caption"
            tone="dim"
            style={{
              paddingHorizontal: Spacing.md,
              paddingTop: Spacing.md,
              paddingBottom: Spacing.xs,
              backgroundColor: colors.bg,
              textTransform: 'uppercase',
              letterSpacing: 1.1,
            }}>
            {section.title}
          </AppText>
        )}
        renderItem={({ item }) => (
          <TransactionRow
            transaction={item}
            category={item.category_id ? categoriesById.get(item.category_id) : undefined}
            onPress={() => setEditing(item)}
          />
        )}
        ListFooterComponent={
          isFetchingNextPage
            ? <ActivityIndicator color={colors.textDim} style={{ marginVertical: Spacing.lg }} />
            : <View style={{ height: Spacing.xxl }} />
        }
      />

      <CategoryPicker
        visible={editing !== null}
        selectedId={editing?.category_id ?? null}
        onClose={() => setEditing(null)}
        onSelect={(category) => {
          if (editing) setCategory.mutate({ transactionId: editing.id, categoryId: category.id });
          setEditing(null);
        }}
      />
    </View>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

```bash
cd apps/mobile && npm run typecheck && npx expo lint
```

Expected: both clean.

- [ ] **Step 3: Verify on the device**

A Pixel 10 Pro is paired over wireless adb.

```bash
cd apps/mobile && npx expo start --dev-client   # leave running
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW \
  -d "exp+tusky://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
adb logcat -d -t 300 | grep -iE "FATAL|ReactNativeJS.*Error"
```

Check on device, in order:
1. Transactions tab lists transactions grouped by date, newest first.
2. Expenses render negative (`-$28.34`), income positive and green (`+$2,400.00`).
3. Tapping a row opens the picker; choosing a category updates the chip immediately.
4. Pull to refresh completes without the chosen category reverting — this is the override rule working end to end.
5. Scroll past 50 transactions; the next page appends with no duplicates and no gaps.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/app/\(tabs\)/transactions.tsx
git commit -m "feat(app): date-grouped transactions feed with inline recategorization"
```

---

## Final verification

- [ ] `cd apps/mobile && npm run typecheck && npx expo lint` — clean
- [ ] `deno test supabase/functions/_shared/categorize.test.ts` — 9 passed
- [ ] Sync idempotency: trigger a pull-to-refresh twice with no new bank activity. The second run returns `added: 0, modified: 0, removed: 0` and the feed is unchanged.
- [ ] Override survives re-sync: recategorize a transaction, pull to refresh, confirm the category holds.
- [ ] `plaid_tokens` still unreachable from the client:
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' \
    "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/plaid_tokens?select=access_token" \
    -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY"
  ```
  Expected `401` once the Task-0 revoke migration is pushed (see the parked
  `revoke_plaid_tokens_client_grants` migration, which should go out with this batch).
