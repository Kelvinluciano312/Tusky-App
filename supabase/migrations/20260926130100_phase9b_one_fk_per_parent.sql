-- Phase 9b follow-up: one foreign key per parent. 9b added composite keys
-- (item_id, herd_id) and (account_id, herd_id) next to the original
-- single-column ones, and two relationships between the same tables make
-- PostgREST refuse to embed (`plaid_items!inner(...)`, `accounts!inner(...)`:
-- PGRST201 "more than one relationship"). The composite keys already enforce
-- existence (both columns are not null) and cascade deletes, so the old keys
-- add nothing.

alter table public.accounts drop constraint accounts_item_id_fkey;
alter table public.transactions drop constraint transactions_account_id_fkey;
alter table public.balance_snapshots drop constraint balance_snapshots_account_id_fkey;
alter table public.recurring_streams drop constraint recurring_streams_account_id_fkey;
