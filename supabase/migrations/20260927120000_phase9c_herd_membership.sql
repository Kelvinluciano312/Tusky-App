-- Phase 9c: herd membership. Invites by code, joining (the joiner's data merges
-- into the herd), leaving (the banks you connected leave with you), removing a
-- member, and private accounts. Join and leave are single SQL functions so each
-- runs in one transaction; only the `herd` Edge Function calls them.
-- See docs/superpowers/specs/2026-09-25-phase-9-herds-design.md.

-- 1. Invites ------------------------------------------------------------------------

-- Single use. The code is 8 Crockford base32 characters (shown as XXXX-XXXX),
-- stored without the dash. Written only by the server.
create table public.herd_invites (
  code text primary key check (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  herd_id uuid not null references public.herds (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references auth.users (id) on delete set null,
  accepted_at timestamptz
);

create index herd_invites_herd_id_idx on public.herd_invites (herd_id);

alter table public.herd_invites enable row level security;

create policy "Members see their herd's invites" on public.herd_invites for select to authenticated
  using (herd_id = (select private.my_herd_id()));

grant select on public.herd_invites to authenticated;

-- 2. What herd mates may see and change -------------------------------------------

create policy "Members see their herd mates' profiles" on public.profiles for select to authenticated
  using (exists (
    select 1 from public.herd_members m
    where m.user_id = profiles.user_id and m.herd_id = (select private.my_herd_id())
  ));

create policy "Owners rename their herd" on public.herds for update to authenticated
  using (id = (select private.my_herd_id()) and exists (
    select 1 from public.herd_members m
    where m.herd_id = herds.id and m.user_id = (select auth.uid()) and m.role = 'owner'
  ))
  with check (id = (select private.my_herd_id()));

grant update (name) on public.herds to authenticated;

-- Any member may hide or unhide a shared account, but only the member who
-- connected it decides who sees it. Server calls (no user) pass.
create function public.accounts_private_by_connector()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_private is distinct from old.is_private
     and (select auth.uid()) is not null
     and (select auth.uid()) <> old.user_id then
    raise exception 'only the member who connected an account can make it private'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger accounts_private_by_connector before update of is_private on public.accounts
  for each row execute function public.accounts_private_by_connector();

grant update (is_private) on public.accounts to authenticated;

-- 3. Join --------------------------------------------------------------------------

-- The joiner (alone in their own herd) moves into the invite's herd with
-- everything they have. The herd's settings win: the joiner's category
-- overrides and merchant rules move only where the herd has none for that
-- category or merchant, and their budgets only if the herd has no budgets at
-- all. Accounts listed in p_private_accounts become private first. Accounts
-- the herd already has (same bank, name and mask on a live connection) are
-- hidden and returned, so the app can offer to disconnect the copy.
create function public.merge_into_herd(p_user uuid, p_code text, p_private_accounts uuid[])
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_invite public.herd_invites%rowtype;
  v_old uuid;
  v_target uuid;
  v_dupes uuid[];
begin
  select * into v_invite from public.herd_invites where code = p_code for update;
  if not found or v_invite.accepted_at is not null or v_invite.expires_at < now() then
    raise exception 'invite_invalid';
  end if;
  v_target := v_invite.herd_id;

  select herd_id into v_old from public.herd_members where user_id = p_user for update;
  if v_old is null then
    raise exception 'no herd for user %', p_user;
  end if;
  if v_old = v_target then
    raise exception 'already_member';
  end if;
  -- Locks both herds, so two joins cannot both pass the size check.
  perform 1 from public.herds where id in (v_old, v_target) order by id for update;
  if (select count(*) from public.herd_members where herd_id = v_old) > 1 then
    raise exception 'not_alone';
  end if;
  if (select count(*) from public.herd_members where herd_id = v_target) >= 6 then
    raise exception 'herd_full';
  end if;

  update public.accounts set is_private = true
  where herd_id = v_old and id = any (coalesce(p_private_accounts, '{}'));

  -- Found before the move, while the two herds are still apart.
  select coalesce(array_agg(a.id), '{}') into v_dupes
  from public.accounts a
  join public.plaid_items i on i.id = a.item_id
  where a.herd_id = v_old
    and nullif(btrim(a.mask), '') is not null
    and exists (
      select 1
      from public.accounts t
      join public.plaid_items ti on ti.id = t.item_id
      where t.herd_id = v_target
        and not t.is_private
        and ti.status <> 'archived'
        and ti.institution_id is not distinct from i.institution_id
        and lower(btrim(t.mask)) = lower(btrim(a.mask))
        and lower(btrim(t.name)) = lower(btrim(a.name))
    );

  -- Categories first: the joiner's rows, budgets and rules point at them, and
  -- category_in_herd checks those rows against their new herd as they move.
  update public.categories set herd_id = v_target where herd_id = v_old;

  update public.category_overrides o set herd_id = v_target
  where o.herd_id = v_old
    and not exists (select 1 from public.category_overrides t where t.herd_id = v_target and t.category_id = o.category_id);

  update public.merchant_rules r set herd_id = v_target
  where r.herd_id = v_old
    and not exists (select 1 from public.merchant_rules t where t.herd_id = v_target and t.merchant_key = r.merchant_key);

  if not exists (select 1 from public.budgets where herd_id = v_target) then
    update public.budgets set herd_id = v_target where herd_id = v_old;
  end if;

  -- The composite keys cascade this to accounts, and from them to
  -- transactions, balance snapshots and recurring streams.
  update public.plaid_items set herd_id = v_target where herd_id = v_old;

  update public.accounts set hidden = true where id = any (v_dupes);

  delete from public.herd_members where user_id = p_user;
  insert into public.herd_members (herd_id, user_id, role) values (v_target, p_user, 'member');
  -- Takes the overrides, rules and budgets the herd's own won over with it.
  delete from public.herds where id = v_old;

  update public.herd_invites set accepted_by = p_user, accepted_at = now() where code = p_code;

  return jsonb_build_object('herd_id', v_target, 'hidden_account_ids', to_jsonb(v_dupes));
end;
$$;

-- 4. Leave (and remove) -------------------------------------------------------------

-- The member leaves with the banks they connected, into a new herd of their
-- own. The budgets, categories and rules stay with the herd. Their rows that
-- use one of the herd's custom categories fall back to its group first:
-- category_in_herd would refuse the move otherwise. If the owner leaves, the
-- earliest-joined member becomes owner. Returns the new herd's id.
create function public.leave_herd(p_user uuid)
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

-- 5. Reachable only by the server ---------------------------------------------------

revoke execute on function
  public.accounts_private_by_connector(),
  public.merge_into_herd(uuid, text, uuid[]),
  public.leave_herd(uuid)
from public, anon, authenticated;

grant execute on function public.merge_into_herd(uuid, text, uuid[]), public.leave_herd(uuid) to service_role;
