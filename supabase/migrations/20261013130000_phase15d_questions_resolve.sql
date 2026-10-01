-- Phase 15d: answering resolves the question. When the person a question was
-- for tags who spent it, splits it, writes the memo or reviews the row, their
-- open questions on that row close. Anyone else's edit leaves them open.

create function private.answer_questions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then return null; end if;  -- sync and other server writes answer nothing
  if new.paid_by is distinct from old.paid_by
     or new.split is distinct from old.split
     or new.notes is distinct from old.notes
     or (new.reviewed_at is not null and old.reviewed_at is null) then
    update public.transaction_questions set resolved_at = now()
      where transaction_id = new.id and asked_to = uid and resolved_at is null;
  end if;
  return null;
end;
$$;
revoke execute on function private.answer_questions() from public;

-- "af_": after the ab/ac triggers that settle paid_by and split.
create trigger af_transactions_answer_questions
  after update of paid_by, split, notes, reviewed_at on public.transactions
  for each row execute function private.answer_questions();
