# Phase 4 — Net worth history (design)

Status: approved 2026-09-22. Extends Phase 3.

Home has shown a net worth number since Phase 1, and its empty state has promised a trend line since
then: *"your trend line starts at your first connection."* Nothing in the schema ever recorded a
balance twice, so there was nothing to draw. This phase records it.

## Two bugs this phase fixes on the way

Investigating the sync path turned both up. Neither is a new regression; both have been there since
Phase 2.

1. **Balances are never refreshed.** `plaid-exchange-token` is the only writer of
   `accounts.current_balance`, so the number on Home is frozen at link time and pull-to-refresh
   updates the feed beneath a stale hero.
2. **A newly-opened account's first transactions are lost permanently.** `syncItem` builds
   `accountByPlaidId` from the database (`_shared/sync.ts:95-99`), drops any transaction whose account
   is not in it (`:163`), and then advances the cursor anyway (`:207-210`). Plaid never re-delivers an
   `added` item, so those rows are gone for good.

Refreshing accounts from Plaid *before* the map is built fixes both with one call.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| History depth | **Start recording now**, no backfill | See below |
| Snapshot shape | **One row per account per day** | `hidden` and `type` stay retroactive |
| Chart | Sparkline on Home under the hero | It explains the number it sits beneath |
| Cadence | **Sync-driven only** | No scheduler exists; adding one is real unattended infrastructure |

**Backfill was rejected on the merits.** Reconstructing balances by walking transactions backwards
works for checking and credit accounts. It is nonsense for investment accounts, which move by market
prices, and for loans, which move by interest and amortization — and those dominate the test user's
net worth. It would draw a confident line that never happened. The chart starts at first sync.

## Account refresh — `_shared/accounts.ts`

`syncAccounts(admin, plaid, accessToken, userId, itemId)` lifts the existing block from
`plaid-exchange-token/index.ts:64-86` verbatim: `plaid.accountsGet`, then upsert `accounts` on
`plaid_account_id`. Both `plaid-exchange-token` and `syncItem` call it. The **upsert** — rather than an
update — is what discovers newly-opened accounts, which is bug 2.

- **`/accounts/get` is not the billed endpoint.** `/accounts/balance/get` is the per-request one and
  remains uncalled. This is covered by the per-Item monthly subscription, consistent with
  `docs/product/monetization.md`.
- **It returns Plaid's *cached* balances**, refreshed on Plaid's own cadence (roughly daily). Syncing
  five times an hour will not move the number. For a daily snapshot that is a feature — the day's
  upsert converges rather than thrashing — but it must not be described as "live".
- **`hidden` must never enter the upsert payload.** PostgREST builds `DO UPDATE SET` only from the
  keys present, so omitting it preserves the user's choice. Adding `hidden: false` to "complete" the
  row would silently un-hide every hidden account on every sync and reshape the entire chart, because
  the view filters on it. Every other key keeps being emitted, nulls included — a ragged key set
  across array elements is `PGRST102`.

## Storage

```sql
create table public.balance_snapshots (
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null default current_date,
  balance numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  primary key (account_id, date)
);
create index balance_snapshots_user_date_idx on public.balance_snapshots (user_id, date);
```

RLS enabled with a **select-own policy only** and `grant select` alone — no insert/update/delete.
Snapshots are derived data written by the service role, following the `plaid_items` precedent.

- **No surrogate `id`.** This is a ledger, not an entity; nothing references a row and
  `(account_id, date)` is the natural key. It deviates from the repo's uuid-everywhere convention
  deliberately, to save a uuid and a second index on the highest-row-count table in the schema.
- **`date` is defaulted, not written.** One clock (Postgres, UTC), and the default resolves before
  `ON CONFLICT` arbitration — the same mechanism `budgets.user_id` already relies on. "Today" is UTC;
  there is no user timezone anywhere in this schema.
- **`balance` is `not null`, coalesced to 0 at write time.** The source column is nullable and Plaid
  returns `null` for some brokerage accounts. The write is one multi-row insert, so a single null
  would abort the whole day rather than one account. `?? 0` mirrors `signedBalance` exactly.

## Reading — `daily_net_worth`

```sql
create view public.daily_net_worth
with (security_invoker = on) as
select
  s.date,
  sum(case when a.type in ('credit', 'loan') then -s.balance else s.balance end) as net_worth
from public.balance_snapshots s
join public.accounts a on a.id = s.account_id
where s.user_id = (select auth.uid())
  and not a.hidden
group by s.date;
```

