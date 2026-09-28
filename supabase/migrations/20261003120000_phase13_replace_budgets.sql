-- Phase 13: apply a preset budget in one transaction. The app builds the lines
-- (lib/presets.ts) and sends them here rather than deleting and inserting one
-- row at a time, so a dropped connection can never leave half a budget.
--
-- security invoker: the herd policies on budgets, and its
-- herd_id default private.my_herd_id(), apply exactly as they do to the
-- client's own writes. The insert selects from the array, so the amount check,
-- the categories foreign key and the policies all still run: an unknown or
-- another herd's category fails the whole call.
-- See docs/superpowers/specs/2026-09-26-phase-13-preset-budgets-design.md.

create function public.replace_budgets(p_lines jsonb)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted int;
begin
  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;

  -- RLS decides the rows this touches: it is the caller's herd, never a parameter.
  delete from public.budgets where herd_id = (select private.my_herd_id());

  insert into public.budgets (category_id, amount)
  select (l->>'category_id')::uuid, (l->>'amount')::numeric
  from jsonb_array_elements(p_lines) l;
  get diagnostics inserted = row_count;

  return inserted;
end;
$$;

revoke execute on function public.replace_budgets(jsonb) from public, anon;
grant execute on function public.replace_budgets(jsonb) to authenticated;
