-- The previous migration's column grant restricted nothing: this project's
-- default privileges give anon and authenticated EVERY privilege on each new
-- public table, so `grant update (dismissed)` sat beside a table-wide UPDATE.
-- RLS still confined users to their own rows, but a client could rewrite what
-- detection wrote. Revoke the defaults, then grant exactly what the app uses.
revoke all on public.recurring_streams from anon, authenticated;

grant select on public.recurring_streams to authenticated;
grant update (dismissed) on public.recurring_streams to authenticated;
