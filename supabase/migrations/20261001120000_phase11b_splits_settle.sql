-- Phase 11b: splits and settle-up. A purchase's account owner paid for it;
-- `paid_by` (a person, or null = Joint, shared equally) or `split` (custom
-- percents) says who it was for. Where the two differ, someone owes someone.
-- Settlements record the payments that square it.
-- See docs/superpowers/specs/2026-09-26-phase-11-shared-money-design.md.

-- 1. Custom splits ------------------------------------------------------------

-- { "<member user_id>": <percent>, ... }; null = no custom split.
alter table public.transactions add column split jsonb;

create function public.transactions_split()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  total numeric := 0;
  n int := 0;
begin
  if new.split is null then
    return new;
  end if;
  if jsonb_typeof(new.split) <> 'object' then
    raise exception 'a split is an object of member percents' using errcode = 'check_violation';
  end if;
  for k, v in select * from jsonb_each(new.split) loop
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <= 0 then
      raise exception 'every share of a split must be above 0%%' using errcode = 'check_violation';
    end if;
    if k !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not private.is_herd_member(new.herd_id, k::uuid) then
      raise exception 'everyone in a split must be in the herd' using errcode = 'check_violation';
    end if;
    total := total + (v #>> '{}')::numeric;
    n := n + 1;
  end loop;
  if n < 2 then
    raise exception 'a split needs at least two people' using errcode = 'check_violation';
  end if;
  if abs(total - 100) > 0.01 then
    raise exception 'a split must add up to 100%%' using errcode = 'check_violation';
  end if;
  -- A split replaces "for one person or Joint", and is always a hand-made choice.
  new.paid_by := null;
  new.paid_by_is_manual := true;
  return new;
end;
$$;

-- "ac_": after ab_transactions_paid_by, so the payer check never sees a stale payer.
create trigger ac_transactions_split before insert or update of split on public.transactions
  for each row execute function public.transactions_split();

grant update (split) on public.transactions to authenticated;

-- 2. Settlements --------------------------------------------------------------

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  herd_id uuid not null default private.my_herd_id() references public.herds (id) on delete cascade,
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  date date not null default current_date,
  note text check (char_length(note) <= 200),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);

create index settlements_herd_date on public.settlements (herd_id, date desc);

alter table public.settlements enable row level security;

create policy "Members see herd settlements" on public.settlements for select to authenticated
  using (herd_id = (select private.my_herd_id()));
create policy "Members record herd settlements" on public.settlements for insert to authenticated
  with check (herd_id = (select private.my_herd_id()) and created_by = (select auth.uid()));
create policy "Members undo herd settlements" on public.settlements for delete to authenticated
  using (herd_id = (select private.my_herd_id()));

create function public.settlements_members()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not private.is_herd_member(new.herd_id, new.from_user) or not private.is_herd_member(new.herd_id, new.to_user) then
    raise exception 'both people in a settlement must be in the herd' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger settlements_members before insert on public.settlements
  for each row execute function public.settlements_members();

grant select, delete on public.settlements to authenticated;
grant insert (from_user, to_user, amount, date, note) on public.settlements to authenticated;

-- 3. The rows that can create a debt -------------------------------------------
-- Posted expenses on shared, shown accounts, where who it was for differs from
-- who paid. Private accounts are left out so every member computes the same
-- balance from rows they can all see.

create view public.shared_lines
with (security_invoker = on) as
select
  t.id,
  t.date,
  t.amount,
  a.owner_id as funded_by,
  t.paid_by,
  t.split,
  t.category_id,
  t.merchant_name,
  t.name
from public.transactions t
join public.accounts a on a.id = t.account_id
left join public.categories c on c.id = t.category_id
where t.herd_id = (select private.my_herd_id())
  and not t.pending
  and not a.is_private
  and not a.hidden
  and coalesce(c.kind, 'expense') = 'expense'
  and (t.split is not null or a.owner_id is distinct from t.paid_by);

grant select on public.shared_lines to authenticated;

