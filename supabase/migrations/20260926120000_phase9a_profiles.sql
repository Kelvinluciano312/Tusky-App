-- Phase 9a: display names. One profile per user, created at signup from the
-- name the app sends (raw_user_meta_data.display_name). The profile, not the
-- metadata, is the source of truth afterwards. Herd mates will read it (9c).
-- See docs/superpowers/specs/2026-09-25-phase-9-herds-design.md.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (display_name = btrim(display_name) and length(display_name) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create policy "Users see their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users rename themselves"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, update (display_name) on public.profiles to authenticated;

-- A name that fits the check, or null. Never raises: a bad name must not fail a signup.
create function public.clean_display_name(raw text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(left(btrim(coalesce(raw, '')), 40)), '')
$$;

-- Runs as its owner (postgres): the signing-up user cannot insert profiles themselves.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(
      public.clean_display_name(new.raw_user_meta_data ->> 'display_name'),
      public.clean_display_name(split_part(new.email, '@', 1)),
      'Me'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (user_id, display_name)
select u.id, coalesce(public.clean_display_name(split_part(u.email, '@', 1)), 'Me')
from auth.users u
on conflict (user_id) do nothing;

-- The first functions clients could reach as RPCs: Postgres grants EXECUTE to
-- PUBLIC by default. Fail closed, then grant per function when one is meant to
-- be called (none of these are).
alter default privileges for role postgres in schema public revoke execute on functions from public;
revoke execute on function public.clean_display_name(text), public.handle_new_user() from public, anon, authenticated;
