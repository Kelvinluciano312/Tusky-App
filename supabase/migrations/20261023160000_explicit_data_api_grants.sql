-- Explicit Data API grants ahead of Supabase's Oct 30, 2026 change.
--
-- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically
-- From Oct 30, 2026 Supabase stops granting anon / authenticated / service_role
-- privileges on NEW tables (and functions/sequences) in public. Existing objects
-- keep their grants; RLS is unchanged. A missing grant shows up as PostgREST
-- error 42501 "permission denied for table ...".
--
-- Tusky has been fail-closed for anon/authenticated since
-- 20260924120100_phase6_revoke_default_grants.sql, and every client grant below
-- already exists in production (audited 2026-10-22 against pg_class.relacl,
-- pg_attribute.attacl and pg_proc.proacl). The change that still bites us is
-- service_role: Edge Functions relied on postgres's default privileges to reach
-- new tables, and those go away. This migration:
--   1. re-asserts service_role on every existing public table, view, sequence
--      and function, so nothing depends on default privileges any more;
--   2. re-states the exact authenticated grants the app uses (table and column
--      level), so the schema's intended client surface lives in one place.
-- GRANT is additive and idempotent: nothing here widens access that exists
-- today, and anon gets nothing (the app has no pre-auth Data API reads; sign-in
-- and sign-up go through Supabase Auth, not PostgREST).
--
-- No ALTER DEFAULT PRIVILEGES: Supabase's recommendation is an explicit GRANT
-- per object in the migration that creates it, and re-adding defaults would
-- just undo the platform change. New tables must grant in their own migration
-- (see CLAUDE.md "Data API grants").

-- 1. service_role (Edge Functions, cron, webhooks). RLS is bypassed by this role.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
-- transactions keeps explicit column grants for service_role too (from 20261023120000).
grant select (answered_by, review_assignee), update (answered_by, review_assignee)
  on public.transactions to service_role;

-- 2. authenticated (the mobile app, always behind RLS).
grant usage on schema public to authenticated;

-- Read-only tables and security_invoker views.
grant select on
  public.accounts, public.balance_snapshots, public.categories, public.consents,
  public.herd_invites, public.herd_members, public.herds, public.merchant_rules,
  public.plaid_items, public.plans, public.profiles, public.recurring_streams,
  public.subscriptions, public.transactions,
  public.daily_net_worth, public.monthly_category_totals, public.monthly_person_totals,
  public.shared_lines, public.user_categories
to authenticated;

-- Full DML where RLS with-check pins ownership and no column is server-owned.
grant select, insert, update, delete on public.budgets, public.category_overrides to authenticated;
grant select, insert, update on public.notification_prefs to authenticated;
grant select, delete on public.push_tokens, public.settlements, public.transaction_questions to authenticated;

-- Column-level writes (everything else on these tables is server-owned).
grant update (hidden, in_totals, is_private, owner_id) on public.accounts to authenticated;
grant insert (name, icon, color, parent_id), update (name, icon, color) on public.categories to authenticated;
grant update (name) on public.herds to authenticated;
grant update (display_name, ai_categorize, onboarded_at) on public.profiles to authenticated;
grant update (dismissed) on public.recurring_streams to authenticated;
grant insert (from_user, to_user, amount, date, note) on public.settlements to authenticated;
grant insert (transaction_id, asked_to, body), update (resolved_at) on public.transaction_questions to authenticated;
grant select (answered_by, review_assignee),
  update (category_id, category_is_manual, notes, paid_by, paid_by_is_manual, reviewed_at, split)
  on public.transactions to authenticated;

-- RPCs the app calls with the user's JWT.
grant execute on function
  public.accept_terms(text), public.my_plan(), public.my_second_step_done(),
  public.register_push_token(text, text), public.unregister_push_token(text),
  public.replace_budgets(jsonb), public.set_consent(text, boolean), public.set_two_factor(boolean)
to authenticated;

-- Service-only tables, RPCs and sequences get no client grants (RLS-no-policy tables:
-- ai_category_cache, ai_custom_cache, community_labels, notification_log, plaid_category_map,
-- plaid_detailed_map, plaid_events, plaid_tokens, two_factor_failures, two_factor_sessions).
