# Phase 2 — Transaction sync and categorized feed

Status: approved design, not yet implemented
Date: 2026-09-20
Branch: `feature/mobile-app`

## Context

Phases 0–1 gave Tusky an Expo app, Supabase auth, and Plaid Link: a user can connect a
sandbox bank and see accounts and net worth on Home. Nothing yet reads transactions, and
`transactions.tsx`, `budgets.tsx` and `reports.tsx` are 21-line `EmptyState` stubs.

Phase 2 makes the app useful: pull transactions from Plaid, categorize them, and show them
in a feed the user can correct.

Tusky is modelled closely on Monarch Money. Where a decision below has no strong technical
argument either way, it follows Monarch's convention. The intended differentiator is
community-informed categorization — and `transactions.category_is_manual` is its seed: every
manual correction a user makes is a labelled example. That is why the override behaviour is
a hard requirement rather than a nicety, and why it is enforced in one place rather than
trusted to call sites.

Groundwork already exists: `plaid_items.sync_cursor` is in the Phase 1 schema, marked
"Phase 2".

## Scope

**In:** the sync engine, the transactions table and taxonomy, the feed UI, and changing a
transaction's category.

**Out, in this order of likely arrival:** webhook-driven sync (Phase 2.5 — see Deferred),
then search and filtering, then budgets and reports (Phase 3).

Sync is triggered by pull-to-refresh and once automatically after a bank is connected.

## Schema

One migration, three tables. All follow the Phase 1 conventions: RLS enabled, explicit
grants to `authenticated`, `set_updated_at` trigger where the table is mutable.

### `categories`

The curated taxonomy, ~14 rows seeded in the migration. Global rather than per-user: a
shared vocabulary is a precondition for the community-categorization feature, and
user-defined categories are a later concern.

```
id          uuid pk
slug        text unique        -- 'food_and_dining'
name        text               -- 'Food & Dining'
kind        text               -- 'income' | 'expense' | 'transfer'
icon        text               -- lucide-react-native icon name
color       text               -- value from src/constants/theme.ts
sort_order  int
```

`kind` exists so Phase 3 aggregates are correct from the start. Monarch separates income,
expense and transfer at the top level, and without that split a credit-card payment counts
as spending. PFC v2 gives us `INCOME`, `TRANSFER_IN` and `TRANSFER_OUT` primaries, so `kind`
is free to populate at seed time — and expensive to backfill once a user has seen the rows.

RLS: `select` to `authenticated`, no client writes.

### `plaid_category_map`

```
pfc_primary  text pk           -- 'FOOD_AND_DRINK'
category_id  uuid -> categories(id)
```

Seeded with the 16 PFC v2 primaries. A separate table rather than a column on `categories`
because the mapping is many-to-one — several primaries collapse into one category. Any PFC
value not present falls back to the `uncategorized` row, so an unrecognised category can
never drop a transaction.

### `plaid_items` — one added column

```
sync_locked_at  timestamptz      -- null when free; set while a sync holds the item
```

See "Concurrency" below for why this is a claimed row rather than an advisory lock.

### `transactions`

```
id                    uuid pk
user_id               uuid -> auth.users(id) on delete cascade
account_id            uuid -> accounts(id) on delete cascade
item_id               uuid -> plaid_items(id) on delete cascade
plaid_transaction_id  text unique
name                  text
merchant_name         text
logo_url              text
amount                numeric(14,2)     -- SIGN INVERTED, see below
iso_currency_code     text default 'USD'
date                  date
datetime              timestamptz
pending               boolean default false
pending_transaction_id text
payment_channel       text
pfc_primary           text
pfc_detailed          text
pfc_confidence        text
category_id           uuid -> categories(id)
category_is_manual    boolean default false
created_at            timestamptz
updated_at            timestamptz
```

Indexes: `(user_id, date desc)` for the feed, plus `account_id` and `item_id`.

**Sign convention.** Plaid returns `amount` positive for outflow. We invert on ingest, so
positive is money in and negative is money out. This matches Monarch's display convention
and makes every Phase 3 aggregate a plain `SUM()` with no per-query sign handling. The cost
is one documented transformation at the boundary; the alternative pushes the trap into every
future query.

Raw `pfc_*` fields are stored alongside the resolved `category_id` so re-categorization never
requires re-syncing from Plaid.

