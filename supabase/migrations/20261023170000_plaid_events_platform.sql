-- Link's client OS, and the Link events the phone now forwards.
--
-- plaid-create-link-token records platform on a failed link token. plaid-link-event
-- records it on OPEN, SELECT_INSTITUTION, ERROR and EXIT. Null stays valid:
-- server-side rows (sync, exchange, remove) have no phone, and rows written
-- before this column stay readable.
--
-- Apply this before redeploying those functions. An insert that names `platform`
-- fails until the column exists; recordPlaidEvent swallows that, so the log
-- row is simply lost.

alter table public.plaid_events
  add column platform text;

alter table public.plaid_events
  drop constraint plaid_events_event_check;

alter table public.plaid_events
  add constraint plaid_events_event_check check (event in (
    'link_token_failed', 'exchange_ok', 'exchange_failed',
    'sync_failed', 'login_required', 'remove_failed', 'link_exit',
    'link_open', 'link_select_institution', 'link_error'
  )),
  add constraint plaid_events_platform_check check (platform is null or platform in ('ios', 'android'));

comment on column public.plaid_events.platform is
  'ios or android when the phone named itself (link token or a Link event). Null for server-side rows and for anything else the client sent.';

-- Data API: this table stays server-only. Re-state the grants in the migration
-- that changes it (Oct 2026: new public objects are not exposed automatically).
-- No sequence is created here; plaid_events_id_seq already exists.
grant select, insert, update, delete on table public.plaid_events to service_role;
revoke all on table public.plaid_events from public, anon, authenticated;
