-- Phase 1: Plaid items, access tokens, and accounts.
-- Access tokens live in their own table with zero client grants/policies —
-- only Edge Functions (service role, bypasses RLS) can touch them.

-- Shared updated_at trigger
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- One row per connected institution login (Plaid Item)
create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plaid_item_id text not null unique,
  institution_id text,
  institution_name text,
  status text not null default 'active', -- active | login_required | disconnected
  sync_cursor text,                      -- /transactions/sync cursor (Phase 2)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index plaid_items_user_id_idx on public.plaid_items (user_id);

create trigger plaid_items_updated_at
  before update on public.plaid_items
  for each row execute function public.set_updated_at();

alter table public.plaid_items enable row level security;

create policy "Users can view their own items"
  on public.plaid_items for select
  using ((select auth.uid()) = user_id);

grant select on public.plaid_items to authenticated;

-- Plaid access tokens: service-role only. RLS on + no policies + no grants.
create table public.plaid_tokens (
  item_id uuid primary key references public.plaid_items (id) on delete cascade,
  access_token text not null,
  created_at timestamptz not null default now()
);

alter table public.plaid_tokens enable row level security;
-- deliberately: no policies, no grants

-- Bank accounts under an item
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id uuid not null references public.plaid_items (id) on delete cascade,
  plaid_account_id text not null unique,
  name text not null,
  official_name text,
  mask text,
  type text not null,     -- depository | credit | loan | investment | other
  subtype text,           -- checking | savings | credit card | ...
  current_balance numeric(14, 2),
  available_balance numeric(14, 2),
  iso_currency_code text not null default 'USD',
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index accounts_user_id_idx on public.accounts (user_id);
create index accounts_item_id_idx on public.accounts (item_id);

create trigger accounts_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

alter table public.accounts enable row level security;

create policy "Users can view their own accounts"
  on public.accounts for select
  using ((select auth.uid()) = user_id);

-- Users may hide/unhide accounts; balances and identity stay server-managed.
create policy "Users can update their own accounts"
  on public.accounts for update
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select on public.accounts to authenticated;
grant update (hidden) on public.accounts to authenticated;
