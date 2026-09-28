-- Phase 12c: crowd labels. Users who opt in contribute their category choices
-- to a shared pool; a merchant's band is served to everyone once 3 distinct
-- contributors agree at 70%. The pool holds no user, herd or account: a
-- contributor is an HMAC of the user id under a pepper kept in Vault
-- ('label_pepper', created by SQL per project, never in the repo), which gives
-- one vote per person and lets withdrawal find their rows.
-- See docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md.

-- ── Consent ────────────────────────────────────────────────────────────────
-- A record, not a flag: granting again after a withdrawal adds a row.
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('crowd_labels')),
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
create unique index consents_one_active on public.consents (user_id, kind) where withdrawn_at is null;

alter table public.consents enable row level security;
create policy consents_own_select on public.consents
  for select to authenticated using (user_id = (select auth.uid()));
-- Reads only: every write goes through set_consent, so withdrawing and
-- forgetting happen in one transaction.
grant select on public.consents to authenticated;

-- ── The pool ───────────────────────────────────────────────────────────────
create table public.community_labels (
  contributor text not null,
  -- Plaid's merchant_entity_id, or 'k:' || merchant_key.
  merchant text not null,
  direction text not null check (direction in ('in', 'out')),
  -- private.amount_band / amountBand in _shared/crowd.ts.
  amount_band smallint not null check (amount_band between 0 and 5),
  -- Plaid's guess beside the person's choice, for measuring.
  pfc_detailed text,
  -- Always built-in: a custom category contributes its group.
  category_id uuid not null references public.categories (id) on delete cascade,
  created_on date not null default current_date,
  primary key (contributor, merchant, direction, amount_band)
);
create index community_labels_merchant on public.community_labels (merchant);

-- RLS on with no policy and no grants: deny-all to every client, reachable only
-- by service_role and by the security definer functions below.
alter table public.community_labels enable row level security;

-- ── Helpers ────────────────────────────────────────────────────────────────
-- SQL twin of amountBand in _shared/crowd.ts: change both together.
create function private.amount_band(p_amount numeric)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case
    when abs(p_amount) < 5 then 0
    when abs(p_amount) < 15 then 1
    when abs(p_amount) < 50 then 2
    when abs(p_amount) < 150 then 3
    when abs(p_amount) < 500 then 4
    else 5
  end::smallint
$$;

-- Null when the pepper is missing: callers then contribute and forget nothing.
create function private.label_contributor(p_user uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(extensions.hmac(p_user::text, s.decrypted_secret, 'sha256'), 'hex')
  from vault.decrypted_secrets s
  where s.name = 'label_pepper'
$$;

create function private.forget_crowd_labels(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.community_labels where contributor = private.label_contributor(p_user)
$$;

revoke execute on function private.amount_band(numeric) from public;
revoke execute on function private.label_contributor(uuid) from public;
revoke execute on function private.forget_crowd_labels(uuid) from public;

-- ── Contributing ───────────────────────────────────────────────────────────
-- After a user's own choice: a category picked or changed by hand, or a guess
-- accepted in review. Only the acting user (auth.uid()) contributes, so
-- service-role writes (sync, rules, apply-learning) never do. Nothing here may
-- block the user's change: every failure is a warning.
create function private.contribute_crowd_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  who text;
  merchant_v text;
  cat uuid;
begin
  begin
    uid := (select auth.uid());
    if uid is null then return null; end if;
    if not (
      (new.category_is_manual
        and (not old.category_is_manual or new.category_id is distinct from old.category_id))
      or (old.reviewed_at is null and new.reviewed_at is not null
        and new.category_source in ('learned', 'community', 'ai'))
    ) then
      return null;
    end if;
    if not exists (
      select 1 from public.consents c
      where c.user_id = uid and c.kind = 'crowd_labels' and c.withdrawn_at is null
    ) then
      return null;
    end if;
    -- Which merchants someone keeps private is not a fact the crowd gets to learn.
    if exists (select 1 from public.accounts a where a.id = new.account_id and a.is_private) then
      return null;
    end if;
    merchant_v := coalesce(nullif(new.merchant_entity_id, ''), 'k:' || nullif(new.merchant_key, ''));
    if merchant_v is null then return null; end if;
    select case when c.herd_id is null then c.id else c.parent_id end into cat
      from public.categories c where c.id = new.category_id;
    if cat is null or exists (
      select 1 from public.categories c where c.id = cat and c.slug = 'uncategorized'
    ) then
      return null;
    end if;
    who := private.label_contributor(uid);
    if who is null then return null; end if;

    insert into public.community_labels
      (contributor, merchant, direction, amount_band, pfc_detailed, category_id, created_on)
    values
      (who, merchant_v, case when new.amount > 0 then 'in' else 'out' end,
       private.amount_band(new.amount), new.pfc_detailed, cat, current_date)
    on conflict (contributor, merchant, direction, amount_band) do update
      set category_id = excluded.category_id,
          pfc_detailed = excluded.pfc_detailed,
          created_on = excluded.created_on;
  exception when others then
    raise warning 'crowd label skipped: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function private.contribute_crowd_label() from public;

-- "ae_": after ad_transactions_category_source has stamped the source.
create trigger ae_transactions_crowd_label
  after update of category_id, category_is_manual, reviewed_at on public.transactions
  for each row execute function private.contribute_crowd_label();

-- Deleting a user cascades their consents; their contributions go with them.
create function private.consents_forget_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.forget_crowd_labels(old.user_id);
  return null;
end;
$$;
revoke execute on function private.consents_forget_on_delete() from public;

create trigger consents_forget_on_delete
  after delete on public.consents
  for each row execute function private.consents_forget_on_delete();

-- ── The app's one write ────────────────────────────────────────────────────
create function public.set_consent(p_kind text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_kind is distinct from 'crowd_labels' then raise exception 'unknown consent kind'; end if;
  if p_granted then
    insert into public.consents (user_id, kind) values (uid, p_kind)
      on conflict (user_id, kind) where withdrawn_at is null do nothing;
  else
    update public.consents set withdrawn_at = now()
      where user_id = uid and kind = p_kind and withdrawn_at is null;
    perform private.forget_crowd_labels(uid);
  end if;
end;
$$;

revoke execute on function public.set_consent(text, boolean) from public, anon;
grant execute on function public.set_consent(text, boolean) to authenticated;

-- ── Reading, server-only ───────────────────────────────────────────────────
-- Votes per band and category for these merchants. The threshold is applied in
-- _shared/crowd.ts (communityAnswers), where it is tested.
create function public.community_tallies(p_merchants text[])
returns table (merchant text, direction text, amount_band smallint, category_id uuid, votes int)
language sql
stable
set search_path = ''
as $$
  select l.merchant, l.direction, l.amount_band, l.category_id, count(*)::int
  from public.community_labels l
  where l.merchant = any (p_merchants)
  group by 1, 2, 3, 4
$$;

revoke execute on function public.community_tallies(text[]) from public, anon, authenticated;
grant execute on function public.community_tallies(text[]) to service_role;
