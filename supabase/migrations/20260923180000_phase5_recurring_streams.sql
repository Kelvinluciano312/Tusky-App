-- Phase 5: recurring streams — bills, subscriptions and paychecks that come back.

-- One row per (account, direction, merchant), written by the service role at
-- the end of each sync (_shared/recurring.ts). Per-account, so the per-Item
-- sync claim means no two invocations ever write the same row.
create table public.recurring_streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  merchant_key text not null,
  direction text not null check (direction in ('outflow', 'inflow')),
  name text not null,
  category_id uuid references public.categories (id),
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  -- Ledger sign, as in transactions.amount: negative = money out.
  average_amount numeric(14, 2) not null,
  last_amount numeric(14, 2) not null,
  previous_amount numeric(14, 2) not null,
  -- |last| − |previous|; set only when a fixed price moved.
  amount_change numeric(14, 2),
  first_date date not null,
  last_date date not null,
  next_date date not null,
  occurrences int not null check (occurrences >= 3),
  -- The user's verdict. Detection NEVER writes it: the upsert payload omits
  -- the key, and PostgREST's DO UPDATE SET only covers keys present — the same
  -- rule that protects accounts.hidden.
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The upsert conflict target.
  unique (account_id, direction, merchant_key)
);

-- The read path: every client query filters user_id and orders by next_date.
create index recurring_streams_user_next_idx on public.recurring_streams (user_id, next_date);

create trigger recurring_streams_updated_at
  before update on public.recurring_streams
  for each row execute function public.set_updated_at();

alter table public.recurring_streams enable row level security;

create policy "Users can view their own recurring streams"
  on public.recurring_streams for select
  using ((select auth.uid()) = user_id);

create policy "Users can dismiss their own recurring streams"
  on public.recurring_streams for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select on public.recurring_streams to authenticated;
-- Column-level: a client may dismiss or restore, never rewrite what was detected.
grant update (dismissed) on public.recurring_streams to authenticated;
