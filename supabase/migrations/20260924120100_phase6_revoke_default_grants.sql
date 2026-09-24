-- This project predates Supabase's "don't auto-expose new tables" default, so
-- anon and authenticated held EVERY privilege (arwdDxtm, TRUNCATE included) on
-- every older table and view. RLS kept users out of each other's rows, but on
-- transactions and accounts a signed-in user could rewrite any column of their
-- own rows. Revoke everything, then grant back exactly what the app uses —
-- the pattern of 20260923181000_recurring_streams_revoke_defaults.sql.
--
-- A table-level REVOKE also revokes that table's column privileges, which is
-- why the column grants are re-issued below.
revoke all on table
  public.plaid_items, public.accounts, public.categories, public.plaid_category_map,
  public.transactions, public.budgets, public.balance_snapshots,
  public.monthly_category_totals, public.daily_net_worth
from anon, authenticated;

-- balance_snapshots: the app never reads it directly, but daily_net_worth is
-- security_invoker, so the caller needs select on its base tables.
grant select on public.plaid_items, public.accounts, public.categories, public.transactions,
  public.balance_snapshots, public.monthly_category_totals, public.daily_net_worth to authenticated;
grant update (hidden) on public.accounts to authenticated;
grant update (category_id, category_is_manual) on public.transactions to authenticated;
-- budgets keeps full DML: its RLS with-check pins user_id, and no column is server-owned.
grant select, insert, update, delete on public.budgets to authenticated;
-- plaid_category_map: nothing. Only the service role reads it (loadSyncContext).

-- Fail closed from here on: tables, sequences and functions that postgres
-- creates in public get no client privileges until a migration grants them.
-- service_role keeps its defaults (Edge Functions need them). supabase_admin's
-- defaults are left alone: migrations run as postgres. Functions still get
-- EXECUTE from PUBLIC by Postgres default — revisit with the first RPC.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
