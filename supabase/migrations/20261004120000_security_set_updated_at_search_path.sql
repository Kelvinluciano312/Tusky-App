-- Security review 2026-09-27: set_updated_at was the one function in `public`
-- without a fixed search_path. It is SECURITY INVOKER, so this is not a
-- privilege-escalation path — but every other function in the project, and all
-- three in `private`, already pin it, and an empty advisor list is what makes
-- the next real finding visible.
--
-- The body is byte-for-byte the original: the only change is search_path.
-- `now()` still resolves, because pg_catalog is searched even when the path is
-- empty. `create or replace` keeps every trigger that points at this function.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
