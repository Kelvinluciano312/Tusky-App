# Phase 3 — Budgets and cash-flow reports (design)

Status: approved 2026-09-22. Extends Phase 2; supersedes nothing.

Phase 2 shipped a categorized transaction feed. `categories.kind` (`income`/`expense`/`transfer`) was
added there *specifically* so Phase 3 aggregates would be correct from the first commit — without it a
credit-card payment counts as spending. This is the phase that spends that groundwork.

It also gives the repo three things it has never had: an **aggregation layer**, its **first
client-writable table** (everything else is select-only plus two column-scoped updates), and its
**first chart**.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Scope | Budgets and reports together, budgets first | They share one aggregation layer; designing it twice is the only alternative |
| Budget model | **One amount per category, applied to every month** | No month picker in the editor, no empty-month problem. Per-month overrides stay cheap to add later |
| Reports v1 | Spending-by-category donut (one month) + income-vs-expense bars (6 months) | The two questions a budget screen raises: where did it go, and am I net positive |
| Charts | Hand-rolled on `react-native-svg` | Already a dependency (lucide's peer). A chart library brings default styling that fights the theme, and victory-native would add a native module to a project where every build is hard-won |

**Out of scope, deliberately:** net worth over time (no balance history exists — `current_balance` is
only ever written by `plaid-exchange-token`, so it is a stale snapshot from link time), category
groups (`categories.group_id`, purely additive later), rollover, per-month overrides, custom
categories, and anything touching tier limits.

## Aggregation: one `security_invoker` view

```sql
create view public.monthly_category_totals
with (security_invoker = on) as
select
  date_trunc('month', t.date::timestamp)::date as month,
  t.category_id,
  t.iso_currency_code,
  sum(t.amount)  as total,          -- ledger sign: expenses are NEGATIVE
  count(*)::int  as transaction_count
from public.transactions t
join public.accounts a on a.id = t.account_id
where t.user_id = (select auth.uid())
  and not a.hidden
group by 1, 2, 3;

grant select on public.monthly_category_totals to authenticated;
```

A view rather than an Edge Function or an RPC: the client already talks to PostgREST directly for
every table read, so `.from('monthly_category_totals').gte('month', ...)` needs no new pattern, no new
deploy step, and no service-role code path. No secret is involved — this is the user's own data under
their own RLS.

Four properties are load-bearing. None may be "simplified" away:

- **`security_invoker = on` is the entire security boundary.** Views cannot have RLS of their own
  (`alter view ... enable row level security` is an error). Without the flag the view runs as its
  owner, `postgres`, who owns both base tables — and RLS does not apply to a table's owner unless
  `force row level security` is set. It would leak every user's data and raise no error. The flag is
  also per-view and **not inherited** by any future view built on top of this one.
- **`where t.user_id = (select auth.uid())` is a deliberate second lock, not redundancy.** It costs
  nothing — the planner folds it into the same `Index Cond` the RLS policy generates — and it makes a
  later `create or replace view` that drops the flag fail closed instead of leaking. The `(select ...)`
  wrapper is what makes it an InitPlan constant, so `transactions_feed_idx (user_id, date desc,
  id desc)` is used; same reason `CLAUDE.md` mandates that form in policies.
- **`t.date::timestamp`, not bare `t.date`.** There is no `date_trunc(text, date)` overload. A bare
  `date` resolves to the `timestamptz` overload (`timestamptz` is the preferred type in category `D`),
  which is `STABLE`, not `IMMUTABLE`. Values still come out right under `TimeZone = UTC`, but the
  expression can then never be indexed, and it misreads from a psql session in a local timezone.
  `date_trunc(text, timestamp)` is `IMMUTABLE`. Check with
  `select pg_typeof(date_trunc('month', current_date));`
- **`grant select` is mandatory.** `supabase/config.toml:19-24` confirms `auto_expose_new_tables` is
  unset, so a new view is not reachable by `authenticated` without it. `security_invoker` additionally
  requires the caller to hold `select` on `transactions` and `accounts` — both already granted. If
  `transactions` is ever narrowed to column-level grants, this view breaks with `permission denied`.

`iso_currency_code` sits in the `group by` so a multi-currency user becomes a client-side fix rather
than a migration. v1 sums across it, the same single-currency assumption net worth already makes.

The view keeps the **natural ledger sign** and is deliberately **kind-agnostic**. Bucketing into
income/expense/transfer happens in the client against `useCategories()`, already cached with a one-hour
`staleTime`. That keeps the view reusable and puts the one sign flip in one client function.

**No index is added.** The month filter lands as a `Filter`, not an `Index Cond` — Postgres will not
rewrite `date_trunc('month', date) >= ...` into `date >= ...` — so every report index-scans the user's
rows by `user_id` and hash-aggregates. At personal-finance volume that is milliseconds, and a 6-month
chart reads nearly all those rows anyway. If it ever measures badly, the fix is a `stable security
invoker` SQL function taking a `date` range (which *can* prune on `transactions_feed_idx`), not an
index on the computed month.

## Budgets table

```sql
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id),
  amount numeric(14, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id)
);
```

RLS enabled, four policies (select / insert / update / delete) all on `(select auth.uid()) = user_id`
with `with check` on insert and update, the existing `set_updated_at` trigger, and an explicit
`grant select, insert, update, delete on public.budgets to authenticated`.

- **`amount` is always positive** — it is what you intend to spend, not a signed ledger entry. The
  view's totals are negative for expenses. Exactly one client helper does the flip.
- **`default auth.uid()`** lets the client omit `user_id` entirely, preserving the repo-wide convention
  that no client query ever mentions it. RLS `with check` is what actually enforces it.
- **`unique (user_id, category_id)`** is the whole model — one amount per category, every month — and
  its index doubles as the lookup index. No other index.
- The client upserts with `onConflict: 'user_id,category_id'`. PostgREST builds the insert column list
  from the payload keys only, so an omitted `user_id` takes the column default rather than `NULL`, and
  Postgres resolves defaults *before* conflict arbitration. Because `user_id` is part of the key, a
  conflict can only ever be with the caller's own row. Corollary: never put `user_id` into one object
  of a batch payload — supabase-js `defaultToNull: true` would then null it for the others.
- Nothing at the DB level stops a budget on an `income` or `transfer` category — a `CHECK` cannot read
  another table. The picker only offers expense categories, which is sufficient.

Upgrade path if per-month overrides are wanted later: add a nullable `month` column (instant) and swap
the unique index for `unique nulls not distinct (user_id, category_id, month)`. Cheap, so YAGNI holds.

## Client

- `src/lib/month.ts` — `monthStart`, `addMonths`, `monthLabel`, `currentMonthStart`. Month values are
  always `'YYYY-MM-01'` strings. No date library: none exists in this repo and this is not the phase to
  add one. Parsing uses the existing `T00:00:00` suffix idiom, which forces local time over UTC.
- `src/lib/reports.ts` — pure functions, no React, so the sign and kind rules live in one place:
  `spentFor(total)` returns `-total` (**the only negation in the codebase**); `bucketByKind`, which
  **excludes transfers**; `buildCashFlow`, which fills gaps from the month list because a month with no
  transactions produces no row at all; `buildCategorySlices`.
- `src/lib/queries.ts` — `useMonthlyTotals(from, to)` keyed **`['reports', from, to]`** (the first
  parameterized key in the repo; the `'reports'` prefix means one invalidation covers every range),
  plus `useBudgets`, `useSetBudget`, `useDeleteBudget`.

**Transfers must be excluded from cash flow.** A transfer between two linked accounts nets to zero, but
a transfer to an *unlinked* external account is a one-legged negative row that renders as an expense.
This is the whole reason `kind` exists.

**`['reports']` must be added to all three existing invalidation sites** — bank connected and sync in
`plaid.ts`, and `useSetTransactionCategory`'s `onSettled`. Otherwise recategorizing a transaction moves
the feed and leaves the budget bar stale: a bug that only shows up on a device.

Pending transactions are included, matching the feed. They cannot double-count: Plaid delivers the
pending row in `removed` when it posts, and `_shared/sync.ts` deletes on `removed`. A pending amount
can still change on posting (restaurant tips), so budget numbers move — deliberate, not a bug.

## Screens

Both keep the app's screen shell (`flex: 1`, `colors.bg`, `paddingTop: insets.top`) and render their
own `<AppText variant="display">` title — no screen in this app uses a header. Section labels use the
existing uppercase dim-caption idiom. Errors render inline as `tone="negative"` captions, never alerts.

**Budgets:** month stepper → summary card (Budgeted / Spent / Remaining) → budgeted categories with
progress bars → every remaining expense category under `NOT BUDGETED`, spend-first, tap to set. That
last section is the discovery path, and it is why there is no "add budget" button or blank form.

**Reports:** one `useMonthlyTotals` call over a fixed 6-month window ending at the current month feeds
both sections — cash-flow bars across the window, then a donut and ranked list for the month chosen
with the same stepper, bounded to that window. One query, one range.

Progress bars and cash-flow bars are plain `View`s with percentage dimensions; only the donut needs
SVG, drawn as one `<Circle>` per slice with `strokeDasharray`/`strokeDashoffset` inside a
`<G rotation={-90}>` — arc geometry with no path math.

Slice and bar colours come from `categories.color`, which the Phase 2 migration documents as the single
source of truth for category colour. `theme.ts` has no chart tokens on purpose and `gold` is reserved.
