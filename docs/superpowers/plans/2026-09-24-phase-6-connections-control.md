# Phase 6 — Connections & Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users disconnect a bank (keep history or delete everything), hide and unhide accounts, and stop connecting the same bank twice. Also close the database grants the app never needed.

**Architecture:** Two migrations: a status check, and a revoke-and-regrant. `_shared/connections.ts` holds pure decisions (`planDisconnect`, `isItemGone`, `isDuplicateLink`), which Deno tests pin, plus one I/O routine, `disconnectItem`, which a new JWT-verified `plaid-disconnect-item` function serves. `syncItem`'s claim moves into an exported `claimItem`, so sync and disconnect exclude each other the same way. The client gets a `/bank/[id]` screen, which is the one place that lists hidden accounts, and Settings and Home rows link to it.

**Tech Stack:** Supabase Postgres and Deno Edge Functions (`npm:plaid@30`, `npm:@supabase/supabase-js@2`), Expo SDK 57 with expo-router 57, React Query 5, `react-native-plaid-link-sdk` 13.

**Spec:** `docs/superpowers/specs/2026-09-23-phase-6-connections-control-design.md`

## Global Constraints

- All Plaid calls go through Edge Functions. The app never sees access tokens.
- Local state changes only if `/item/remove` succeeds or returns `ITEM_NOT_FOUND`. Anything else → 502, nothing changed.
- Disconnect takes the same `sync_locked_at` claim as `syncItem` (5-minute stale window). A held claim → 409.
- Archived Items never block a new link, never sync, and never snapshot.
- Duplicate = same `institution_id` + an account with equal trimmed, case-folded name AND mask on one of the user's `active`/`login_required` Items. When no incoming account has a mask, a matching institution alone is enough.
- Every monetary amount renders via `Amount`, all text via `AppText`, and colours and spacing only from `constants/theme.ts`.
- SDK 57 screen titles: `<Stack.Title>` inside the page (`Stack.Screen.Title` is deprecated).
- Copy is verbatim from the spec: "This bank is syncing — try again in a moment." / "Plaid couldn't remove the connection; nothing was changed." / "{Institution} is already connected. If it stopped syncing, use Reconnect in Settings." / "Hidden accounts leave net worth, transactions, budgets, reports and bills. Nothing is deleted."
- Never run `npx supabase secrets set --env-file …`. The key switch is gated on Pedro's go-ahead and is **out of scope for this plan**.

## Review Focus

