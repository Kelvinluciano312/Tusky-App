-- Phase 14a: plans, subscriptions and the effective plan.
-- Spec: docs/superpowers/specs/2026-09-28-phase-14-monetization-design.md

-- 1. Plans. Limits live here so tuning them needs no app release.
create table public.plans (
  id text primary key,
  rank int not null unique,
  max_banks int not null check (max_banks >= 0),
  history_days int not null check (history_days between 0 and 730),
  ai boolean not null,
  scope text not null check (scope in ('self', 'herd'))
);

insert into public.plans (id, rank, max_banks, history_days, ai, scope) values
  ('free',      0,  0,   0, false, 'self'),
  ('trial',     1,  2, 730, true,  'self'),
  ('tusklet',   2,  3, 365, true,  'self'),
  ('tusk',      3, 10, 730, true,  'self'),
  ('tusk_herd', 4, 15, 730, true,  'herd');

alter table public.plans enable row level security;
create policy plans_read on public.plans for select to authenticated using (true);
grant select on public.plans to authenticated;

-- 2. Subscriptions: one row per user. Only the service role writes (the
-- signup trigger, and later the store webhook and the daily job).
create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null references public.plans (id),
  store text not null check (store in ('play', 'app_store', 'comp', 'trial')),
  status text not null default 'active' check (status in ('active', 'grace', 'expired')),
  expires_at timestamptz,
  over_limit_since timestamptz,
  updated_at timestamptz not null default now()
);

create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.subscriptions enable row level security;
-- Your own row, and a herd mate's Tusk Herd (so the app can say who covers you).
create policy subscriptions_read on public.subscriptions for select to authenticated using (
  user_id = (select auth.uid())
  or (plan = 'tusk_herd' and private.is_herd_member((select private.my_herd_id()), user_id))
);
grant select on public.subscriptions to authenticated;

-- 3. The resolver: the best-ranked of my live row, a herd mate's live Tusk
-- Herd, and free. A row is live when active or in grace and not past expiry.
create function private.effective_plan(p_user uuid)
returns table (plan text, source text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.plan, c.source, c.expires_at
  from (
    select s.plan, case when s.store = 'trial' then 'trial' else 'own' end as source, s.expires_at
    from public.subscriptions s
    where s.user_id = p_user
      and s.status in ('active', 'grace')
      and (s.expires_at is null or s.expires_at > now())
    union all
    select s.plan, 'herd', s.expires_at
    from public.subscriptions s
    join public.herd_members mate on mate.user_id = s.user_id
    join public.herd_members me on me.herd_id = mate.herd_id and me.user_id = p_user
    where s.user_id <> p_user
      and s.plan = 'tusk_herd'
      and s.status in ('active', 'grace')
      and (s.expires_at is null or s.expires_at > now())
    union all
    select 'free', 'free', null
  ) c
  join public.plans p on p.id = c.plan
  order by p.rank desc
  limit 1
$$;

revoke execute on function private.effective_plan(uuid) from public;

-- 4. The plan with its limits and the banks counted against it. Service role
-- only: Edge Functions ask about the caller or an Item's connector.
create function public.plan_for(p_user uuid)
returns table (
  plan text, source text, expires_at timestamptz,
  max_banks int, history_days int, ai boolean, scope text, banks_used int
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.plan, e.source, e.expires_at, p.max_banks, p.history_days, p.ai, p.scope,
    (select count(*)::int from public.plaid_items i
     where i.status <> 'archived'
       and case when p.scope = 'herd'
         then i.herd_id = (select m.herd_id from public.herd_members m where m.user_id = p_user)
         else i.user_id = p_user end)
  from private.effective_plan(p_user) e
  join public.plans p on p.id = e.plan
$$;

revoke execute on function public.plan_for(uuid) from public, anon, authenticated;
grant execute on function public.plan_for(uuid) to service_role;

-- 5. The same, for the signed-in user (the app's Plan screen in 14c).
create function public.my_plan()
returns table (
  plan text, source text, expires_at timestamptz,
  max_banks int, history_days int, ai boolean, scope text, banks_used int
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.plan_for((select auth.uid()))
$$;

revoke execute on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- 6. Everyone who exists today is comped Tusk, so nobody loses a bank.
insert into public.subscriptions (user_id, plan, store)
select id, 'tusk', 'comp' from auth.users
on conflict (user_id) do nothing;

-- 7. Every new user starts a 30-day trial. Same body as 9b, plus the last insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_herd uuid;
begin
  v_name := coalesce(
    public.clean_display_name(new.raw_user_meta_data ->> 'display_name'),
    public.clean_display_name(split_part(new.email, '@', 1)),
    'Me'
  );
  insert into public.profiles (user_id, display_name) values (new.id, v_name);
  insert into public.herds (name) values (public.default_herd_name(v_name)) returning id into v_herd;
  insert into public.herd_members (herd_id, user_id, role) values (v_herd, new.id, 'owner');
  insert into public.subscriptions (user_id, plan, store, expires_at)
  values (new.id, 'trial', 'trial', now() + interval '30 days');
  return new;
end;
$$;
