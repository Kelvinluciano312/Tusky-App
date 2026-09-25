-- Phase 7c: per-user merchant rules — "always categorize this merchant as X"
-- and/or a display name for it. Keyed on transactions.merchant_key (the SQL twin
-- of normalizeMerchant). All writes go through set-merchant-rule, so the
-- retroactive re-resolve can never be skipped; clients only read.
-- See docs/superpowers/specs/2026-09-24-phase-7-categories-design.md (Milestone 7c).

create table public.merchant_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  merchant_key text not null check (merchant_key ~ '^[a-z]+( [a-z]+)*$'),
  -- Default (no action) on delete: delete-category moves rules to the group
  -- first, so a missed step fails loudly instead of silently dropping a rule.
  category_id uuid references public.categories (id),
  display_name text check (display_name is null or length(btrim(display_name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, merchant_key),
  check (category_id is not null or display_name is not null)
);

alter table public.merchant_rules enable row level security;

create trigger merchant_rules_updated_at
  before update on public.merchant_rules
  for each row execute function public.set_updated_at();

create policy "Users see their own merchant rules"
  on public.merchant_rules for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.merchant_rules to authenticated;