Same rules as `monthly_category_totals` and for the same reasons: `security_invoker = on` is the
entire security boundary, and the redundant `user_id` predicate makes a later `create or replace` that
loses the flag fail closed.

**Why per-account rows rather than one pre-summed net worth per day.** `hidden` is a client-toggled,
*retroactive* filter, and `type` can be corrected by Plaid. Joining both at read time means hiding an
account — or a subtype correction — fixes the entire history at once. Pre-summing would freeze them at
write time, and the chart would drift permanently out of agreement with Home's hero number. That
agreement is the feature's correctness test.

The `case when type in ('credit','loan')` is an exact mirror of `signedBalance`, including its
fall-through: both treat an unknown type as positive, so they diverge identically. Currency is ignored,
exactly as Home does, so the two agree.

## Completeness by construction

Every sync snapshots **every account belonging to the user**, not just the synced Item's, reading
`accounts.current_balance` after the refresh.

If only the synced Item's accounts got a row, a day where Item A synced and Item B did not would sum
to a partial net worth, and the chart would sawtooth. Snapshotting everything makes every date
complete, which is what lets the view be a plain `group by` with no carry-forward or lateral join.
Days with no sync at all have no rows — a gap, which is honest, rather than a false dip.

A `login_required` Item keeps its last good balance and is re-snapshotted daily — implicit carry
forward. That is the right behaviour (skipping it reintroduces the sawtooth) but the data is silently
stale; the Settings reconnect prompt is the mitigation.

Concurrency is reachable: the sync claim is per-Item, and the webhook path runs `syncItem` inside
`EdgeRuntime.waitUntil`, so two Items of one user can snapshot at once. `primary key (account_id, date)`
plus upsert makes that last-writer-wins per row rather than corrupting a day. Rows are **sorted by
`account_id`** before the insert so two concurrent invocations take row locks in the same order and
cannot deadlock.

## Placement in `syncItem`

Both insertions get **their own try/catch that logs and never rethrows**. The isolation is
load-bearing: the outer catch converts any throw into `status: 'error'`, which the client surfaces as
"Sync failed" — wrong for a sync whose transactions committed fine.

**The refresh goes before the account-map select**, because that is what fixes bug 2. Its errors are
swallowed and fall through: `transactionsSync` throws the same `ITEM_LOGIN_REQUIRED` moments later,
where the single classifier handles it exactly once. Letting it propagate instead would record
`status: 'error'` *without* ever setting `login_required`, so Settings would never show Reconnect — and
a `RATE_LIMIT_EXCEEDED` or `INSTITUTION_DOWN` on the balance call would fail an otherwise-good sync.
**The refresh never writes `plaid_items.status`**; `transactionsSync` stays the sole authority on it.

**The snapshot goes last inside the outer `try`, after the cursor advance and after `result` is set.**
After the cursor, so a failed chart row can never cost a full 90-day re-pagination. After `result`, so
success is already latched. **Not in `finally`** — that runs on the `login_required` and `error` paths
too, and a throw there would escape `syncItem` entirely, breaking the "never throws" contract both
callers depend on.

## Client

`useNetWorthHistory(from, to)` keyed `['net_worth', from, to]`, mirroring the `['reports', from, to]`
prefix convention, invalidated wherever `['accounts']` is.

- **`.order('date', { ascending: true })` is mandatory.** The view has no ordering, `group by` yields
  an arbitrary aggregate order, and PostgREST adds no default. A `<Polyline>` fed unordered rows draws
  a scribble. `useMonthlyTotals` survives without it only because `buildCashFlow` rebuilds from its own
  month list.
- **The window is capped explicitly** at 90 days with a `.limit(400)`. `max_rows = 1000` truncates
  *silently* — supabase-js does not surface `Content-Range` — and under ascending order truncation
  drops the newest points, freezing the chart weeks in the past with no error anywhere.

The sparkline is a `<Polyline>` sized by explicit props, as the donut is. It guards `max === min` (a
new user whose one balance has not moved) or `(v - min) / (max - min)` is `NaN` and nothing renders.
Points are spaced evenly by index, so a gap in syncing reads as one step rather than a flat stretch —
acceptable for a sparkline. It renders nothing below two points, leaving today's copy in place.

Connecting a bank creates a step: a new account has no rows for prior dates, so the line jumps on
connection day. Unavoidable without backfill, and arguably correct, but worth saying out loud.