**Grants.** Mirrors the `accounts` pattern (`grant update (hidden)`):

```sql
grant select on public.transactions to authenticated;
grant update (category_id, category_is_manual) on public.transactions to authenticated;
```

A client can recategorize but cannot rewrite an amount, date or merchant. RLS policies use
`(select auth.uid()) = user_id` for both select and update.

## Sync engine

New Edge Function `supabase/functions/plaid-sync-transactions/index.ts`, reusing
`getAdminClient`, `getAuthedUser`, `getPlaidClient` and `jsonResponse` from `_shared/lib.ts`.

It must be an Edge Function: `plaid_tokens` is service-role-only, so the app can never call
Plaid directly. The client invokes it with no arguments; the function resolves the caller's
active items itself.

### Per-item flow

1. Claim the item (see Concurrency). If the claim fails, skip it — another sync holds it.
2. Read `sync_cursor` and retain it as `startCursor`.
3. Loop `/transactions/sync` while `has_more`, accumulating `added` / `modified` / `removed`.
4. Apply the accumulated batch: upsert `added` + `modified`, then delete `removed` (see Atomicity).
5. Write `next_cursor`.
6. Release the claim (`sync_locked_at = null`).

`count: 500` (the maximum) to minimise round trips. On an item's first sync, pass
`options.days_requested: 90`.

**Do not** pass `options.transactions_url_taxonomy`. The design originally pinned it to `v2`,
because accounts enabled for Transactions before 2025-12-03 default to v1 while later ones are
v2-only, and a Sandbox/Production mismatch would silently change the taxonomy the category map is
built on. Verified against the live API: `plaid@30` pins a `Plaid-Version` that does not know the
field, and the request fails with `UNKNOWN_FIELDS`. The account's default taxonomy therefore
applies, and the `uncategorized` fallback absorbs any unmapped primary. Revisit if the Plaid SDK
is upgraded.

### Failure modes

- **`TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`** — restart the loop from `startCursor`,
  not from the page that failed, capped at 3 attempts. This is why the cursor is committed
  once at the end rather than per page: a partial commit leaves the cursor pointing into a
  page sequence that no longer exists.
- **`ITEM_LOGIN_REQUIRED`** — set `plaid_items.status = 'login_required'` and skip the item.
  The `status` column already exists for this. Do not fail the whole run.
- **Pending to posted** — Plaid sends the pending transaction in `removed` and the posted one
  in `added`, with a *different* `transaction_id`. Deleting by `plaid_transaction_id` handles
  this correctly, which is why `removed` must be applied and not ignored.
- **Concurrent syncs** — pull-to-refresh overlapping a future webhook would interleave cursor
  writes and lose transactions. See Concurrency below.
- **Partial item failure** — one bank being down must not block the others. Return per-item
  results; the UI reports what synced.

### Atomicity

PostgREST cannot span statements, so the batch in step 4 is several calls, not one database
transaction. That is safe here, because of how steps 4 and 5 are ordered:

- Every operation is idempotent. Upserts key on `plaid_transaction_id`; deletes are by the same
  key and tolerate a missing row.
- `next_cursor` is written only after the batch fully succeeds. A crash partway through leaves
  `sync_cursor` at `startCursor`, so the next run re-fetches the same window and re-applies it
  over itself with no duplicates and no loss.

The failure mode this leaves is a transient one: between a partial apply and the next sync, the
feed can show some of a page's changes but not all. It self-corrects on the next run and no data
is lost.

If that window ever becomes unacceptable — it would matter more once webhooks make syncs
frequent — replace step 4 with a single `apply_transaction_sync(p_item_id, p_added, p_modified,
p_removed)` Postgres function taking JSON arrays, which gets real atomicity in one round trip.
Not worth the indirection for Phase 2's pull-to-refresh.

### Concurrency

**Not** `pg_advisory_lock`. Advisory locks are session-scoped, and supabase-js reaches Postgres
through PostgREST over stateless HTTP — each call is a separate session, so the lock would be
released the moment the RPC returned. The sync loop cannot be wrapped in a single transaction
either, because it spans multiple HTTP round trips to Plaid.

Instead the item is claimed with a conditional update, which is atomic and survives across calls:

```sql
update public.plaid_items
   set sync_locked_at = now()
 where id = $1
   and (sync_locked_at is null or sync_locked_at < now() - interval '5 minutes')
returning id;
```

