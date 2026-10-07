-- Supabase advisor findings (2026-10-06 review).
--
-- 1. auth_rls_initplan: the category map's policy called auth.role() per row.
--    `using (true)` evaluates nothing per row. The policy is the only gate that
--    matters: Phase 6 revoked every client grant on this table (the service role
--    reads it), so authenticated cannot select it either way. Grants unchanged.
drop policy if exists "Category map is readable by all signed-in users" on public.plaid_category_map;
create policy "Category map is readable by all signed-in users"
  on public.plaid_category_map for select to authenticated
  using (true);

-- 2. Unindexed foreign keys that deletes (a category, a member, an account) scan.
--    No equivalent index existed: transactions has feed, account_id, item_id,
--    herd_merchant_key and unreviewed only.
create index if not exists transactions_category_id_idx on public.transactions (category_id);
create index if not exists transactions_paid_by_idx on public.transactions (paid_by) where paid_by is not null;
create index if not exists transactions_user_id_idx on public.transactions (user_id);
