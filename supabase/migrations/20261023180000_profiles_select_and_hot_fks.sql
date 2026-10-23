-- One SELECT policy on profiles, and indexes for the hot unindexed foreign keys.
--
-- Profiles had two permissive SELECT policies, which Postgres ORs together:
--   "Users see their own profile"  — (select auth.uid()) = user_id
--   "Members see their herd mates' profiles" — a herd_members row in private.my_herd_id()
-- An unverified two-step session has a null my_herd_id(), so the own-row half
-- has to stay or the first-run gate cannot read the signed-in profile. The
-- merged policy is that same OR. UPDATE is unchanged (own row only).
--
-- Indexes below are the remainder that shows up on the large, frequently
-- joined tables. Already indexed and left alone: transactions.user_id,
-- category_id, paid_by, review_assignee and herd_id; settlements.herd_id;
-- transaction_questions.asked_to (partial) and transaction_id; herd_members'
-- primary key. Skipped as small or cold: accounts.owner_id, settlements.created_by,
-- transaction_questions.asked_by, recurring_streams.category_id. pg_net is not
-- touched (Supabase owns that schema; its queue indexes are not ours to add).

drop policy "Users see their own profile" on public.profiles;
drop policy "Members see their herd mates' profiles" on public.profiles;

create policy "Members see their own profile and their herd mates"
  on public.profiles for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1 from public.herd_members m
      where m.user_id = profiles.user_id
        and m.herd_id = (select private.my_herd_id())
    )
  );

create index transactions_answered_by_idx
  on public.transactions (answered_by)
  where answered_by is not null;

create index transaction_questions_herd_id_idx
  on public.transaction_questions (herd_id);

create index settlements_from_user_idx
  on public.settlements (from_user);

create index settlements_to_user_idx
  on public.settlements (to_user);
