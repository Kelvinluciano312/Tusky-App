-- Phase 15c: terms acceptance, onboarding, and crowd labels on by default.
--
-- Terms: a `terms` consent row per accepted version. Sign-up carries the
-- version in its metadata (with email confirmation there is no session to
-- call a function from), so handle_new_user records it; accept_terms covers
-- existing users and later versions. A newer acceptance closes the older row
-- (withdrawn_at), so "one active row per kind" still holds.
--
-- Crowd labels: new accounts start opted in. The Settings switch and
-- onboarding both show it, and turning it off withdraws and forgets as before.
--
-- Onboarding: profiles.onboarded_at, set by the app when the first-run steps
-- finish. Everyone who already has an account counts as onboarded.

-- ── Consents ───────────────────────────────────────────────────────────────
alter table public.consents drop constraint consents_kind_check;
alter table public.consents add constraint consents_kind_check check (kind in ('crowd_labels', 'terms'));
alter table public.consents add column version text;
alter table public.consents add constraint consents_terms_version
  check ((kind = 'terms') = (version is not null));

-- Forget contributions only when a crowd_labels row goes (a terms row can be
-- deleted by the account cascade too).
create or replace function private.consents_forget_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.kind = 'crowd_labels' then
    perform private.forget_crowd_labels(old.user_id);
  end if;
  return null;
end;
$$;

-- Records that a user accepted a version of the terms. Idempotent per version.
create or replace function private.record_terms(p_user uuid, p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_version is null or length(btrim(p_version)) = 0 or length(p_version) > 32 then
    raise exception 'bad terms version';
  end if;
  if exists (
    select 1 from public.consents
    where user_id = p_user and kind = 'terms' and withdrawn_at is null and version = p_version
  ) then
    return;
  end if;
  update public.consents set withdrawn_at = now()
    where user_id = p_user and kind = 'terms' and withdrawn_at is null;
  insert into public.consents (user_id, kind, version) values (p_user, 'terms', p_version);
end;
$$;
revoke execute on function private.record_terms(uuid, text) from public;

create function public.accept_terms(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in'; end if;
  perform private.record_terms(uid, p_version);
end;
$$;
revoke execute on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;

-- ── Onboarding ─────────────────────────────────────────────────────────────
alter table public.profiles add column onboarded_at timestamptz;
update public.profiles set onboarded_at = now() where onboarded_at is null;
grant update (onboarded_at) on public.profiles to authenticated;

-- ── Sign-up ────────────────────────────────────────────────────────────────
-- As in 14a, plus: the terms the person accepted on the sign-up screen, and
-- crowd labels on by default.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_herd uuid;
  v_terms text := new.raw_user_meta_data ->> 'terms_version';
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
  insert into public.consents (user_id, kind) values (new.id, 'crowd_labels');
  if v_terms is not null and length(btrim(v_terms)) between 1 and 32 then
    perform private.record_terms(new.id, v_terms);
  end if;
  return new;
end;
$$;
