-- Phase 15d: "spent by", and asking a herd mate about a transaction.
--
-- 1. transactions.paid_by now means who spent it: a tag for organizing a joint
--    account, never a debt by itself. Only a split creates a debt, so
--    shared_lines keeps just the split rows (lib/settle.ts follows). Recorded
--    settlements stay; balances made only by a person tag disappear.
-- 2. transaction_questions: one member asks another what a transaction was.
--    Asking puts the row back in the review queue; the asked member answers
--    by tagging who spent it or writing the memo, then resolves the question.

-- ── 1. Debts only from splits ──────────────────────────────────────────────
create or replace view public.shared_lines
with (security_invoker = on) as
select
  t.id,
  t.date,
  t.amount,
  a.owner_id as funded_by,
  t.paid_by,
  t.split,
  t.category_id,
  t.merchant_name,
  t.name
from public.transactions t
join public.accounts a on a.id = t.account_id
left join public.categories c on c.id = t.category_id
where t.herd_id = (select private.my_herd_id())
  and not t.pending
  and not a.is_private
  and not a.hidden
  and coalesce(c.kind, 'expense') = 'expense'
  and t.split is not null;

-- ── 2. Questions ───────────────────────────────────────────────────────────
-- (id, herd_id) lets a question follow its transaction when the bank moves to
-- another herd, as accounts follow their Item.
alter table public.transactions add constraint transactions_id_herd_key unique (id, herd_id);

create table public.transaction_questions (
  id uuid primary key default gen_random_uuid(),
  herd_id uuid not null default private.my_herd_id() references public.herds (id) on delete cascade,
  transaction_id uuid not null,
  asked_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  asked_to uuid not null references auth.users (id) on delete cascade,
  body text check (body is null or (body = btrim(body) and length(body) between 1 and 280)),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint transaction_questions_transaction_fkey foreign key (transaction_id, herd_id)
    references public.transactions (id, herd_id) on update cascade on delete cascade,
  constraint transaction_questions_not_self check (asked_by <> asked_to)
);
create index transaction_questions_open on public.transaction_questions (asked_to) where resolved_at is null;
create index transaction_questions_transaction on public.transaction_questions (transaction_id);

alter table public.transaction_questions enable row level security;

-- Visible to the herd, and only where the transaction is (a private account's
-- rows stay hidden from everyone but its connector).
create policy "Members see herd questions" on public.transaction_questions for select to authenticated
  using (
    herd_id = (select private.my_herd_id())
    and exists (select 1 from public.transactions t where t.id = transaction_id)
  );
create policy "Members ask herd mates" on public.transaction_questions for insert to authenticated
  with check (
    herd_id = (select private.my_herd_id())
    and asked_by = (select auth.uid())
    and private.is_herd_member(herd_id, asked_to)
    and exists (select 1 from public.transactions t where t.id = transaction_id)
  );
create policy "Asker or asked resolves" on public.transaction_questions for update to authenticated
  using (
    herd_id = (select private.my_herd_id())
    and (select auth.uid()) in (asked_by, asked_to)
  );
create policy "Asker takes it back" on public.transaction_questions for delete to authenticated
  using (herd_id = (select private.my_herd_id()) and asked_by = (select auth.uid()));

grant select, delete on public.transaction_questions to authenticated;
grant insert (transaction_id, asked_to, body) on public.transaction_questions to authenticated;
grant update (resolved_at) on public.transaction_questions to authenticated;

-- Asking puts a posted row back in the review queue, where the asked member's
-- open questions come first (orderQueue in lib/review.ts).
create function private.question_requeues()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.transactions set reviewed_at = null
    where id = new.transaction_id and herd_id = new.herd_id and not pending;
  return null;
end;
$$;
revoke execute on function private.question_requeues() from public;

create trigger ai_transaction_questions_requeue
  after insert on public.transaction_questions
  for each row execute function private.question_requeues();
