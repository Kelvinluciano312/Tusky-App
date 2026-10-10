-- Proves plan resolution (Phase 14a): private.effective_plan and public.plan_for, against real
-- dev rows, with Kel Test joined to the test user's herd. Always ends in RAISE, so every change
-- rolls back; the verdict is in the error text.
--
-- Dev only:  npx -y supabase@2.118.0 db query --linked -f scripts/plan-check.sql
-- Expect:    PLAN_CHECK all PASS
do $$
declare
  me  uuid := 'ccbd42ef-cba6-4f05-a100-a83a727255b2';
  kel uuid := '706f7db5-e7e2-4024-bfe3-de3e23954ed2';
  h uuid; kel_home uuid;
  out text := ''; bad int := 0;
  got record;
  live_mine int; live_herd int;
  new_user uuid := gen_random_uuid();
begin
  select herd_id into h from public.herd_members where user_id = me;
  select herd_id into kel_home from public.herd_members where user_id = kel;
  select count(*) into live_mine from public.plaid_items where user_id = me and status <> 'archived';
  select count(*) into live_herd from public.plaid_items where herd_id = h and status <> 'archived';

  -- 1. The migration comped everyone who existed: Tusk, own, no expiry.
  select * into got from public.plan_for(me);
  if got.plan = 'tusk' and got.source = 'own' and got.expires_at is null and got.max_banks = 10
     and got.banks_used = live_mine then out := out || 'comp ok; ';
  else bad := bad + 1; out := out || format('comp BAD %s; ', row_to_json(got)); end if;

  -- 2. An active trial is the trial.
  update public.subscriptions set plan = 'trial', store = 'trial', expires_at = now() + interval '5 days' where user_id = me;
  select * into got from public.plan_for(me);
  if got.plan = 'trial' and got.source = 'trial' and got.max_banks = 1 and got.history_days = 730
    then out := out || 'trial ok; '; else bad := bad + 1; out := out || format('trial BAD %s; ', row_to_json(got)); end if;

  -- 3. An expired trial is free.
  update public.subscriptions set expires_at = now() - interval '1 minute' where user_id = me;
  select * into got from public.plan_for(me);
  if got.plan = 'free' and got.source = 'free' and got.max_banks = 0
    then out := out || 'expired->free ok; '; else bad := bad + 1; out := out || format('expired BAD %s; ', row_to_json(got)); end if;

  -- 4. Status expired never counts, even with a future date; grace does.
  update public.subscriptions set plan = 'tusklet', store = 'play', status = 'expired', expires_at = now() + interval '5 days' where user_id = me;
  select * into got from public.plan_for(me);
  if got.plan = 'free' then out := out || 'status expired ok; '; else bad := bad + 1; out := out || 'status expired BAD; '; end if;
  update public.subscriptions set status = 'grace' where user_id = me;
  select * into got from public.plan_for(me);
  if got.plan = 'tusklet' and got.source = 'own' and got.max_banks = 2 and got.history_days = 365
    then out := out || 'grace ok; '; else bad := bad + 1; out := out || format('grace BAD %s; ', row_to_json(got)); end if;

  -- 5. A herd mate's Tusk Herd beats my Tusklet, and pools the herd's banks.
  update public.herd_members set herd_id = h where user_id = kel;
  update public.subscriptions set plan = 'tusk_herd', store = 'play', status = 'active', expires_at = now() + interval '20 days' where user_id = kel;
  select * into got from public.plan_for(me);
  if got.plan = 'tusk_herd' and got.source = 'herd' and got.scope = 'herd' and got.max_banks = 15
     and got.banks_used = live_herd then out := out || 'herd plan ok; ';
  else bad := bad + 1; out := out || format('herd plan BAD %s; ', row_to_json(got)); end if;

  -- 6. Kel leaves: the cover goes with him.
  update public.herd_members set herd_id = kel_home where user_id = kel;
  select * into got from public.plan_for(me);
  if got.plan = 'tusklet' then out := out || 'leaver ok; '; else bad := bad + 1; out := out || format('leaver BAD %s; ', row_to_json(got)); end if;

  -- 7. Archived banks never count.
  update public.plaid_items set status = 'archived' where user_id = me;
  select * into got from public.plan_for(me);
  if got.banks_used = 0 then out := out || 'archived ok; '; else bad := bad + 1; out := out || format('archived BAD %s; ', got.banks_used); end if;

  -- 8. A new signup starts a 30-day trial.
  insert into auth.users (id, email, raw_user_meta_data, aud, role)
  values (new_user, 'plan-check-' || new_user || '@example.invalid', '{}', 'authenticated', 'authenticated');
  select * into got from public.plan_for(new_user);
  if got.plan = 'trial' and got.expires_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour'
    then out := out || 'signup trial ok; '; else bad := bad + 1; out := out || format('signup BAD %s; ', row_to_json(got)); end if;

  raise exception 'PLAN_CHECK % | %', case when bad = 0 then 'all PASS' else bad || ' FAILED' end, out;
end $$;
