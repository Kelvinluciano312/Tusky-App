-- Phase 14c: RevenueCat's Test Store buys on dev with no Play Console. Its rows
-- carry store 'test'; revenuecat-webhook writes them only where PLAID_ENV is sandbox.
alter table public.subscriptions drop constraint subscriptions_store_check;
alter table public.subscriptions add constraint subscriptions_store_check
  check (store in ('play', 'app_store', 'comp', 'trial', 'test'));
