-- Plaid troubleshooting log. Plaid support and its Item Debugger ask for a
-- request_id, Plaid's item_id and Link's link_session_id; function logs on the
-- Free plan last about a day, so they are kept here instead.
--
-- Server-only: RLS on, no policies, no client grants. Rows are written by
-- recordPlaidEvent (_shared/plaid-log.ts) and read in the dashboard.
--
-- item_id is our plaid_items.id WITHOUT a foreign key, on purpose: "Delete
-- everything" removes the plaid_items row, and the log must outlive it.
-- plaid_item_id (Plaid's own id) is copied in for the same reason. user_id
-- does cascade: deleting an account deletes its log.
create table public.plaid_events (
  id              bigint generated always as identity primary key,
  created_at      timestamptz not null default now(),
  user_id         uuid references auth.users (id) on delete cascade,
  item_id         uuid,
  plaid_item_id   text,
  event           text not null check (event in (
    'link_token_failed', 'exchange_ok', 'exchange_failed',
    'sync_failed', 'login_required', 'remove_failed', 'link_exit'
  )),
  request_id      text,
  link_session_id text,
  institution_id  text,
  link_status     text,
  error_type      text,
  error_code      text,
  error_message   text
);
create index plaid_events_user_idx on public.plaid_events (user_id, created_at desc);
create index plaid_events_created_idx on public.plaid_events (created_at);
alter table public.plaid_events enable row level security;
revoke all on public.plaid_events from public, anon, authenticated;

-- Ninety days is longer than any support thread and short enough to stay small.
select cron.schedule(
  'plaid-events-prune',
  '20 4 * * *',
  $$delete from public.plaid_events where created_at < now() - interval '90 days'$$
);