-- 4. Spending by person spreads a split over its people --------------------------

create or replace view public.monthly_person_totals
with (security_invoker = on) as
with lines as (
  select t.date, t.paid_by, t.category_id, t.iso_currency_code, t.amount
  from public.transactions t
  join public.accounts a on a.id = t.account_id
  where t.herd_id = (select private.my_herd_id())
    and not a.hidden
    and t.split is null
  union all
  select t.date, s.key::uuid, t.category_id, t.iso_currency_code, t.amount * (s.value #>> '{}')::numeric / 100
  from public.transactions t
  join public.accounts a on a.id = t.account_id
  cross join lateral jsonb_each(t.split) s
  where t.herd_id = (select private.my_herd_id())
    and not a.hidden
    and t.split is not null
)
select
  date_trunc('month', l.date::timestamp)::date as month,
  l.paid_by,
  l.category_id,
  l.iso_currency_code,
  sum(l.amount)  as total,
  count(*)::int  as transaction_count
from lines l
group by 1, 2, 3, 4;

-- 5. Leaving: no split may name someone outside its herd --------------------------
-- Same as 9d's leave_herd, plus two steps: splits on the leaver's own banks end
-- (they name people the leaver no longer shares with), and splits left behind
-- that name the leaver become Joint.

create or replace function public.leave_herd(p_user uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_old uuid;
  v_role text;
  v_new uuid;
  v_accounts uuid[];
begin
  select herd_id, role into v_old, v_role from public.herd_members where user_id = p_user for update;
  if v_old is null then
    raise exception 'no herd for user %', p_user;
  end if;
  perform 1 from public.herds where id = v_old for update;
  if (select count(*) from public.herd_members where herd_id = v_old) = 1 then
    raise exception 'alone';
  end if;

  insert into public.herds (name)
  values (public.default_herd_name((select display_name from public.profiles where user_id = p_user)))
  returning id into v_new;

  select coalesce(array_agg(a.id), '{}') into v_accounts
  from public.accounts a
  join public.plaid_items i on i.id = a.item_id
  where i.herd_id = v_old and i.user_id = p_user;

  update public.transactions t set category_id = c.parent_id
  from public.categories c
  where c.id = t.category_id and c.herd_id is not null and t.account_id = any (v_accounts);

  update public.recurring_streams s set category_id = c.parent_id
  from public.categories c
  where c.id = s.category_id and c.herd_id is not null and s.account_id = any (v_accounts);

  -- Before the move, while everyone named is still a member of v_old.
  update public.accounts set owner_id = p_user
  where id = any (v_accounts) and owner_id is not null and owner_id <> p_user;
  update public.transactions set split = null
  where account_id = any (v_accounts) and split is not null;
  -- A split that stays behind but names the leaver becomes Joint: shared
  -- equally by whoever is left.
  update public.transactions set split = null, paid_by = null, paid_by_is_manual = true
  where herd_id = v_old and split ? p_user::text and not (account_id = any (v_accounts));
  update public.transactions set paid_by = p_user
  where account_id = any (v_accounts) and paid_by is not null and paid_by <> p_user;
  update public.accounts set owner_id = null
  where herd_id = v_old and owner_id = p_user and not (id = any (v_accounts));

  update public.plaid_items set herd_id = v_new where herd_id = v_old and user_id = p_user;

  delete from public.herd_invites where herd_id = v_old and created_by = p_user and accepted_at is null;

  delete from public.herd_members where user_id = p_user;
  insert into public.herd_members (herd_id, user_id, role) values (v_new, p_user, 'owner');

  if v_role = 'owner' then
    update public.herd_members set role = 'owner'
    where herd_id = v_old
      and user_id = (select user_id from public.herd_members where herd_id = v_old order by joined_at, user_id limit 1);
  end if;

  return v_new;
end;
$$;

revoke execute on function
  public.transactions_split(),
  public.settlements_members(),
  public.leave_herd(uuid)
from public, anon, authenticated;

grant execute on function public.leave_herd(uuid) to service_role;
