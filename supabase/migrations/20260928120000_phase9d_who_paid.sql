-- Phase 9d: who paid. Each account has an owner (null = Joint), and each
-- transaction a payer (null = Joint) that follows its account's owner unless a
-- member set it by hand. The database owns the default, so sync never names
-- either column: new rows take their account's owner on insert, and changing
-- an account's owner re-applies it to the rows nobody set by hand.
-- See docs/superpowers/specs/2026-09-25-phase-9-herds-design.md.

alter table public.accounts add column owner_id uuid references auth.users (id) on delete set null;
alter table public.transactions
  add column paid_by uuid references auth.users (id) on delete set null,
  add column paid_by_is_manual boolean not null default false;

-- Backfill before the triggers exist: every account belongs to whoever connected it.
update public.accounts set owner_id = user_id;
update public.transactions t set paid_by = a.owner_id from public.accounts a where a.id = t.account_id;

-- An owner or payer must be in the row's herd. Null (Joint) always passes.
-- In `private`: the triggers below run as the app's user, who needs EXECUTE,
-- but PostgREST must not expose it as an RPC.
create function private.is_herd_member(p_herd uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.herd_members m where m.herd_id = p_herd and m.user_id = p_user)
$$;

create function public.accounts_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.owner_id is null then
    new.owner_id := new.user_id;
  end if;
  if new.owner_id is not null and not private.is_herd_member(new.herd_id, new.owner_id) then
    raise exception 'the account owner must be in the herd' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- "ab_": after aa_fill_herd_id, which supplies herd_id on insert.
create trigger ab_accounts_owner before insert or update of owner_id on public.accounts
  for each row execute function public.accounts_owner();

create function public.transactions_paid_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and not new.paid_by_is_manual then
    select a.owner_id into new.paid_by from public.accounts a where a.id = new.account_id;
  end if;
  if new.paid_by is not null and not private.is_herd_member(new.herd_id, new.paid_by) then
    raise exception 'the payer must be in the herd' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- On an upsert that hits an existing row, the insert-time default is computed
-- but discarded: DO UPDATE writes only the payload's columns, and sync's
-- payload never has paid_by.
create trigger ab_transactions_paid_by before insert or update of paid_by on public.transactions
  for each row execute function public.transactions_paid_by();

-- A new owner re-applies to the account's rows that nobody set by hand.
create function public.accounts_owner_reapply()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.transactions
  set paid_by = new.owner_id
  where account_id = new.id and not paid_by_is_manual and paid_by is distinct from new.owner_id;
  return null;
end;
$$;

create trigger accounts_owner_reapply after update of owner_id on public.accounts
  for each row when (old.owner_id is distinct from new.owner_id)
  execute function public.accounts_owner_reapply();

grant update (owner_id) on public.accounts to authenticated;
grant update (paid_by, paid_by_is_manual) on public.transactions to authenticated;

-- Leaving (9c), now keeping owners and payers inside their herds: the
-- leaver's banks take them along as owner and payer, and the accounts that
-- stay but were theirs become Joint.
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

-- 9b granted the schema to authenticated only; sync (service_role) fires these triggers too.
grant usage on schema private to service_role;
revoke execute on function private.is_herd_member(uuid, uuid) from public;
grant execute on function private.is_herd_member(uuid, uuid) to authenticated, service_role;

revoke execute on function
  public.accounts_owner(),
  public.transactions_paid_by(),
  public.accounts_owner_reapply(),
  public.leave_herd(uuid)
from public, anon, authenticated;

grant execute on function public.leave_herd(uuid) to service_role;
