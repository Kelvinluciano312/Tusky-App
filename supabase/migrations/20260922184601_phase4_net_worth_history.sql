-- Phase 4: a balance per account per day, and the net worth series built from it.

-- One row per account per day.
--
-- Per-account rather than one pre-summed net worth per day, which would be
-- narrower and simpler: `hidden` is a client-toggled RETROACTIVE filter, and
-- `type` can be corrected by Plaid. Joining both at read time means hiding an
-- account, or a subtype correction, fixes the entire history at once. Pre-summing
-- freezes them at write time and the chart drifts permanently out of agreement
-- with Home's hero number — and that agreement is this feature's correctness test.
create table public.balance_snapshots (
  -- No surrogate id, deviating from the repo's uuid-everywhere convention on
  -- purpose: this is a ledger rather than an entity, nothing references a row,
  -- and (account_id, date) is the natural key. Saves a uuid and a second index
  -- on what will be the highest-row-count table in the schema.
  account_id uuid not null references public.accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Defaulted so the writer never names it: one clock (Postgres, UTC), and the
  -- default resolves before ON CONFLICT arbitration — the same mechanism
  -- budgets.user_id relies on. "Today" is UTC; there is no user timezone here.
  date date not null default current_date,
  -- not null, coalesced to 0 by the writer to mirror signedBalance's `?? 0`.
  -- accounts.current_balance is nullable and Plaid returns null for some
  -- brokerage accounts; the write is one multi-row insert, so a single null
  -- would abort a whole day rather than one account.
  balance numeric(14, 2) not null,
  created_at timestamptz not null default now(),
  -- Doubles as the upsert conflict target. Two Items of one user can snapshot
  -- concurrently (the sync claim is per-Item and the webhook path runs inside
  -- EdgeRuntime.waitUntil), so this is what makes a repeat last-writer-wins per
  -- row instead of corrupting a day.
  primary key (account_id, date)
);

-- The read path: every query filters user_id and ranges over date. The primary
-- key is on (account_id, date) and serves neither.
create index balance_snapshots_user_date_idx on public.balance_snapshots (user_id, date);

alter table public.balance_snapshots enable row level security;

-- Derived data: the service role writes it, clients only read. Same shape as
-- plaid_items — a select policy and a select grant, and nothing else.
create policy "Users can view their own balance history"
  on public.balance_snapshots for select
  using ((select auth.uid()) = user_id);

grant select on public.balance_snapshots to authenticated;

-- Net worth per day.
--
-- Same rules as monthly_category_totals, for the same reasons: security_invoker
-- is the entire security boundary (views cannot have RLS, and without the flag
-- this runs as its owner, who is exempt from the base tables' RLS), and the
-- redundant user_id predicate makes a later create-or-replace that loses the
-- flag fail closed rather than leak.
--
-- The case expression mirrors signedBalance in the app exactly, including its
-- fall-through: both treat an unknown type as positive, so they diverge
-- identically. Currency is summed across, exactly as Home does, so the chart and
-- the hero number agree.
--
-- No carry-forward is needed because every sync snapshots ALL of the user's
-- accounts, so each date is complete by construction. A day with no sync has no
-- rows at all — a gap, not a false dip.
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

grant select on public.daily_net_worth to authenticated;
