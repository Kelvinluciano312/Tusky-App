-- Phase 16e, part 3: code attempts are counted per USER and reserved atomically.
--
-- Two weaknesses in the per-session counter of part 2: (1) anyone holding the
-- password could sign in again and get a fresh budget per session; (2) the
-- function read the count, called verifyOtp, then inserted the failure, so
-- many parallel guesses all read 0 and all went through.
--
-- take_two_factor_attempt reserves an attempt BEFORE the code is checked, under
-- a per-user advisory lock, so concurrent callers serialise. The rows are
-- short-lived attempt rows (the table keeps its part-2 name).

delete from public.two_factor_failures;
alter table public.two_factor_failures
  add column user_id uuid not null references auth.users (id) on delete cascade;
create index two_factor_failures_user_idx on public.two_factor_failures (user_id, created_at);

-- Returns the id of the reserved attempt, or null when this session or this
-- user is out of attempts within the window. The Edge Function deletes the row
-- on success, and refunds it when the code could not be checked at all.
create function public.take_two_factor_attempt(
  p_session uuid,
  p_user uuid,
  p_max_session int,
  p_max_user int,
  p_window_minutes int
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  delete from public.two_factor_failures
    where user_id = p_user and created_at < now() - make_interval(mins => p_window_minutes);
  if (select count(*) from public.two_factor_failures where session_id = p_session) >= p_max_session
     or (select count(*) from public.two_factor_failures where user_id = p_user) >= p_max_user then
    return null;
  end if;
  insert into public.two_factor_failures (session_id, user_id) values (p_session, p_user)
    returning id into v_id;
  return v_id;
end
$$;

revoke execute on function public.take_two_factor_attempt(uuid, uuid, int, int, int) from public, anon, authenticated;
grant execute on function public.take_two_factor_attempt(uuid, uuid, int, int, int) to service_role;
