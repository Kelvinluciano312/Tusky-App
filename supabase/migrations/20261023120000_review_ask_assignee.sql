-- An ask goes to one herd member's review queue.
--
-- Asking used to clear reviewed_at, which put the row back in front of every
-- member. review_assignee names the only member whose queue includes it.
-- Their answer (category, who spent it, a split, a memo, or marking it
-- reviewed) resolves the question and marks the row reviewed for the herd.
-- Taking the question back, or dismissing it, clears the assignee so the
-- shared queue has it again. Undo by the person who answered reopens their ask.

alter table public.transactions
  add column review_assignee uuid references auth.users (id) on delete set null,
  add column answered_by uuid references auth.users (id) on delete set null;

comment on column public.transactions.review_assignee is
  'While set, only this member''s review queue includes the row (an open ask). Null is the shared queue of rows with reviewed_at null. Question triggers write it; clients do not.';

comment on column public.transactions.answered_by is
  'The herd member whose answer resolved an ask (category, who spent it, split, memo, or review). Not set when an ask is dismissed or replaced. Clients do not write it.';

create index transactions_review_assignee_idx
  on public.transactions (review_assignee)
  where review_assignee is not null;

-- The table SELECT grant already lets the app read the new columns. UPDATE stays
-- column-scoped, so authenticated cannot write them. Name service_role anyway:
-- new public columns and tables are not auto-exposed to the Data API.
grant select (review_assignee, answered_by) on public.transactions to authenticated, service_role;
grant update (review_assignee, answered_by) on public.transactions to service_role;
revoke update (review_assignee, answered_by) on public.transactions from anon, authenticated;

-- ── Asking assigns the row ─────────────────────────────────────────────────
create or replace function private.question_requeues()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One open ask owns the row. A newer one closes the older ones.
  update public.transaction_questions
    set resolved_at = now()
    where transaction_id = new.transaction_id
      and herd_id = new.herd_id
      and id <> new.id
      and resolved_at is null;

  update public.transactions
    set reviewed_at = null,
        review_assignee = new.asked_to,
        answered_by = null
    where id = new.transaction_id
      and herd_id = new.herd_id
      and not pending;
  return null;
end;
$$;

revoke execute on function private.question_requeues() from public, anon, authenticated;

-- Closing, deleting, or reopening a question moves the assignee to whoever
-- still has an open ask, or clears it.
create function private.question_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tid uuid := coalesce(new.transaction_id, old.transaction_id);
  hid uuid := coalesce(new.herd_id, old.herd_id);
  still uuid;
begin
  if tg_op = 'UPDATE' and new.resolved_at is not distinct from old.resolved_at then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.resolved_at is null then
    update public.transactions
      set review_assignee = new.asked_to,
          answered_by = null
      where id = tid and herd_id = hid;
    return null;
  end if;
  select q.asked_to into still
    from public.transaction_questions q
    where q.transaction_id = tid
      and q.herd_id = hid
      and q.resolved_at is null
    order by q.created_at desc, q.id desc
    limit 1;
  update public.transactions
    set review_assignee = still
    where id = tid and herd_id = hid;
  return null;
end;
$$;

revoke execute on function private.question_assignment() from public, anon, authenticated;

create trigger ak_transaction_questions_assign
  after update of resolved_at or delete on public.transaction_questions
  for each row execute function private.question_assignment();

-- ── Answering resolves it for the herd ─────────────────────────────────────
create or replace function private.answer_questions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  answered boolean;
  closed bigint;
begin
  if uid is null then return null; end if;  -- sync and other server writes answer nothing
  answered := new.paid_by is distinct from old.paid_by
    or new.split is distinct from old.split
    or new.notes is distinct from old.notes
    or new.category_id is distinct from old.category_id;
  if not answered and not (new.reviewed_at is not null and old.reviewed_at is null) then
    return null;
  end if;
  update public.transaction_questions
    set resolved_at = now()
    where transaction_id = new.id
      and asked_to = uid
      and resolved_at is null;
  get diagnostics closed = row_count;
  -- Only a real answer, not a dismiss or a newer ask, records who determined it.
  -- A review mark is already reviewed. Any other answer counts as one too, so
  -- the row does not drop back into the shared queue when the assignee clears.
  if closed > 0 then
    update public.transactions
      set answered_by = uid,
          reviewed_at = coalesce(reviewed_at, now())
      where id = new.id
        and herd_id = new.herd_id;
  end if;
  return null;
end;
$$;

revoke execute on function private.answer_questions() from public, anon, authenticated;

drop trigger af_transactions_answer_questions on public.transactions;
create trigger af_transactions_answer_questions
  after update of paid_by, split, notes, reviewed_at, category_id on public.transactions
  for each row execute function private.answer_questions();

-- Undo by the person who answered puts the ask back on their queue only.
-- Skipped when this same update assigns a new ask (review_assignee is set).
create function private.question_reopen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  qid uuid;
begin
  if uid is null then return null; end if;
  if old.reviewed_at is null or new.reviewed_at is not null or new.review_assignee is not null then
    return null;
  end if;
  select q.id into qid
    from public.transaction_questions q
    where q.transaction_id = new.id
      and q.herd_id = new.herd_id
      and q.asked_to = uid
      and q.resolved_at is not null
    order by q.resolved_at desc, q.id desc
    limit 1;
  if qid is null then return null; end if;
  update public.transaction_questions set resolved_at = null where id = qid;
  return null;
end;
$$;

revoke execute on function private.question_reopen() from public, anon, authenticated;

create trigger ah_transactions_reopen_question
  after update of reviewed_at on public.transactions
  for each row execute function private.question_reopen();

-- Open asks that already exist get an owner. A second open ask on the same
-- row is closed so only the newest one is in a queue. Direct updates, after
-- the triggers exist: the assignment trigger keeps review_assignee in step
-- when an older ask is closed, and the update below also clears reviewed_at
-- with the assignee set, so the reopen trigger does not resurrect it.
update public.transaction_questions older
  set resolved_at = now()
  where older.resolved_at is null
    and exists (
      select 1 from public.transaction_questions newer
      where newer.transaction_id = older.transaction_id
        and newer.herd_id = older.herd_id
        and newer.resolved_at is null
        and (newer.created_at, newer.id) > (older.created_at, older.id)
    );

update public.transactions t
  set review_assignee = q.asked_to,
      reviewed_at = null
  from (
    select distinct on (transaction_id) transaction_id, herd_id, asked_to
    from public.transaction_questions
    where resolved_at is null
    order by transaction_id, created_at desc, id desc
  ) q
  where t.id = q.transaction_id
    and t.herd_id = q.herd_id
    and not t.pending;
