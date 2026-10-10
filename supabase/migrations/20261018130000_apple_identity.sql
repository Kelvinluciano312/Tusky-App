-- Apple's server-to-server notifications (Phase 17).
--
-- Apple tells the apple-notifications function when someone stops using Sign in
-- with Apple for Tusky (`consent-revoked`) or deletes their Apple ID
-- (`account-delete`). The message names only the Apple user (`sub`), so the
-- function needs to find the Tusky user and end that user's sessions.
-- Two-step proofs (two_factor_sessions) cascade with the session rows.
--
-- Both are server-only: auth.* is not reachable from the app, and a lookup from
-- an Apple id to a Tusky user must never be.

create function public.user_for_apple_sub(p_sub text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select user_id from auth.identities where provider = 'apple' and provider_id = p_sub;
$$;

create function public.end_user_sessions(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.user_for_apple_sub(text) from public, anon, authenticated;
revoke execute on function public.end_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.user_for_apple_sub(text) to service_role;
grant execute on function public.end_user_sessions(uuid) to service_role;
