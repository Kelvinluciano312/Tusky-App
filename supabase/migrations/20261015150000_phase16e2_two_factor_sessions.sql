-- Phase 16e, part 2: the second step is bound to a session on the server.
--
-- WHY THE FIRST DESIGN WAS WRONG. 16e read the JWT's `amr` claim: a session
-- whose amr had an `otp` entry counted as "code proven". But verifyOtp({type:
-- 'email'}) creates a NEW session on its own, with amr [{method:'otp'}] and no
-- password anywhere. So someone who controls only the mailbox could call
-- signInWithOtp + verifyOtp and get a fully verified session: the email code
-- was a replacement for the password, not a second step after it.
--
-- NEW RULE. A session is verified only when a row for it exists in
-- two_factor_sessions, and only the `two-factor` Edge Function writes that row:
-- it takes a session that already proved the password (amr has `password`),
-- checks the emailed code on a throwaway client, and then marks the CALLER'S
-- session. An otp- or recovery-created session can never be marked.

-- 1. Verified sessions. Server-only: RLS on, no policies, no client grants.
-- The FK to auth.sessions makes sign-out (and expiry) clear the row; the
-- user_id index serves the cascade from auth.users.
create table public.two_factor_sessions (
  session_id  uuid primary key references auth.sessions (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  verified_at timestamptz not null default now()
);
create index two_factor_sessions_user_id_idx on public.two_factor_sessions (user_id);
alter table public.two_factor_sessions enable row level security;
revoke all on public.two_factor_sessions from public, anon, authenticated;

-- 2. Wrong codes per session, so the function can stop guessing after a few
-- tries (Supabase's own verifyOtp limits still apply underneath). Same
-- server-only shape; rows go with their session.
create table public.two_factor_failures (
  id         bigint generated always as identity primary key,
  session_id uuid not null references auth.sessions (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index two_factor_failures_session_idx on public.two_factor_failures (session_id, created_at);
alter table public.two_factor_failures enable row level security;
revoke all on public.two_factor_failures from public, anon, authenticated;

-- 3. Has THIS session been verified for THIS user? Replaces session_has_otp
-- (which read amr). security definer: the table has no client grants.
create function private.session_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.two_factor_sessions s
    where s.session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and s.user_id = (select auth.uid())
  )
$$;

revoke execute on function private.session_verified() from public;
grant execute on function private.session_verified() to authenticated;

-- 4. The herd boundary: same body as 16e, now asking session_verified. The
-- cheap flag check goes first so users without two-step pay nothing extra.
create or replace function private.my_herd_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.herd_id
  from public.herd_members m
  where m.user_id = (select auth.uid())
    and (
      not exists (select 1 from public.profiles p where p.user_id = m.user_id and p.two_factor)
      or (select private.session_verified())
    )
$$;

-- 5. Turning it on or off needs a verified session (the app marks it through
-- the two-step function first), so a password alone can do neither.
create or replace function public.set_two_factor(p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.session_verified()) then
    raise exception 'two_factor_proof_required' using errcode = '42501';
  end if;
  update public.profiles set two_factor = coalesce(p_on, false) where user_id = (select auth.uid());
end
$$;

drop function private.session_has_otp();

-- 6. What the app's gate reads: has this session been verified?
create function public.my_second_step_done()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.session_verified())
$$;

revoke execute on function public.my_second_step_done() from public, anon;
grant execute on function public.my_second_step_done() to authenticated;
