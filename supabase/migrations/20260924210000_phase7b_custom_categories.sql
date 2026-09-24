-- Phase 7b: users rename, recolour and hide built-in categories (per-user
-- overrides, never new rows, so every label stays in one shared vocabulary)
-- and add their own under any built-in group. See
-- docs/superpowers/specs/2026-09-24-phase-7-categories-design.md (Milestone 7b).

-- Custom rows sort after their group's built-in children. Every seed names its
-- own sort_order, so only client inserts take this default.
alter table public.categories alter column sort_order set default 1000;

alter table public.categories
  add constraint categories_name_length check (length(btrim(name)) between 1 and 40),
  add constraint categories_color_hex check (color ~ '^#[0-9A-Fa-f]{6}$');

-- A custom category belongs to its creator (user_id defaults to auth.uid())
-- and is a child: categories_enforce_tree pins its parent to a built-in group
-- and copies the group's kind, which is why a client never names kind.
create policy "Users add their own categories"
  on public.categories for insert to authenticated
  with check (user_id = (select auth.uid()) and parent_id is not null);

create policy "Users edit their own categories"
  on public.categories for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Exactly what the app writes. No client delete: delete-category moves a
-- category's transactions, streams and budget first. parent_id is insert-only,
-- because the tree trigger cannot stop a childless group being made its own
-- parent; the only guard is that no client can write parent_id on update.
grant insert (name, parent_id, icon, color) on public.categories to authenticated;
grant update (name, icon, color) on public.categories to authenticated;

-- Per-user changes to a built-in. A null name or colour means "the built-in's".
-- Client-owned end to end, like budgets.
create table public.category_overrides (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  name text check (name is null or length(btrim(name)) between 1 and 40),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, category_id)
);

alter table public.category_overrides enable row level security;

create trigger category_overrides_updated_at
  before update on public.category_overrides
  for each row execute function public.set_updated_at();

-- Only built-ins take overrides: a custom row is edited directly. Runs as the
-- caller, so another user's custom row is invisible here and refused too.
create function public.category_overrides_builtin_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.categories c where c.id = new.category_id and c.user_id is null
  ) then
    raise exception 'only built-in categories take overrides';
  end if;
  return new;
end;
$$;

create trigger category_overrides_builtin_only
  before insert or update of category_id on public.category_overrides
  for each row execute function public.category_overrides_builtin_only();

create policy "Users see their own category overrides"
  on public.category_overrides for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users add their own category overrides"
  on public.category_overrides for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users change their own category overrides"
  on public.category_overrides for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users remove their own category overrides"
  on public.category_overrides for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.category_overrides to authenticated;

-- What the app reads as "categories": built-ins with this user's overrides
-- applied, plus their own custom rows. security_invoker so RLS applies, and
-- the redundant predicate so a later replace that drops the flag fails
-- closed (CLAUDE.md).
create view public.user_categories
with (security_invoker = on) as
select
  c.id,
  c.slug,
  c.parent_id,
  c.kind,
  c.icon,
  c.sort_order,
  coalesce(o.name, c.name) as name,
  coalesce(o.color, c.color) as color,
  coalesce(o.hidden, false) as hidden,
  c.user_id is not null as is_custom,
  o.category_id is not null as overridden
from public.categories c
left join public.category_overrides o
  on o.category_id = c.id and o.user_id = (select auth.uid())
where c.user_id is null or c.user_id = (select auth.uid());

grant select on public.user_categories to authenticated;
