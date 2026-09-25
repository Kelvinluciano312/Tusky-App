-- Phase 9b: herds. Every user belongs to exactly one herd (a personal one to
-- start with), and data belongs to the herd instead of the user. Nothing looks
-- different yet: every herd has one member until 9c adds invites.
-- See docs/superpowers/specs/2026-09-25-phase-9-herds-design.md.
--
-- Ownership model:
--   * Plaid data (plaid_items, accounts, transactions, balance_snapshots,
--     recurring_streams) carries herd_id, the access boundary. user_id stays and
--     means "connected by": it decides who may reconnect or disconnect a bank
--     and which banks leave with a member, never who may read a row.
--   * Configuration (budgets, category_overrides, merchant_rules, custom
--     categories) is the herd's: user_id is replaced by herd_id.
--   * An account the connector marks private is visible to them alone, and so
--     are its transactions, snapshots and streams (private.my_account_ids).

-- 1. Herds and members --------------------------------------------------------

create table public.herds (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and length(name) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger herds_updated_at
  before update on public.herds
  for each row execute function public.set_updated_at();

create table public.herd_members (
  herd_id uuid not null references public.herds (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (herd_id, user_id),
  -- One herd per user: what makes private.my_herd_id() a single value.
  unique (user_id)
);

alter table public.herds enable row level security;
alter table public.herd_members enable row level security;

-- "<name>'s herd", cut to fit the check.
create function public.default_herd_name(display_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(left(coalesce(nullif(btrim(display_name), ''), 'My') || '''s herd', 40))
$$;

-- A personal herd for everyone who exists today.
do $$
declare
  u record;
  h uuid;
begin
  for u in select a.id, p.display_name from auth.users a left join public.profiles p on p.user_id = a.id loop
    insert into public.herds (name) values (public.default_herd_name(u.display_name)) returning id into h;
    insert into public.herd_members (herd_id, user_id, role) values (h, u.id, 'owner');
  end loop;
end;
$$;

-- New users get their profile (9a) and their personal herd.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_herd uuid;
begin
  v_name := coalesce(
    public.clean_display_name(new.raw_user_meta_data ->> 'display_name'),
    public.clean_display_name(split_part(new.email, '@', 1)),
    'Me'
  );
  insert into public.profiles (user_id, display_name) values (new.id, v_name);
  insert into public.herds (name) values (public.default_herd_name(v_name)) returning id into v_herd;
  insert into public.herd_members (herd_id, user_id, role) values (v_herd, new.id, 'owner');
  return new;
end;
$$;

-- 2. RLS helpers -----------------------------------------------------------------
-- In a schema PostgREST does not expose, so they are callable only from
-- policies, views and column defaults. Security definer so they read
-- herd_members and accounts without recursing through those tables' own RLS.

create schema private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create function private.my_herd_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.herd_id from public.herd_members m where m.user_id = (select auth.uid())
$$;

revoke execute on function private.my_herd_id() from public;
grant execute on function private.my_herd_id() to authenticated;

-- 3. Plaid data: herd_id from the item, consistent by construction ------------

alter table public.plaid_items add column herd_id uuid references public.herds (id) on delete cascade;
update public.plaid_items i set herd_id = m.herd_id from public.herd_members m where m.user_id = i.user_id;
alter table public.plaid_items alter column herd_id set not null;
alter table public.plaid_items add constraint plaid_items_id_herd_key unique (id, herd_id);
create index plaid_items_herd_id_idx on public.plaid_items (herd_id);

-- Moving a bank to another herd is one update of plaid_items.herd_id: these
-- composite keys cascade it to every account, and from each account to its
-- transactions, snapshots and streams, so nothing can be left behind.
alter table public.accounts
  add column herd_id uuid,
  add column is_private boolean not null default false;
update public.accounts a set herd_id = i.herd_id from public.plaid_items i where i.id = a.item_id;
alter table public.accounts alter column herd_id set not null;
alter table public.accounts
  add constraint accounts_item_herd_fkey foreign key (item_id, herd_id)
    references public.plaid_items (id, herd_id) on update cascade on delete cascade,
  add constraint accounts_id_herd_key unique (id, herd_id);
create index accounts_herd_id_idx on public.accounts (herd_id);

alter table public.transactions add column herd_id uuid;
update public.transactions t set herd_id = a.herd_id from public.accounts a where a.id = t.account_id;
alter table public.transactions alter column herd_id set not null;
alter table public.transactions
  add constraint transactions_account_herd_fkey foreign key (account_id, herd_id)
    references public.accounts (id, herd_id) on update cascade on delete cascade;

alter table public.balance_snapshots add column herd_id uuid;
update public.balance_snapshots s set herd_id = a.herd_id from public.accounts a where a.id = s.account_id;
alter table public.balance_snapshots alter column herd_id set not null;
alter table public.balance_snapshots
  add constraint balance_snapshots_account_herd_fkey foreign key (account_id, herd_id)
    references public.accounts (id, herd_id) on update cascade on delete cascade;

alter table public.recurring_streams add column herd_id uuid;
update public.recurring_streams r set herd_id = a.herd_id from public.accounts a where a.id = r.account_id;
alter table public.recurring_streams alter column herd_id set not null;
alter table public.recurring_streams
  add constraint recurring_streams_account_herd_fkey foreign key (account_id, herd_id)
    references public.accounts (id, herd_id) on update cascade on delete cascade;

-- The server never names herd_id on Plaid data: this fills it from the parent
-- row, so no call site can forget it (or write a wrong one: the composite
-- keys above reject any herd_id that disagrees with the parent's).
create function public.fill_herd_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.herd_id is null then
    if tg_table_name = 'plaid_items' then
      select m.herd_id into new.herd_id from public.herd_members m where m.user_id = new.user_id;
    elsif tg_table_name = 'accounts' then
      select i.herd_id into new.herd_id from public.plaid_items i where i.id = new.item_id;
    else
      select a.herd_id into new.herd_id from public.accounts a where a.id = new.account_id;
    end if;
  end if;
  return new;
end;
$$;

-- Named "aa_" so it fires before the category check below (triggers fire in name order).
create trigger aa_fill_herd_id before insert on public.plaid_items
  for each row execute function public.fill_herd_id();
create trigger aa_fill_herd_id before insert on public.accounts
  for each row execute function public.fill_herd_id();
create trigger aa_fill_herd_id before insert on public.transactions
  for each row execute function public.fill_herd_id();
create trigger aa_fill_herd_id before insert on public.balance_snapshots
  for each row execute function public.fill_herd_id();
create trigger aa_fill_herd_id before insert on public.recurring_streams
  for each row execute function public.fill_herd_id();

-- Visible accounts: my herd's, minus the ones another member keeps private.
create function private.my_account_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(a.id), '{}')
  from public.accounts a
  where a.herd_id = (select private.my_herd_id())
    and (not a.is_private or a.user_id = (select auth.uid()))
$$;

revoke execute on function private.my_account_ids() from public;
grant execute on function private.my_account_ids() to authenticated;

-- 4. Configuration: the herd's, not the user's ---------------------------------

-- Views read the columns this migration drops; they are rebuilt in step 6.
drop view public.user_categories;
drop view public.monthly_category_totals;
drop view public.daily_net_worth;

drop policy "Users see built-in categories and their own" on public.categories;
drop policy "Users add their own categories" on public.categories;
drop policy "Users edit their own categories" on public.categories;
alter table public.categories add column herd_id uuid references public.herds (id) on delete cascade;
update public.categories c set herd_id = m.herd_id from public.herd_members m where m.user_id = c.user_id;
alter table public.categories drop constraint categories_slug_iff_builtin;
alter table public.categories drop column user_id;
-- null = built-in. Defaulted so a client insert never names it; a migration's
-- insert gets null, because there is no caller outside a request.
alter table public.categories alter column herd_id set default private.my_herd_id();
alter table public.categories add constraint categories_slug_iff_builtin check ((herd_id is null) = (slug is not null));
create index categories_herd_id_idx on public.categories (herd_id);

drop policy "Users can view their own budgets" on public.budgets;
drop policy "Users can create their own budgets" on public.budgets;
drop policy "Users can change their own budgets" on public.budgets;
drop policy "Users can delete their own budgets" on public.budgets;
alter table public.budgets add column herd_id uuid references public.herds (id) on delete cascade;
update public.budgets b set herd_id = m.herd_id from public.herd_members m where m.user_id = b.user_id;
alter table public.budgets alter column herd_id set not null;
alter table public.budgets alter column herd_id set default private.my_herd_id();
alter table public.budgets drop constraint budgets_user_id_category_id_key;
alter table public.budgets drop column user_id;
alter table public.budgets add constraint budgets_herd_id_category_id_key unique (herd_id, category_id);

drop policy "Users see their own category overrides" on public.category_overrides;
drop policy "Users add their own category overrides" on public.category_overrides;
drop policy "Users change their own category overrides" on public.category_overrides;
drop policy "Users remove their own category overrides" on public.category_overrides;
alter table public.category_overrides add column herd_id uuid references public.herds (id) on delete cascade;
update public.category_overrides o set herd_id = m.herd_id from public.herd_members m where m.user_id = o.user_id;
alter table public.category_overrides alter column herd_id set not null;
alter table public.category_overrides alter column herd_id set default private.my_herd_id();
alter table public.category_overrides drop constraint category_overrides_pkey;
alter table public.category_overrides drop column user_id;
alter table public.category_overrides add primary key (herd_id, category_id);

drop policy "Users see their own merchant rules" on public.merchant_rules;
alter table public.merchant_rules add column herd_id uuid references public.herds (id) on delete cascade;
update public.merchant_rules r set herd_id = m.herd_id from public.herd_members m where m.user_id = r.user_id;
alter table public.merchant_rules alter column herd_id set not null;
alter table public.merchant_rules drop constraint merchant_rules_user_id_merchant_key_key;
alter table public.merchant_rules drop column user_id;
alter table public.merchant_rules add constraint merchant_rules_herd_id_merchant_key_key unique (herd_id, merchant_key);

-- The built-in marker is herd_id now.
create or replace function public.categories_enforce_tree()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent record;
begin
  if new.parent_id is null then
    return new;
  end if;
  if exists (select 1 from public.categories c where c.parent_id = new.id) then
    raise exception 'a group with children cannot itself have a parent';
  end if;
  select c.parent_id, c.herd_id, c.kind into parent from public.categories c where c.id = new.parent_id;
  if not found then
    raise exception 'parent category % does not exist', new.parent_id;
  end if;
  if parent.parent_id is not null or parent.herd_id is not null then
    raise exception 'a category''s parent must be a built-in group';
  end if;
  new.kind := parent.kind;
  return new;
end;
$$;

create or replace function public.category_overrides_builtin_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.categories c where c.id = new.category_id and c.herd_id is null
  ) then
    raise exception 'only built-in categories take overrides';
  end if;
  return new;
end;
$$;

-- A row may only point at a built-in or its own herd's category. A foreign
-- key check bypasses RLS, so without this a client could file a transaction
-- under another herd's custom category. Fires on herd_id changes too, which
-- is why leaving a herd remaps custom categories before moving the banks.
create function public.category_in_herd()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category_id is not null and not exists (
    select 1 from public.categories c
    where c.id = new.category_id and (c.herd_id is null or c.herd_id = new.herd_id)
  ) then
    raise exception 'category % is not available to this herd', new.category_id;
  end if;
  return new;
end;
$$;

create trigger category_in_herd before insert or update of category_id, herd_id on public.transactions
  for each row execute function public.category_in_herd();
create trigger category_in_herd before insert or update of category_id, herd_id on public.recurring_streams
  for each row execute function public.category_in_herd();
create trigger category_in_herd before insert or update of category_id, herd_id on public.budgets
  for each row execute function public.category_in_herd();
create trigger category_in_herd before insert or update of category_id, herd_id on public.merchant_rules
  for each row execute function public.category_in_herd();

-- 5. Policies --------------------------------------------------------------------

drop policy "Users can view their own items" on public.plaid_items;
drop policy "Users can view their own accounts" on public.accounts;
drop policy "Users can update their own accounts" on public.accounts;
drop policy "Users can view their own transactions" on public.transactions;
drop policy "Users can recategorize their own transactions" on public.transactions;
drop policy "Users can view their own balance history" on public.balance_snapshots;
drop policy "Users can view their own recurring streams" on public.recurring_streams;
drop policy "Users can dismiss their own recurring streams" on public.recurring_streams;

create policy "Members see their herd" on public.herds for select to authenticated
  using (id = (select private.my_herd_id()));
create policy "Members see their herd's members" on public.herd_members for select to authenticated
  using (herd_id = (select private.my_herd_id()));

-- A bank shows if you connected it or can see one of its accounts.
create policy "Members see their herd's banks" on public.plaid_items for select to authenticated
  using (
    herd_id = (select private.my_herd_id())
    and (user_id = (select auth.uid()) or exists (select 1 from public.accounts a where a.item_id = plaid_items.id))
  );

create policy "Members see visible accounts" on public.accounts for select to authenticated
  using (id = any ((select private.my_account_ids())::uuid[]));
create policy "Members update visible accounts" on public.accounts for update to authenticated
  using (id = any ((select private.my_account_ids())::uuid[]))
  with check (id = any ((select private.my_account_ids())::uuid[]));

create policy "Members see visible transactions" on public.transactions for select to authenticated
  using (herd_id = (select private.my_herd_id()) and account_id = any ((select private.my_account_ids())::uuid[]));
create policy "Members update visible transactions" on public.transactions for update to authenticated
  using (herd_id = (select private.my_herd_id()) and account_id = any ((select private.my_account_ids())::uuid[]))
  with check (herd_id = (select private.my_herd_id()) and account_id = any ((select private.my_account_ids())::uuid[]));

create policy "Members see visible balance history" on public.balance_snapshots for select to authenticated
  using (herd_id = (select private.my_herd_id()) and account_id = any ((select private.my_account_ids())::uuid[]));

create policy "Members see visible recurring streams" on public.recurring_streams for select to authenticated
  using (herd_id = (select private.my_herd_id()) and account_id = any ((select private.my_account_ids())::uuid[]));
create policy "Members dismiss visible recurring streams" on public.recurring_streams for update to authenticated
  using (herd_id = (select private.my_herd_id()) and account_id = any ((select private.my_account_ids())::uuid[]))
  with check (herd_id = (select private.my_herd_id()) and account_id = any ((select private.my_account_ids())::uuid[]));

create policy "Members see built-in categories and their herd's" on public.categories for select to authenticated
  using (herd_id is null or herd_id = (select private.my_herd_id()));
create policy "Members add herd categories" on public.categories for insert to authenticated
  with check (herd_id = (select private.my_herd_id()) and parent_id is not null);
create policy "Members edit herd categories" on public.categories for update to authenticated
  using (herd_id = (select private.my_herd_id()))
  with check (herd_id = (select private.my_herd_id()));

create policy "Members see herd budgets" on public.budgets for select to authenticated
  using (herd_id = (select private.my_herd_id()));
create policy "Members create herd budgets" on public.budgets for insert to authenticated
  with check (herd_id = (select private.my_herd_id()));
create policy "Members change herd budgets" on public.budgets for update to authenticated
  using (herd_id = (select private.my_herd_id()))
  with check (herd_id = (select private.my_herd_id()));
create policy "Members delete herd budgets" on public.budgets for delete to authenticated
  using (herd_id = (select private.my_herd_id()));

create policy "Members see herd category overrides" on public.category_overrides for select to authenticated
  using (herd_id = (select private.my_herd_id()));
create policy "Members add herd category overrides" on public.category_overrides for insert to authenticated
  with check (herd_id = (select private.my_herd_id()));
create policy "Members change herd category overrides" on public.category_overrides for update to authenticated
  using (herd_id = (select private.my_herd_id()))
  with check (herd_id = (select private.my_herd_id()));
create policy "Members remove herd category overrides" on public.category_overrides for delete to authenticated
  using (herd_id = (select private.my_herd_id()));

create policy "Members see herd merchant rules" on public.merchant_rules for select to authenticated
  using (herd_id = (select private.my_herd_id()));

grant select on public.herds, public.herd_members to authenticated;

-- 6. Views: same shape, herd filters. security_invoker applies the policies
-- above (private accounts included); the redundant herd predicate fails closed
-- if a later replace ever drops the flag.

create view public.monthly_category_totals
with (security_invoker = on) as
select
  date_trunc('month', t.date::timestamp)::date as month,
  t.category_id,
  t.iso_currency_code,
  sum(t.amount)  as total,
  count(*)::int  as transaction_count
from public.transactions t
join public.accounts a on a.id = t.account_id
where t.herd_id = (select private.my_herd_id())
  and not a.hidden
group by 1, 2, 3;

create view public.daily_net_worth
with (security_invoker = on) as
select
  s.date,
  sum(case when a.type in ('credit', 'loan') then -s.balance else s.balance end) as net_worth
from public.balance_snapshots s
join public.accounts a on a.id = s.account_id
where s.herd_id = (select private.my_herd_id())
  and not a.hidden
group by s.date;

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
  c.herd_id is not null as is_custom,
  o.category_id is not null as overridden
from public.categories c
left join public.category_overrides o
  on o.category_id = c.id and o.herd_id = (select private.my_herd_id())
where c.herd_id is null or c.herd_id = (select private.my_herd_id());

grant select on public.monthly_category_totals, public.daily_net_worth, public.user_categories to authenticated;

-- 7. Indexes: the read paths now filter on herd_id --------------------------------

drop index public.transactions_feed_idx;
drop index public.transactions_user_merchant_key_idx;
drop index public.transactions_unreviewed_idx;
drop index public.balance_snapshots_user_date_idx;
drop index public.recurring_streams_user_next_idx;
create index transactions_feed_idx on public.transactions (herd_id, date desc, id desc);
create index transactions_herd_merchant_key_idx on public.transactions (herd_id, merchant_key);
create index transactions_unreviewed_idx on public.transactions (herd_id, date, id)
  where reviewed_at is null and not pending;
create index balance_snapshots_herd_date_idx on public.balance_snapshots (herd_id, date);
create index recurring_streams_herd_next_idx on public.recurring_streams (herd_id, next_date);

-- 8. Functions stay unreachable as RPCs -------------------------------------------

revoke execute on function
  public.default_herd_name(text), public.fill_herd_id(), public.category_in_herd()
from public, anon, authenticated;
