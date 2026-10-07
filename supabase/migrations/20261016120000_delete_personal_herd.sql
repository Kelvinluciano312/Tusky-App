-- Deleting an account must never delete a shared herd.
--
-- delete-account checked "am I alone?" once, removed the banks at Plaid (a
-- network call each), then read the user's herd again and deleted it. A join
-- (merge_into_herd) in between moved the user into someone else's herd, and
-- that herd was then deleted with everything in it: the other members' banks,
-- transactions and memberships, and their Plaid tokens without /item/remove.
--
-- delete_personal_herd makes the check and the delete one transaction, under
-- the same locks merge_into_herd and leave_herd take (the member row, then the
-- herd), so a join either finishes first and is seen, or waits and then finds
-- no member row. It returns false, deleting nothing, when the herd has another
-- member or still holds a live bank (one linked or merged in after the Plaid
-- pass: its token is the only way to stop Plaid's billing). The function
-- answers `busy` then, and a retry leaves the herd or removes the bank first.
-- No herd at all is true: an earlier run already deleted it.
create function public.delete_personal_herd(p_user uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_herd uuid;
begin
  select herd_id into v_herd from public.herd_members where user_id = p_user for update;
  if v_herd is null then
    return true;
  end if;
  perform 1 from public.herds where id = v_herd for update;
  if (select count(*) from public.herd_members where herd_id = v_herd) > 1 then
    return false;
  end if;
  if exists (select 1 from public.plaid_items where herd_id = v_herd and status <> 'archived') then
    return false;
  end if;
  delete from public.herds where id = v_herd;
  return true;
end;
$$;

revoke execute on function public.delete_personal_herd(uuid) from public, anon, authenticated;
grant execute on function public.delete_personal_herd(uuid) to service_role;
