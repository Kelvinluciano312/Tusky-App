-- Phase 17: demo Items for Apple App Review.
--
-- A reviewer needs a signed-in account with data on the production build, but
-- cannot be expected to link a real US bank. The demo account's bank is seeded
-- straight into the tables (scripts/demo-seed.mjs): no Plaid Item, no access
-- token. This flag is how the server tells such an Item from a real one, so that
-- sync, the webhook and the plan enforcer never ask Plaid about it.
--
-- Disconnecting and deleting an account need no flag: disconnectItem skips the
-- Plaid call when an Item has no plaid_tokens row, and the demo Item never has one.
alter table public.plaid_items add column is_demo boolean not null default false;

comment on column public.plaid_items.is_demo is
  'Seeded for App Review. No Plaid Item and no token exist: sync, webhooks and the plan enforcer skip it.';
