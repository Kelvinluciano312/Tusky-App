-- Phase 3: budgets and the monthly aggregation both budgets and reports read from.

-- Monthly totals per category, for budgets and reports alike.
--
-- security_invoker = on is the ENTIRE security boundary here. Views cannot have
-- RLS of their own; without the flag this runs as its owner (postgres), who owns
-- both base tables, and RLS does not apply to a table's owner — it would leak
-- every user's data and raise no error. The flag is per-view and is NOT inherited
-- by anything built on top of this.
--
-- The user_id predicate is a deliberate second lock, not redundancy: it costs
-- nothing (the planner folds it into the same Index Cond the RLS policy makes)
-- and it means a future `create or replace view` that loses the flag fails closed.
-- `(select auth.uid())` rather than bare `auth.uid()` is what makes it an InitPlan
-- constant, so transactions_feed_idx (user_id, date desc, id desc) is used.
--
-- `t.date::timestamp` is required, not decorative: there is no date_trunc(text,
-- date) overload, and a bare date resolves to the timestamptz one, which is
-- STABLE rather than IMMUTABLE — right answers under UTC, but never indexable.
--
-- Sign is left natural (expenses negative) and kind is left out on purpose: the
-- client buckets income/expense/transfer against the already-cached categories.
create view public.monthly_category_totals
with (security_invoker = on) as
select
  date_trunc('month', t.date::timestamp)::date as month,
  t.category_id,
  t.iso_currency_code,
  sum(t.amount)  as total,
  count(*)::int  as transaction_count
from public.transactions t
join public.accounts a on a.id = t.account_id
where t.user_id = (select auth.uid())
  and not a.hidden
group by 1, 2, 3;

-- Required: auto_expose_new_tables is unset, so nothing new is reachable without
-- this. security_invoker also needs the caller to hold select on transactions and
-- accounts — both already granted in earlier migrations.
grant select on public.monthly_category_totals to authenticated;

-- One amount per category, applied to every month. No per-month rows, no rollover.
-- Adding overrides later stays cheap: a nullable `month` column plus
-- `unique nulls not distinct (user_id, category_id, month)`.
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  -- default auth.uid() keeps the client from ever naming user_id, matching every
  -- other query in the app. The with-check policies are what actually enforce it.
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id),
  -- Major units, same scale as transactions.amount, but always POSITIVE: a budget
  -- is what you intend to spend, not a signed ledger entry. 0 is a no-spend goal.
  amount numeric(14, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The model itself. Its index doubles as the lookup index — add no other.
  unique (user_id, category_id)
);

create trigger budgets_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

alter table public.budgets enable row level security;

-- The first client-writable table in the repo: every other one is select-only
-- plus a column-scoped update. A policy per command, using + with check on both
-- write paths, so an upsert's insert and update halves are each covered.
create policy "Users can view their own budgets"
  on public.budgets for select
  using ((select auth.uid()) = user_id);

create policy "Users can create their own budgets"
  on public.budgets for insert
  with check ((select auth.uid()) = user_id);

create policy "Users can change their own budgets"
  on public.budgets for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own budgets"
  on public.budgets for delete
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.budgets to authenticated;
