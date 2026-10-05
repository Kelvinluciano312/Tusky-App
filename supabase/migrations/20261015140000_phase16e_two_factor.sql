-- Phase 16e: two-step sign-in by email code, enforced in the database.
--
-- PROVEN ON DEV (2026-10-05, throwaway user, admin generateLink + anon verifyOtp):
--   password sign-in      amr = [{"method":"password", ...}]            session_id A
--   verifyOtp({type:'email'}) on that same client
--                         amr = [{"method":"otp", ...}]                 NEW session_id B
--   refreshSession()      amr = [{"method":"otp", ...}]  (same timestamp, same session_id)
--   verifyOtp on a fresh client, then refresh: amr still [{"method":"otp"}]
--   a later password sign-in of the same user: amr = [{"method":"password"}] only
-- So the JWT's `amr` claim is the proof: a code was proven in this session
-- and it survives token refresh. A password-only session never carries `otp`.
-- No server-side session table is needed.
--
-- Design: profiles.two_factor is opt-in. When it is on, private.my_herd_id()
-- (which every herd policy and private.my_account_ids() go through) returns
-- null unless the session's amr has an otp entry, so a password-only session
-- reads and writes no herd data. The user's OWN profile row, subscription and
-- consents stay reachable (their policies use auth.uid()), so the app's gate
-- can tell why and show the code screen.

-- 1. The flag. Readable with the rest of the own row (table-level select); the
-- only UPDATE grants stay column-scoped (display_name, ai_categorize,
-- onboarded_at), so the app cannot write two_factor except through the RPC.
alter table public.profiles add column two_factor boolean not null default false;

-- 2. Did this session prove an emailed code? Reads the JWT's amr claim.
create function private.session_has_otp()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select bool_or(e ->> 'method' = 'otp')
    from jsonb_array_elements(
      case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end
    ) e
  ), false)
$$;

revoke execute on function private.session_has_otp() from public;
grant execute on function private.session_has_otp() to authenticated;

-- 3. The herd boundary. Same body as 9b plus the second step: with two_factor
-- on and no otp proof the user has no herd. Still one indexed lookup each way.
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
      (select private.session_has_otp())
      or not exists (select 1 from public.profiles p where p.user_id = m.user_id and p.two_factor)
    )
$$;

-- 4. Turning it on or off needs a code proven in this session, so a password
-- alone can neither switch it off nor on.
create function public.set_two_factor(p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if not (select private.session_has_otp()) then
    raise exception 'two_factor_proof_required' using errcode = '42501';
  end if;
  update public.profiles set two_factor = coalesce(p_on, false) where user_id = (select auth.uid());
end
$$;

revoke execute on function public.set_two_factor(boolean) from public, anon;
grant execute on function public.set_two_factor(boolean) to authenticated;
