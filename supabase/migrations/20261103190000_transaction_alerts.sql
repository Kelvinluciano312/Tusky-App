-- Transaction alerts: per-user rules that fire a push when a matching posted
-- transaction appears. Free plans get 3 active alerts; trial and paid are
-- unlimited. Visibility reuses private.my_account_ids / canSeeAccount (own +
-- herd shared non-private). Never alert on another member's private accounts.

create table public.transaction_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Prefer Plaid's merchant_entity_id; merchant_key is the normalized fallback.
  merchant_entity_id text,
  merchant_key text,
  category_id uuid references public.categories (id) on delete cascade,
  -- Absolute amount in cents; null = no floor. Matches spend and income.
  min_cents int check (min_cents is null or min_cents > 0),
  enabled boolean not null default true,
  -- Display helpers so the manage list does not need a join for the label.
  merchant_label text,
  category_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transaction_alerts_has_target check (
    merchant_entity_id is not null
    or merchant_key is not null
    or category_id is not null
    or min_cents is not null
  )
);

comment on table public.transaction_alerts is
  'User-owned push rules for merchants, categories, and/or amount floors. Fires on posted sync only.';

create index transaction_alerts_user_enabled_idx
  on public.transaction_alerts (user_id)
  where enabled;

-- One logical rule per shape per user (nulls collapsed so duplicates collide).
create unique index transaction_alerts_shape_uidx
  on public.transaction_alerts (
    user_id,
    coalesce(merchant_entity_id, ''),
    coalesce(merchant_key, ''),
    coalesce(category_id::text, ''),
    coalesce(min_cents, -1)
  );

create or replace function private.set_transaction_alert_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger transaction_alerts_updated_at
  before update on public.transaction_alerts
  for each row execute function private.set_transaction_alert_updated_at();

-- Free = 3 active. trial / tusklet / tusk / tusk_herd unlimited.
create or replace function private.enforce_transaction_alert_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_count int;
  user_plan text;
begin
  if not new.enabled then
    return new;
  end if;

  select e.plan into user_plan from private.effective_plan(new.user_id) e;
  if user_plan is distinct from 'free' then
    return new;
  end if;

  select count(*)::int into active_count
  from public.transaction_alerts a
  where a.user_id = new.user_id
    and a.enabled
    and (tg_op = 'INSERT' or a.id is distinct from new.id);

  if active_count >= 3 then
    raise exception 'plan_limit'
      using errcode = 'P0001',
            hint = 'Free plans may keep 3 active transaction alerts. Upgrade for unlimited.';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_transaction_alert_limit() from public;
revoke all on function private.set_transaction_alert_updated_at() from public;

create trigger transaction_alerts_free_limit
  before insert or update of enabled on public.transaction_alerts
  for each row execute function private.enforce_transaction_alert_limit();

alter table public.transaction_alerts enable row level security;

-- Owner-only. The push path uses service_role and bypasses RLS.
create policy transaction_alerts_select_own
  on public.transaction_alerts for select to authenticated
  using (user_id = (select auth.uid()));

create policy transaction_alerts_insert_own
  on public.transaction_alerts for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy transaction_alerts_update_own
  on public.transaction_alerts for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy transaction_alerts_delete_own
  on public.transaction_alerts for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.transaction_alerts to service_role;
grant select, insert, update, delete on public.transaction_alerts to authenticated;
