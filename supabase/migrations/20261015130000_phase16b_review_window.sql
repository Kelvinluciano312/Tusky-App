-- Phase 16b: only the last two weeks go to review. A transaction sync inserts
-- more than 14 days before its Item was linked is marked reviewed by the
-- system (`auto_reviewed`), so a first connect does not bury the queue in the
-- bank's whole history. Sync does it (REVIEW_WINDOW_DAYS in _shared/review.ts);
-- this migration adds the flag, keeps it out of learning, and backfills.

alter table public.transactions
  add column auto_reviewed boolean not null default false;

comment on column public.transactions.auto_reviewed is
  'Marked reviewed by the system (16b), not by a person: older than the review window when its Item was linked. Never teaches learning (12a) or the crowd (12c).';

-- No grants on purpose, like the Jev columns: the table-level SELECT authenticated
-- already has covers reading it, and there is no UPDATE grant, so only the
-- service role (sync) and this migration write it.

-- A guess nobody looked at is not an accepted guess (12a): leave auto-reviewed
-- rows out of the labels learning reads. Same function, one more condition.
create or replace function public.merchant_labels(p_herd uuid, p_keys text[], p_limit int)
returns table (
  merchant_key text,
  amount numeric,
  category_id uuid,
  date date,
  user_id uuid,
  is_private boolean
)
language sql
stable
set search_path = ''
as $$
  select l.merchant_key, l.amount, l.category_id, l.date, l.user_id, l.is_private
  from (
    select t.merchant_key, t.amount, t.category_id, t.date, t.user_id, a.is_private,
      row_number() over (partition by t.merchant_key, t.amount > 0 order by t.date desc, t.id desc) as n
    from public.transactions t
    join public.accounts a on a.id = t.account_id
    where t.herd_id = p_herd
      and t.merchant_key = any (p_keys)
      and t.category_id is not null
      and (
        t.category_is_manual
        -- An accepted guess (GUESSED_SOURCES in _shared/learn.ts) is a label too,
        -- but only when a person accepted it (not auto_reviewed, 16b).
        or (t.category_source in ('learned', 'community', 'ai') and t.reviewed_at is not null
            and not t.auto_reviewed)
      )
  ) l
  where l.n <= p_limit
$$;

revoke execute on function public.merchant_labels(uuid, text[], int) from public, anon, authenticated;
grant execute on function public.merchant_labels(uuid, text[], int) to service_role;

-- Putting a row back in the queue (a question, 15d, or an undo) hands it to a
-- person again: whoever reviews it next counts. Fires only when reviewed_at
-- goes from set to null.
create function public.transactions_clear_auto_reviewed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.reviewed_at is not null and new.reviewed_at is null then
    new.auto_reviewed := false;
  end if;
  return new;
end;
$$;

revoke execute on function public.transactions_clear_auto_reviewed() from public, anon, authenticated;

create trigger ag_transactions_clear_auto_reviewed
  before update of reviewed_at on public.transactions
  for each row execute function public.transactions_clear_auto_reviewed();

-- Backfill: unreviewed, posted rows dated before their Item's link date minus
-- 14 days, with no open question on them. Runs as postgres with no auth.uid(),
-- so the crowd-label trigger (12c, acts only for auth.uid()) and the
-- answer-questions trigger (15d, returns when auth.uid() is null) do nothing.
update public.transactions t
  set reviewed_at = now(), auto_reviewed = true
  from public.plaid_items i
  where i.id = t.item_id
    and t.reviewed_at is null
    and not t.pending
    and t.date < ((i.created_at at time zone 'utc')::date - 14)
    and not exists (
      select 1 from public.transaction_questions q
      where q.transaction_id = t.id and q.resolved_at is null
    );
