-- Proves the database half of the payer carry (9d/11b): a pending row's hand-picked payer, Joint
-- or split lands on the posted row that replaces it. It replays sync's exact statements (the
-- upsert that never names paid_by, then syncItem's follow-up updates), with Kel Test joined to
-- the test user's herd. The block always ends in RAISE, so every change rolls back; the result
-- is in the error text. carryForward and the stillMembers filter are unit-tested in Deno.
--
-- Dev only:  npx -y supabase@2.118.0 db query --linked -f scripts/payer-carry-check.sql
-- Expect:    after insert every R row = me (the account owner); then R1 kel + memo, R2 split
--            {kel 40, me 60} with paid_by null, R3 untouched (already picked), R4 Joint;
--            and "leaver payer refused".
do $$
declare
  me uuid := 'ccbd42ef-cba6-4f05-a100-a83a727255b2';
  kel uuid := '706f7db5-e7e2-4024-bfe3-de3e23954ed2';
  h uuid; acct uuid; itm uuid; owner uuid;
  r record; out text := '';
begin
  select herd_id into h from herd_members where user_id = me;
  update herd_members set herd_id = h where user_id = kel;          -- Kel joins (rolled back)
  select a.id, a.item_id, a.owner_id into acct, itm, owner
    from accounts a join plaid_items i on i.id = a.item_id
    where a.user_id = me and i.status = 'active' and not a.is_private limit 1;
  out := out || format('owner=%s; ', case owner when me then 'me' when kel then 'kel' else coalesce(owner::text,'joint') end);

  -- Pending rows with hand-picked payers, as the app writes them.
  insert into transactions (user_id, account_id, item_id, plaid_transaction_id, name, amount, date, pending, paid_by, paid_by_is_manual, notes)
  values (me, acct, itm, 'cf-P1', 'Carry test', -12.34, current_date, true, kel,  true, 'memo one'),
         (me, acct, itm, 'cf-P4', 'Carry test', -4.00,  current_date, true, null, true, null);
  insert into transactions (user_id, account_id, item_id, plaid_transaction_id, name, amount, date, pending, split)
  values (me, acct, itm, 'cf-P2', 'Carry test', -50.00, current_date, true, jsonb_build_object(me::text, 60, kel::text, 40));

  -- Sync's upsert of the posted rows (payload never names paid_by / notes).
  insert into transactions (user_id, account_id, item_id, plaid_transaction_id, pending_transaction_id, name, amount, date, pending)
  values (me, acct, itm, 'cf-R1', 'cf-P1', 'Carry test', -12.34, current_date, false),
         (me, acct, itm, 'cf-R2', 'cf-P2', 'Carry test', -50.00, current_date, false),
         (me, acct, itm, 'cf-R4', 'cf-P4', 'Carry test', -4.00,  current_date, false);
  -- R3: payer already picked by hand on the posted row before the carry lands.
  insert into transactions (user_id, account_id, item_id, plaid_transaction_id, pending_transaction_id, name, amount, date, pending, paid_by, paid_by_is_manual)
  values (me, acct, itm, 'cf-R3', 'cf-P1', 'Carry test', -12.34, current_date, false, me, true);

  select string_agg(plaid_transaction_id || ':' || coalesce(paid_by::text,'null'), ' ') into r
    from transactions where plaid_transaction_id in ('cf-R1','cf-R2','cf-R4');
  out := out || 'after insert: ' || replace(replace(r.string_agg, me::text, 'me'), kel::text, 'kel') || '; ';

  -- Exactly sync's follow-up statements.
  update transactions set notes = 'memo one' where plaid_transaction_id = 'cf-R1' and notes is null;
  update transactions set paid_by = kel,  paid_by_is_manual = true, split = null where plaid_transaction_id = 'cf-R1' and paid_by_is_manual = false;
  update transactions set paid_by = null, paid_by_is_manual = true, split = jsonb_build_object(me::text, 60, kel::text, 40) where plaid_transaction_id = 'cf-R2' and paid_by_is_manual = false;
  update transactions set paid_by = null, paid_by_is_manual = true, split = null where plaid_transaction_id = 'cf-R4' and paid_by_is_manual = false;
  update transactions set paid_by = kel,  paid_by_is_manual = true, split = null where plaid_transaction_id = 'cf-R3' and paid_by_is_manual = false;

  for r in select plaid_transaction_id p, paid_by, paid_by_is_manual m, split, notes, herd_id from transactions
           where plaid_transaction_id like 'cf-R%' order by 1 loop
    out := out || format('%s paid_by=%s manual=%s split=%s notes=%s herd_ok=%s | ', r.p,
      case r.paid_by when me then 'me' when kel then 'kel' else coalesce(r.paid_by::text,'null') end,
      r.m, replace(replace(coalesce(r.split::text,'null'), me::text, 'me'), kel::text, 'kel'), coalesce(r.notes,'null'), r.herd_id = h);
  end loop;

  -- A leaver's payer must be refused by the trigger (why sync filters stillMembers).
  begin
    delete from herd_members where user_id = kel;
    update transactions set paid_by = kel, paid_by_is_manual = true where plaid_transaction_id = 'cf-R4';
    out := out || 'leaver payer ACCEPTED (bad)';
  exception when check_violation then out := out || 'leaver payer refused: ' || sqlerrm;
  end;
  raise exception 'RESULT %', out;
end $$;
