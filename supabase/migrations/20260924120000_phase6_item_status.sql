-- Phase 6: an Item is live (active, login_required) or archived — removed at
-- Plaid, token deleted, history kept. The old inline comment listed
-- `disconnected`, which nothing ever wrote.
alter table public.plaid_items
  add constraint plaid_items_status_check check (status in ('active', 'login_required', 'archived'));
comment on column public.plaid_items.status is 'active | login_required | archived';
