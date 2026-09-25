-- Phase 8: transaction review — a memo per transaction and a reviewed mark.
-- New rows arrive unreviewed (sync never writes reviewed_at); everything that
-- exists now is backfilled as reviewed, so nobody starts with a huge queue.
-- See docs/superpowers/specs/2026-09-25-phase-8-transaction-review-design.md.

alter table public.transactions
  add column notes text check (notes is null or length(btrim(notes)) between 1 and 500),
  add column reviewed_at timestamptz;

update public.transactions set reviewed_at = now();

-- The review queue: a user's unreviewed, posted rows, oldest first.
create index transactions_unreviewed_idx on public.transactions (user_id, date, id)
  where reviewed_at is null and not pending;

-- The owner-only update policy (Phase 2) already covers these columns.
grant update (notes, reviewed_at) on public.transactions to authenticated;