1. **Double-tapping Disconnect** (two concurrent requests). Expect the second to get 409 `busy`, 404, or an `ok` no-op. It must never get a 500 or leave a half-archived Item. The client disables the button while a request is in flight (Task 6), and the server's claim covers the rest (Task 3).
2. **Disconnecting while a sync holds the claim.** Expect 409 and the exact message, with nothing changed. Verified by setting `sync_locked_at = now()` by SQL and tapping Disconnect (Task 8, step 5).
3. **`item_id` that is not a UUID.** Expect 400, not a PostgREST `22P02` surfacing as 500 (Task 3's validation).
4. **The bank screen open for an Item that no longer exists** (just deleted, or stale). It must render a "no longer connected" state, not crash (Task 6).
5. **A hide toggle that fails.** The switch must revert, through the optimistic rollback (Task 5).

---

### Task 1: Storage — status check and closed grants

**Files:**
- Create: `supabase/migrations/20260924120000_phase6_item_status.sql`
- Create: `supabase/migrations/20260924120100_phase6_revoke_default_grants.sql`

- [ ] **Step 1: Write the status migration**

```sql
-- Phase 6: an Item is live (active, login_required) or archived — removed at
-- Plaid, token deleted, history kept. The old inline comment listed
-- `disconnected`, which nothing ever wrote.
alter table public.plaid_items
  add constraint plaid_items_status_check check (status in ('active', 'login_required', 'archived'));
comment on column public.plaid_items.status is 'active | login_required | archived';
```

- [ ] **Step 2: Write the grants migration** (the spec's SQL, with its rationale as comments).

```sql
-- This project predates Supabase's "don't auto-expose new tables" default, so
-- anon and authenticated held EVERY privilege (arwdDxtm, TRUNCATE included) on
-- every older table and view. RLS kept users out of each other's rows, but on
-- transactions and accounts a signed-in user could rewrite any column of their
-- own rows. Revoke everything, then grant back exactly what the app uses.
--
-- A table-level REVOKE also revokes that table's column privileges, which is
-- why the column grants are re-issued below.
revoke all on table
  public.plaid_items, public.accounts, public.categories, public.plaid_category_map,
  public.transactions, public.budgets, public.balance_snapshots,
  public.monthly_category_totals, public.daily_net_worth
from anon, authenticated;

-- balance_snapshots: the app never reads it directly, but daily_net_worth is
-- security_invoker, so the caller needs select on its base tables.
grant select on public.plaid_items, public.accounts, public.categories, public.transactions,
  public.balance_snapshots, public.monthly_category_totals, public.daily_net_worth to authenticated;
grant update (hidden) on public.accounts to authenticated;
grant update (category_id, category_is_manual) on public.transactions to authenticated;
-- budgets keeps full DML: its RLS with-check pins user_id, and no column is server-owned.
grant select, insert, update, delete on public.budgets to authenticated;
-- plaid_category_map: nothing. Only the service role reads it (loadSyncContext).

-- Fail closed from here on: new tables, sequences and functions that postgres
-- creates in public get no client privileges until a migration grants them.
-- service_role keeps its defaults (Edge Functions need them). supabase_admin's
-- defaults are left alone: migrations run as postgres.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
```

- [ ] **Step 3: Push**

Run (repo root): `npx supabase db push`
Expected: both migrations applied.

- [ ] **Step 4: Verify grants**

```sh
npx --no-install supabase db query --linked -o csv "select c.relname, c.relacl::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','v','m') order by 1"
npx --no-install supabase db query --linked -o csv "select pg_get_userbyid(defaclrole), defaclobjtype, defaclacl::text from pg_default_acl where defaclnamespace = 'public'::regnamespace and pg_get_userbyid(defaclrole) = 'postgres'"
npx --no-install supabase db query --linked -o csv "select has_column_privilege('authenticated','public.transactions','amount','UPDATE') amount_upd, has_column_privilege('authenticated','public.transactions','category_id','UPDATE') cat_upd, has_column_privilege('authenticated','public.accounts','current_balance','UPDATE') bal_upd, has_column_privilege('authenticated','public.accounts','hidden','UPDATE') hidden_upd"
curl -s -w '\n%{http_code}\n' "$EXPO_PUBLIC_SUPABASE_URL/rest/v1/transactions?select=id&limit=1" -H "apikey: $EXPO_PUBLIC_SUPABASE_ANON_KEY"
```

Expected:
- `anon` appears in no relacl.
- `authenticated` has only `r` (plus `arwd` on budgets).
- The postgres defaults list only `postgres` and `service_role`.
- `f,t,f,t`.
- `401` with code `42501`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260924120000_phase6_item_status.sql supabase/migrations/20260924120100_phase6_revoke_default_grants.sql
git commit -m "feat: item status check; revoke default client grants"
```

### Task 2: Pure decisions — `connections.ts`, archived snapshots, shared claim

**Files:**
- Create: `supabase/functions/_shared/connections.ts`
- Create: `supabase/functions/_shared/connections.test.ts`
- Modify: `supabase/functions/_shared/accounts.ts` (`AccountRow`, `buildSnapshotRows`)
- Modify: `supabase/functions/_shared/accounts.test.ts`
- Modify: `supabase/functions/_shared/sync.ts` (export `claimItem` and `describeError`, add the status filter, change the snapshot query)

**Interfaces:**
- Produces: `planDisconnect(status: string, mode: DisconnectMode): DisconnectPlan`; `isItemGone(err: unknown): boolean`; `isDuplicateLink(existing: LinkedAccount[], incoming: LinkedAccount[]): boolean`; types `DisconnectMode = 'archive' | 'delete'`, `DisconnectPlan`, `DisconnectResult = 'ok' | 'busy' | 'plaid_failed'`, `LinkedAccount = { name?: string | null; mask?: string | null }`. From sync.ts: `claimItem(admin, itemId): Promise<{ id: string; sync_cursor: string | null } | null>` and `describeError(err: unknown): string`. `AccountRow.archived?: boolean`.

- [ ] **Step 1: Write the failing tests** in `connections.test.ts`:

```ts
import { assertEquals, assertThrows } from 'jsr:@std/assert';

import { isDuplicateLink, isItemGone, planDisconnect } from './connections.ts';

const plaidError = (error_code: string) => ({ response: { data: { error_code, error_message: 'x' } } });

Deno.test('planDisconnect: a live Item kept → remove at Plaid, then archive', () => {
  assertEquals(planDisconnect('active', 'archive'), 'remove_then_archive');
});
Deno.test('planDisconnect: a live Item deleted → remove at Plaid, then delete', () => {
  assertEquals(planDisconnect('active', 'delete'), 'remove_then_delete');
});
Deno.test('planDisconnect: a broken Item can still be removed at Plaid', () => {
  assertEquals(planDisconnect('login_required', 'archive'), 'remove_then_archive');
  assertEquals(planDisconnect('login_required', 'delete'), 'remove_then_delete');
});
Deno.test('planDisconnect: deleting an archived Item is local only — its token is gone', () => {
  assertEquals(planDisconnect('archived', 'delete'), 'delete_local');
});
Deno.test('planDisconnect: archiving an archived Item does nothing', () => {
  assertEquals(planDisconnect('archived', 'archive'), 'noop');
});
Deno.test('planDisconnect: an unknown status throws', () => {
  assertThrows(() => planDisconnect('disconnected', 'delete'));
});

Deno.test('isItemGone: ITEM_NOT_FOUND means the Item is already removed', () => {
  assertEquals(isItemGone(plaidError('ITEM_NOT_FOUND')), true);
});
Deno.test('isItemGone: any other Plaid error is a failure', () => {
  assertEquals(isItemGone(plaidError('ITEM_LOGIN_REQUIRED')), false);
  assertEquals(isItemGone(plaidError('INVALID_ACCESS_TOKEN')), false);
});
Deno.test('isItemGone: a network error with no response is a failure', () => {
  assertEquals(isItemGone(new Error('connection reset')), false);
  assertEquals(isItemGone(undefined), false);
});

const live = [
  { name: 'Checking', mask: '1000' },
  { name: 'Credit card', mask: '2000' },
];
Deno.test('isDuplicateLink: same name and mask matches', () => {
  assertEquals(isDuplicateLink(live, [{ name: 'Checking', mask: '1000' }]), true);
});
Deno.test('isDuplicateLink: same mask with a different name is a different account', () => {
  assertEquals(isDuplicateLink(live, [{ name: 'Savings', mask: '1000' }]), false);
});
Deno.test('isDuplicateLink: different masks do not match', () => {
  assertEquals(isDuplicateLink(live, [{ name: 'Checking', mask: '0000' }]), false);
});
Deno.test('isDuplicateLink: folds case and surrounding space', () => {
  assertEquals(isDuplicateLink(live, [{ name: '  CHECKING ', mask: ' 1000' }]), true);
});
Deno.test('isDuplicateLink: no incoming masks → the same institution alone counts', () => {
  assertEquals(isDuplicateLink(live, [{ name: 'Checking' }, { name: 'Other', mask: '' }]), true);
  assertEquals(isDuplicateLink(live, []), true);
});
Deno.test('isDuplicateLink: no live Item at the institution never blocks', () => {
  assertEquals(isDuplicateLink([], [{ name: 'Checking', mask: '1000' }]), false);
  assertEquals(isDuplicateLink([], []), false);
});
```

Add to `accounts.test.ts`:

```ts
Deno.test('buildSnapshotRows skips accounts of an archived bank', () => {
  // A disconnected bank's balance is frozen. Carrying it forward would count it
  // in today's net worth, though Home no longer does. Its past rows remain.
  const rows = buildSnapshotRows(
    [
      { id: 'a', current_balance: 1 },
      { id: 'b', current_balance: 2, archived: true },
      { id: 'c', current_balance: 3, archived: false },
    ],
    USER,
  );
  assertEquals(rows.map((r) => r.account_id), ['a', 'c']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx -y deno test supabase/functions/_shared/`
Expected: FAIL — `connections.ts` not found, and the archived test fails (3 rows).

- [ ] **Step 3: Implement `connections.ts` (pure part)**

```ts
/**
 * Disconnecting a bank, and refusing to connect one twice. The decisions are
 * pure and pinned by connections.test.ts; disconnectItem does the I/O.
 * See the Phase 6 spec.
 */

export type DisconnectMode = 'archive' | 'delete';
export type DisconnectPlan = 'noop' | 'delete_local' | 'remove_then_archive' | 'remove_then_delete';
export type DisconnectResult = 'ok' | 'busy' | 'plaid_failed';

export function planDisconnect(status: string, mode: DisconnectMode): DisconnectPlan {
  switch (status) {
    case 'active':
    case 'login_required':
      // A broken Item can still be removed at Plaid — and must be: it still bills.
      return mode === 'archive' ? 'remove_then_archive' : 'remove_then_delete';
    case 'archived':
      // Its token is already gone, so there is nothing left to tell Plaid.
      return mode === 'archive' ? 'noop' : 'delete_local';
    default:
      // plaid_items_status_check makes this unreachable, so fail loudly.
      throw new Error(`unknown item status: ${status}`);
  }
}

/**
 * Plaid's code for an Item "previously removed via /item/remove, or [that] has
 * had access removed by the user". Removal is then already done, so the
 * disconnect may proceed. Every other error — including a network error with
 * no response — must leave the Item connected: the token is the only way left
 * to stop its billing.
 */
export function isItemGone(err: unknown): boolean {
  const code = (err as { response?: { data?: { error_code?: string } } } | undefined)
    ?.response?.data?.error_code;
  return code === 'ITEM_NOT_FOUND';
}

export type LinkedAccount = { name?: string | null; mask?: string | null };

const fold = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Plaid's duplicate-Item rule: the same institution plus an account with the
 * same name and mask. `existing` is the user's accounts on LIVE Items at the
 * incoming institution — archived ones never block, or "Keep history" would
 * lock the user out of that bank. When Link sends no masks at all, Plaid's
 * fallback applies: the same institution for the same user is enough.
 */
export function isDuplicateLink(existing: LinkedAccount[], incoming: LinkedAccount[]): boolean {
  if (existing.length === 0) return false;
  const masked = incoming.filter((a) => fold(a.mask) !== '');
  if (masked.length === 0) return true;
  return masked.some((i) =>
    existing.some((e) => fold(e.mask) === fold(i.mask) && fold(e.name) === fold(i.name))
  );
}
```

- [ ] **Step 4: Implement `accounts.ts` change**

```ts
export type AccountRow = {
  id: string;
  current_balance: number | null;
  /** On an archived (disconnected) Item: frozen, so never carried forward. */
  archived?: boolean;
};
```

In `buildSnapshotRows`, insert `.filter((a) => !a.archived)` before `.map`. Also extend the doc comment: "Archived banks' accounts are skipped: their balance is frozen, and Home no longer counts them. Their past rows stay."

- [ ] **Step 5: `sync.ts` — shared claim, exported `describeError`, snapshot query**

Export `describeError` (`export function describeError`). Replace the inline claim in `syncItem` with a call to a new exported function:

```ts
/**
 * Claim an Item for exclusive work — a sync or a disconnect. Atomic, survives
 * across HTTP calls, and self-heals when stale. Only a live Item can be
 * claimed, whatever list the caller loaded: a sync that finished after an
 * archive would otherwise write rows and set status back to 'active'.
 */
export async function claimItem(
  admin: SupabaseClient,
  itemId: string,
): Promise<{ id: string; sync_cursor: string | null } | null> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const { data } = await admin
    .from('plaid_items')
    .update({ sync_locked_at: new Date().toISOString() })
    .eq('id', itemId)
    .in('status', ['active', 'login_required'])
    .or(`sync_locked_at.is.null,sync_locked_at.lt.${staleBefore}`)
    .select('id, sync_cursor')
    .maybeSingle();
  return data;
}
```

In `syncItem`: `const claimed = await claimItem(admin, item.id);`. The cursor update gains `.in('status', ['active', 'login_required'])`, so even a sync that outlived the stale window cannot un-archive an Item. The snapshot block becomes:

```ts
const { data: allAccounts } = await admin
  .from('accounts').select('id, current_balance, plaid_items(status)').eq('user_id', item.user_id);
const snapshots = buildSnapshotRows(
  (allAccounts ?? []).map((a) => ({
    id: a.id,
    current_balance: a.current_balance,
    archived: (a.plaid_items as { status?: string } | null)?.status === 'archived',
  })),
  item.user_id,
);
```

- [ ] **Step 6: Run tests**

Run: `npx -y deno test supabase/functions/_shared/`
Expected: PASS — 54 existing + 15 connections + 1 accounts = 70.

- [ ] **Step 7: Commit** — `feat: disconnect and duplicate-link decisions; archived banks skip snapshots`

### Task 3: `disconnectItem` + `plaid-disconnect-item`

**Files:**
- Modify: `supabase/functions/_shared/connections.ts` (append the I/O)
- Create: `supabase/functions/plaid-disconnect-item/index.ts`

**Interfaces:**
- Consumes: `claimItem` and `describeError` (sync.ts), and `planDisconnect` and `isItemGone`.
- Produces: `disconnectItem(admin, plaid, item: { id: string; status: string }, mode: DisconnectMode): Promise<DisconnectResult>`, which throws on a database error. HTTP: `POST /functions/v1/plaid-disconnect-item { item_id, mode }` → 200 `{ ok: true }` | 400 | 401 | 404 | 409 | 502 | 500, with body `{ error: string }` on failure.

- [ ] **Step 1: Append to `connections.ts`**

```ts
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { PlaidApi } from 'npm:plaid@30';

import { claimItem, describeError } from './sync.ts';

/**
 * Disconnect one Item. Plaid first: local state changes only once
 * /item/remove succeeds or says the Item is already gone — the token is the
 * only way to stop the billing, so deleting it after a transient error would
 * leak a billed Item forever.
 */
export async function disconnectItem(
  admin: SupabaseClient,
  plaid: PlaidApi,
  item: { id: string; status: string },
  mode: DisconnectMode,
): Promise<DisconnectResult> {
  const plan = planDisconnect(item.status, mode);
  if (plan === 'noop') return 'ok';

  if (plan === 'delete_local') {
    // No claim needed: claimItem never claims an archived Item, so no sync can race this.
    const { error } = await admin.from('plaid_items').delete().eq('id', item.id).eq('status', 'archived');
    if (error) throw error;
    return 'ok';
  }

  if (!(await claimItem(admin, item.id))) return 'busy';
  const release = () => admin.from('plaid_items').update({ sync_locked_at: null }).eq('id', item.id);

  try {
    const { data: tokenRow, error: tokenError } = await admin
      .from('plaid_tokens').select('access_token').eq('item_id', item.id).maybeSingle();
    if (tokenError) throw tokenError;

    // No token: an earlier attempt already removed the Item at Plaid, then
    // crashed before archiving. Continue from where it stopped.
    if (tokenRow) {
      try {
        await plaid.itemRemove({ access_token: tokenRow.access_token });
      } catch (err) {
        if (!isItemGone(err)) {
          console.error(`item/remove failed for item ${item.id}: ${describeError(err)}`);
          await release();
          return 'plaid_failed';
        }
      }
    }

    if (plan === 'remove_then_delete') {
      // The cascade covers plaid_tokens, accounts, and through them
      // transactions, balance_snapshots and recurring_streams.
      const { error } = await admin.from('plaid_items').delete().eq('id', item.id);
      if (error) throw error;
      return 'ok';
    }

    // remove_then_archive. Status goes LAST: a crash before it leaves a live,
    // retryable Item whose next attempt finds no token (or ITEM_NOT_FOUND).
    const { error: tokenDeleteError } = await admin.from('plaid_tokens').delete().eq('item_id', item.id);
    if (tokenDeleteError) throw tokenDeleteError;

    const { data: accounts, error: accountsError } = await admin
      .from('accounts').select('id').eq('item_id', item.id);
    if (accountsError) throw accountsError;
    const accountIds = (accounts ?? []).map((a) => a.id);

    if (accountIds.length > 0) {
      // Dismissed or not: an archived Item never re-detects, so a dismissal has
      // nothing left to protect.
      const { error: streamsError } = await admin
        .from('recurring_streams').delete().in('account_id', accountIds);
      if (streamsError) throw streamsError;

      // Today's rows (UTC, the snapshot clock) still count this bank. Dropping
      // them makes the chart's last point equal Home's hero; earlier days keep it.
      const { error: snapshotError } = await admin
        .from('balance_snapshots').delete()
        .in('account_id', accountIds)
        .eq('date', new Date().toISOString().slice(0, 10));
      if (snapshotError) throw snapshotError;
    }

    const { error: archiveError } = await admin
      .from('plaid_items')
      .update({ status: 'archived', sync_cursor: null, sync_locked_at: null })
      .eq('id', item.id);
    if (archiveError) throw archiveError;
    return 'ok';
  } catch (err) {
    await release();
    throw err;
  }
}
```

Put the imports at the top of the file.

- [ ] **Step 2: Create `plaid-disconnect-item/index.ts`**

```ts
// Disconnect a bank: remove the Item at Plaid (which stops its billing), then
// either archive it — token gone, history kept — or delete everything.
// JWT-verified by default; the caller must own the Item.

import { type DisconnectMode, disconnectItem } from '../_shared/connections.ts';
import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, jsonResponse } from '../_shared/lib.ts';

type Body = { item_id?: unknown; mode?: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: Body = {};
  try {
    body = await req.json();
  } catch {
    // fall through to the field checks
  }
  // Validated as a UUID up front: PostgREST would otherwise answer 22P02, a 500.
  if (typeof body.item_id !== 'string' || !UUID.test(body.item_id)) {
    return jsonResponse({ error: 'item_id is required' }, 400);
  }
  if (body.mode !== 'archive' && body.mode !== 'delete') {
    return jsonResponse({ error: 'mode must be archive or delete' }, 400);
  }
  const itemId = body.item_id;
  const mode: DisconnectMode = body.mode;

  try {
    const { data: item, error: itemError } = await admin
      .from('plaid_items')
      .select('id, status')
      .eq('id', itemId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (itemError) throw itemError;
    if (!item) return jsonResponse({ error: 'Unknown bank connection' }, 404);

    const result = await disconnectItem(admin, getPlaidClient(), item, mode);
    if (result === 'busy') {
      return jsonResponse({ error: 'This bank is syncing — try again in a moment.' }, 409);
    }
    if (result === 'plaid_failed') {
      return jsonResponse({ error: "Plaid couldn't remove the connection; nothing was changed." }, 502);
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    console.error(`disconnect ${mode} failed for item ${itemId}`, err);
    return jsonResponse({ error: 'Could not disconnect the bank' }, 500);
  }
});
```

- [ ] **Step 3: Type-check and test**

Run: `npx -y deno check supabase/functions/plaid-disconnect-item/index.ts && npx -y deno test supabase/functions/_shared/`
Expected: no type errors; 70 pass.

- [ ] **Step 4: Deploy (sync first, because its claim changed)**

Run: `npx supabase functions deploy plaid-sync-transactions --use-api && npx supabase functions deploy plaid-webhook --use-api && npx supabase functions deploy plaid-disconnect-item --use-api`
Expected: all three deploy. `plaid-webhook` imports `syncItem`, so it needs the new claim too.

- [ ] **Step 5: Smoke test** — an unauthenticated POST gets 401. Run `curl -s -w '%{http_code}' -X POST "$URL/functions/v1/plaid-disconnect-item" -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -d '{}'`. Expect 401 from `getAuthedUser`: the anon key is not a user JWT.

- [ ] **Step 6: Commit** — `feat: plaid-disconnect-item — remove at Plaid, then archive or delete`

### Task 4: Duplicate guard in `plaid-exchange-token`

**Files:**
- Modify: `supabase/functions/plaid-exchange-token/index.ts`

**Interfaces:**
- Consumes: `isDuplicateLink` and `LinkedAccount`.
- Produces: body field `accounts?: { name?: string; mask?: string }[]`. On a duplicate: 409 `{ error: 'duplicate' }`, with no exchange.

- [ ] **Step 1: Implement.** Add `accounts?: LinkedAccount[]` to `ExchangeBody`. Import `isDuplicateLink`. Insert this before step 1, inside the `try`:

```ts
    // 0. Refuse a duplicate BEFORE the exchange, as Plaid advises: no access
    //    token is ever created, so nothing is billed. Only live Items count —
    //    an archived one must not lock the user out of re-adding that bank.
    //    Without an institution_id there is nothing to compare.
    if (body.institution_id) {
      const { data: existing, error: existingError } = await admin
        .from('accounts')
        .select('name, mask, plaid_items!inner(institution_id, status)')
        .eq('user_id', user.id)
        .eq('plaid_items.institution_id', body.institution_id)
        .in('plaid_items.status', ['active', 'login_required']);
      if (existingError) throw existingError;
      const incoming = Array.isArray(body.accounts) ? body.accounts : [];
      if (isDuplicateLink(existing ?? [], incoming)) {
        console.log(`duplicate link refused: user ${user.id}, institution ${body.institution_id}`);
        return jsonResponse({ error: 'duplicate' }, 409);
      }
    }
```

- [ ] **Step 2:** Run `npx -y deno check supabase/functions/plaid-exchange-token/index.ts`, then `npx supabase functions deploy plaid-exchange-token --use-api`.
- [ ] **Step 3: Commit** — `feat: refuse a duplicate bank link before the token exchange`

### Task 5: Client data — queries and Plaid hooks

**Files:**
- Modify: `apps/mobile/src/lib/queries.ts`
- Modify: `apps/mobile/src/lib/plaid.ts`

**Interfaces:**
- Produces:
  - `ItemStatus = 'active' | 'login_required' | 'archived'`, and `PlaidItem` gains `created_at: string`.
  - `useItemAccounts(itemId: string)` → `Account[]`, key `['accounts', itemId]`.
  - `useSetAccountHidden()` → mutation of `{ accountId: string; itemId: string; hidden: boolean }`.
  - `useDisconnectBank()` → `{ disconnect(itemId: string, mode: 'archive' | 'delete'): Promise<boolean>; isDisconnecting: boolean; error: string | null }`.
  - `readFunctionError(err: unknown): Promise<{ status?: number; message?: string }>`, internal to plaid.ts.

- [ ] **Step 1: `queries.ts`.**
  - `ACCOUNT_COLUMNS` const shared by both account queries.
  - `useAccounts` selects `${ACCOUNT_COLUMNS}, plaid_items!inner(status)` and adds `.neq('plaid_items.status', 'archived')`.
  - `PlaidItem.status: ItemStatus`, `created_at`.
  - `usePlaidItems` selects `created_at` too.

```ts
/**
 * Every account of one bank, hidden ones included — the bank screen is the one
 * place hidden accounts are listed, so they can be unhidden. Keyed under
 * ['accounts'] so every existing accounts invalidation covers it by prefix.
 */
export function useItemAccounts(itemId: string) {
  return useQuery({
    queryKey: ['accounts', itemId],
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase
        .from('accounts')
        .select(ACCOUNT_COLUMNS)
        .eq('item_id', itemId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data;
    },
  });
}

/** Keys whose rows `hidden` filters in SQL — every one must refetch after a toggle. */
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
```

- [ ] **Step 2: `plaid.ts`.** Add the helper and use it in `useSyncTransactions`, replacing its inline parse:

```ts
/** FunctionsHttpError carries the Response; its JSON body says what actually failed. */
async function readFunctionError(err: unknown): Promise<{ status?: number; message?: string }> {
  const response = (err as { context?: Response }).context;
  let message: string | undefined;
  try {
    const body = await response?.json();
    if (typeof body?.error === 'string') message = body.error;
  } catch {
    // non-JSON body; the caller keeps its own wording
  }
  return { status: response?.status, message };
}
```

`useConnectBank.onSuccess` sends `accounts: success.metadata.accounts.map(({ name, mask }) => ({ name, mask }))`. On `exchangeError`:

```ts
const { status, message } = await readFunctionError(exchangeError);
if (status === 409 && message === 'duplicate') {
  throw new Error(
    `${institution?.name ?? 'This bank'} is already connected. If it stopped syncing, use Reconnect in Settings.`,
  );
}
throw new Error('The bank responded, but saving the connection failed.');
```

Replace the six `invalidateQueries` calls in both hooks with a loop over `HIDDEN_DEPENDENT_KEYS` plus `['plaid_items']`: the same set, named once.

```ts
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
        const { message } = await readFunctionError(fnError);
        setError(message ?? 'Could not disconnect the bank. Try again in a moment.');
        return false;
      }
      await Promise.all(
        [['plaid_items'], ...HIDDEN_DEPENDENT_KEYS].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
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
```

- [ ] **Step 3:** Run `cd apps/mobile && npm run typecheck`. Expect it clean.
- [ ] **Step 4: Commit** — `feat: client hooks for hiding accounts, disconnecting, and duplicate links`

### Task 6: `/bank/[id]` screen

**Files:**
- Create: `apps/mobile/src/app/bank/[id].tsx`
- Modify: `apps/mobile/src/app/_layout.tsx` (register the screen)
- Modify: `apps/mobile/src/components/account-row.tsx` (`onPress` and `trailing` props)

**Interfaces:**
- Consumes: `usePlaidItems`, `useItemAccounts`, `useSetAccountHidden`, `useDisconnectBank`, `useConnectBank` and `useSandboxTools`.
- Produces: the route `/bank/[id]`, and `AccountRow({ account, onPress?, trailing?, dimmed? })`.

- [ ] **Step 1: `AccountRow`.** Wrap the row in a `Pressable` (disabled when there is no `onPress`, with the pressed background `colors.elevated`, as `RecurringRow` does). After the `Amount`, render `trailing`. `dimmed` sets `opacity: 0.5` on the name and amount block.
- [ ] **Step 2: `_layout.tsx`.** Add `<Stack.Screen name="bank/[id]" options={{ headerShown: true, title: '' }} />` next to `recurring`, inside the session-protected group, with a comment: "Pushed from Settings and Home's account rows; the page sets its own title."
- [ ] **Step 3: The screen.** Layout, top to bottom:
  - `<Stack.Title>{institution}</Stack.Title>`.
  - The status line (the spec table). `formatDay(created_at)` uses `toLocaleDateString(undefined, { month: 'short', day: 'numeric' })`, as `lib/recurring.ts` does.
  - A Reconnect button when `login_required`.
  - An Accounts card: a header row with "Accounts" on the left and "Show in Tusky" on the right. Each account is an `AccountRow` with `trailing={<Switch value={!a.hidden} accessibilityLabel={`Show ${a.name} in Tusky`} … />}`, and `dimmed` when archived.
  - The caption.
  - The `__DEV__` tools, when not archived.
  - The error text, from disconnect or connect.
  - A Disconnect or Delete-history button, with `loading={isDisconnecting}`.
  - When the item is missing and `usePlaidItems` is not loading, an `EmptyState` with the `Landmark` icon: "This bank is no longer connected".

The disconnect alert:

```ts
Alert.alert(`Disconnect ${name}?`, 'Tusky stops syncing it and removes the connection at Plaid.', [
  { text: 'Cancel', style: 'cancel' },
  { text: 'Delete everything', style: 'destructive', onPress: confirmDeleteEverything },
  { text: 'Keep history', onPress: () => run('archive') }, // last = Android's positive button
]);
```

`confirmDeleteEverything` asks `Alert.alert('Delete everything?', `Deletes its ${n} account${n === 1 ? '' : 's'} and all their transactions. This can't be undone.`, [Cancel, { text: 'Delete everything', style: 'destructive', onPress: () => run('delete') }])`. Delete history (archived) asks once, with the same message under the title `Delete ${name}'s history?`. `run(mode)` awaits `disconnect(id, mode)` and calls `router.back()` when it returns true.

- [ ] **Step 4:** Run `npm run typecheck && npx expo lint`. Metro must be running, so `.expo/types` includes `/bank/[id]` for typed routes.
- [ ] **Step 5: Commit** — `feat: bank screen — hide accounts, disconnect, delete history`

### Task 7: Settings and Home link to the bank screen

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/settings.tsx`
- Modify: `apps/mobile/src/app/(tabs)/index.tsx`

- [ ] **Step 1: Settings.**
  - `live = items.filter(i => i.status !== 'archived')` and `archived = items.filter(i => i.status === 'archived')`.
  - Each live item is a `Pressable` row that pushes `{ pathname: '/bank/[id]', params: { id: item.id } }`, with a `ChevronRight`.
  - The caption reads "Sign-in expired" only when `status === 'login_required'`, with the inline Reconnect kept.
  - The dev tools are removed from here (they moved to the bank screen), along with the `useSandboxTools` import.
  - A "Disconnected" caption heading lists the archived items as rows, dim icon, "History kept", that also push to the bank screen.
  - The empty state shows when `live.length === 0 && archived.length === 0`.
  - The connect label is `live.length === 0 ? 'Connect a bank' : 'Connect another bank'`.
- [ ] **Step 2: Home.** `<AccountRow account={account} onPress={() => router.push({ pathname: '/bank/[id]', params: { id: account.item_id } })} />`.
- [ ] **Step 3:** Run `npm run typecheck && npx expo lint`.
- [ ] **Step 4: Commit** — `feat: Settings and Home open the bank screen`

### Task 8: Verification on the emulator and linked DB

The duplicate Chase (09-23) that the spec meant to test "Delete everything" on no longer exists. As of 2026-09-24 the test user has Chase (09-20; 14 accounts, 53 transactions) and First Platypus (09-23, `user_transactions_dynamic`; 7 accounts, 349 transactions). The remove-then-delete and delete-local paths are tested on fresh Platypus links instead, and those links are cleaned up in the same pass.

- [ ] **Step 1: Regression pass** after the grants migration: the feed loads, recategorize one transaction and change it back, set and delete a budget, Reports loads, the Home chart draws, recurring dismiss and restore. Then run `node scripts/emu.mjs logs` and expect no errors.
- [ ] **Step 2: Hide/unhide.** Home → tap a Chase account row → the bank screen → switch off "Plaid Checking".
  - Expect it to leave Home (the hero changes), the feed, reports and the chart.
  - Then switch it back on, and expect everything restored.
  - SQL: `hidden` flips.
- [ ] **Step 3: Duplicate guard.** Settings → Connect another bank → First Platypus → `user_transactions_dynamic` / any password.
  - Expect "First Platypus Bank is already connected…" and no new `plaid_items` row.
- [ ] **Step 4: Keep history on First Platypus.** Settings → First Platypus → Disconnect → Keep history. Expect:
  - `status = 'archived'` and no `plaid_tokens` row;
  - 349 transactions still in the feed;
  - its 7 accounts gone from Home;
  - no snapshots dated today for it, so the chart's last point equals the hero;
  - no streams;
  - Settings lists it under Disconnected;
  - a sync's results omit it.
- [ ] **Step 5: Busy guard.** Link Platypus again (`user_transactions_dynamic`). It must be ALLOWED, because the archived Item does not block.
  - SQL: `update plaid_items set sync_locked_at = now() where id = '<new>'`.
  - Disconnect → Delete everything. Expect "This bank is syncing — try again in a moment." and nothing changed.
  - SQL: `update plaid_items set sync_locked_at = null where id = '<new>'`.
- [ ] **Step 6: Delete everything** on that new Platypus. Expect:
  - the row, accounts, transactions, snapshots and streams all gone;
  - the archived Platypus untouched.
- [ ] **Step 7: Delete history (delete_local).**
  - Link Platypus with `user_good` / `pass_good`. Its accounts are named differently, so it is allowed.
  - Disconnect it with Keep history, then Delete history.
  - Expect its row gone, with no Plaid call: the function log shows no `item/remove` error.
- [ ] **Step 8: Final.**
  - `npx -y deno test supabase/functions/_shared/`, and in `apps/mobile`: `npm run typecheck && npx expo lint`.
  - Re-run the Task 1 grants queries.
  - `node scripts/emu.mjs logs` should show no errors.

### Task 9: Docs and PR

**Files:**
- Modify: `README.md` (the Phase 6 status line)
- Modify: `CLAUDE.md`:
  - the grants convention now reads: defaults revoked, new tables get nothing until granted;
  - Phase 6 status;
  - the `plaid-disconnect-item` convention.
- Modify: the spec's status line
- Create: `docs/superpowers/plans/2026-09-24-phase-6-handoff.md`, covering what shipped, the verification results, and the key switch still pending with its exact remaining steps.

- [ ] **Step 1:** Write the docs. Commit: `docs: Phase 6 handoff`.
- [ ] **Step 2:** Push `pedro` and open the PR to `Kelvinluciano312/Tusky-App` `master`. Never merge it.