No row returned means another sync holds the item, so this run skips it. The staleness interval
makes the claim self-healing: an Edge Function that dies mid-loop cannot deadlock the item
permanently. Release by setting `sync_locked_at = null` in a `finally`, so a thrown error still
frees it.

The column is service-role only — no client grant — so it needs no RLS policy of its own.

### The override rule

On upsert, `on conflict (plaid_transaction_id)` keeps the existing `category_id` when
`category_is_manual` is true, and otherwise sets it from `plaid_category_map`. Enforced in
the conflict clause so no call site can bypass it.

## App layer

### Data (`src/lib/queries.ts`)

- `useTransactions()` — infinite query using **keyset pagination on `(date, id)`, not
  `OFFSET`**. Sync inserts rows while the user scrolls; with offset pagination every
  insertion shifts subsequent pages, producing duplicates and skipped rows. The
  `(user_id, date desc)` index serves the keyset directly.
- `useCategories()` — plain query, long `staleTime`; the taxonomy is static between
  migrations.
- `useSetTransactionCategory()` — sets `category_id` and `category_is_manual = true`, with an
  optimistic update. A direct PostgREST write, not an Edge Function: no Plaid secret is
  involved, and the column grants above already constrain it.

### Sync (`src/lib/plaid.ts`)

`useSyncTransactions()` invokes the Edge Function and on success invalidates `['transactions']`
and `['accounts']` — a sync refreshes balances too. Called on pull-to-refresh, and once after
`useConnectBank` succeeds so a newly linked bank populates without a manual pull.

### UI

- `src/app/(tabs)/transactions.tsx` — `SectionList`, one section per date, `refreshing` wired
  to the sync mutation, `onEndReached` to `fetchNextPage`. Existing `EmptyState` retained for
  the empty case.
- `src/components/transaction-row.tsx` — merchant logo via `expo-image` falling back to the
  category icon, name, category chip, `Amount` on the right.
- `src/components/category-picker.tsx` — modal list grouped by `kind`, opened by tapping a row.

All amounts render through `Amount`, all text through `AppText`, all colour and spacing from
`theme.ts`, per CLAUDE.md.

## Testing and verification

The repo has no test framework and this phase does not add one.

Two branches justify a pinned test: PFC→category resolution including the unmapped fallback,
and the override rule. Extract both as pure functions in `supabase/functions/_shared/` and
cover them with a `Deno.test` file — Deno's runner is built in, so this costs one file and no
dependency.

Everything else is covered by `npm run typecheck && npx expo lint` (both required before
commit) plus manual verification on device.

**On-device verification.** A Pixel 10 Pro is paired over wireless adb, so verification is
observable rather than assumed:

```sh
cd apps/mobile && npx expo start --dev-client
adb reverse tcp:8081 tcp:8081
adb shell am start -a android.intent.action.VIEW \
  -d "exp+tusky://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
adb logcat -d | grep -iE "FATAL|ReactNativeJS.*Error"
```

End-to-end: connect a sandbox bank (`user_good` / `pass_good`), confirm transactions appear
date-grouped with categories; change a category and pull to refresh, confirming the override
survives; confirm expenses render negative and income positive.

Backend checks:

```sh
npx supabase db push
npx supabase functions deploy plaid-sync-transactions --use-api
```

Sync idempotency: run the sync twice with no new bank activity and confirm the second run
adds nothing and leaves the cursor advanced but stable.

## Deferred

- **Webhooks (Phase 2.5).** `TRANSACTIONS` webhooks calling the same per-item routine with an
  `item_id`. The design is already shaped for it: the per-item flow is the reusable unit, and
  the advisory lock is what makes a webhook safe to overlap with a pull-to-refresh. Sandbox
  requires `/sandbox/item/fire_webhook` to trigger one.
- **Search and filtering.** Wanted, and additive: a trigram or `tsvector` index on `name` and
  `merchant_name` is a later `CREATE INDEX` with no schema change.
- **Category groups.** Monarch nests categories under groups. Deferred because Phase 2 only
  renders a chip, and adding it later is `alter table categories add column group_id` with
  `transactions.category_id` untouched.
- **Split transactions, notes/tags, bulk recategorization, recurring detection.** Monarch has
  all of them; none are needed to prove the sync-and-categorize loop.
