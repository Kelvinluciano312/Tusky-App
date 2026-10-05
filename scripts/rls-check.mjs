#!/usr/bin/env node
// RLS harness (Phase 9b): proves each user sees exactly their herd's data, minus
// other members' private accounts, and cannot write what they shouldn't.
//
// For every herd member it runs one DO block on the linked database that:
//   1. as the admin, computes what the user SHOULD see;
//   2. switches to the `authenticated` role with that user's id (the same
//      role and claims PostgREST uses), and counts what they DO see;
//   3. tries forbidden writes;
//   4. raises its findings, which rolls back everything it did.
// No credentials are involved and nothing is ever committed.
//
//   node scripts/rls-check.mjs            # every herd member
//   node scripts/rls-check.mjs <user-id>  # one user
//   node scripts/rls-check.mjs --join <joiner> <host>
//   node scripts/rls-check.mjs --join-leave <joiner> <host>
//
// The scenarios (Phase 9c) first rehearse a membership change inside the same
// rolled-back block: the joiner joins the host's herd by invite, with their
// first account made private (and, for --join-leave, then leaves again). Every
// member is then checked against the result. Nothing is committed.
//
// Exits 1 on any FAIL.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The SQL goes through a file: quoting it for a Windows shell is hopeless.
const dir = mkdtempSync(join(tmpdir(), 'rls-check-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

function query(sql) {
  const file = join(dir, 'q.sql');
  writeFileSync(file, sql);
  try {
    const out = execFileSync('npx', ['-y', 'supabase@2.118.0', 'db', 'query', '--linked', '-o', 'csv', '-f', file], {
      encoding: 'utf8',
      shell: true,
      stdio: 'pipe',
    });
    return { out };
  } catch (err) {
    return { err: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const UUID = /^[0-9a-f-]{36}$/;
const USAGE = 'usage: node scripts/rls-check.mjs [user-id | --join <joiner> <host> | --join-leave <joiner> <host>]';
const [arg, joiner, host] = process.argv.slice(2);
const scenario = arg === '--join' || arg === '--join-leave' ? arg.slice(2) : null;
const only = scenario ? null : arg;
if ((only && !UUID.test(only)) || (scenario && !(UUID.test(joiner ?? '') && UUID.test(host ?? '')))) {
  console.error(USAGE);
  process.exit(2);
}

// Runs as the admin before anything is measured. The invite code is fixed: the
// block rolls back, so it never exists outside it.
const setup = !scenario
  ? ''
  : `
  insert into public.herd_invites (code, herd_id, created_by)
    select 'TESTJ01N', herd_id, user_id from public.herd_members where user_id = '${host}';
  perform public.merge_into_herd('${joiner}', 'TESTJ01N', array(
    select a.id from public.accounts a join public.herd_members m on m.herd_id = a.herd_id
    where m.user_id = '${joiner}' order by a.id limit 1));
  ${scenario === 'join-leave'
    ? `-- Cross ownership first (9d), so leaving must untangle it: the host owns
  -- one of the joiner's accounts and paid on it; the joiner owns one of the host's.
  update public.accounts set owner_id = '${host}' where id = (
    select id from public.accounts where user_id = '${joiner}' and not is_private order by id limit 1);
  update public.transactions set paid_by = '${host}', paid_by_is_manual = true where id = (
    select id from public.transactions where user_id = '${joiner}' order by id limit 1);
  update public.accounts set owner_id = '${joiner}' where id = (
    select id from public.accounts where user_id = '${host}' order by id limit 1);
  -- Splits naming both (11b), on each side's banks: none may name a non-member after.
  update public.transactions set split = jsonb_build_object('${host}', 50, '${joiner}', 50) where id in (
    (select id from public.transactions where user_id = '${host}' order by id limit 1),
    (select id from public.transactions where user_id = '${joiner}' order by id limit 1));
  perform public.leave_herd('${joiner}');`
    : ''}`;

const users = only
  ? [only]
  : query('select user_id from public.herd_members order by joined_at').out
      .split(/\r?\n/)
      .filter((l) => UUID.test(l.trim()))
      .map((l) => l.trim());

// Each check: [name, expected-as-admin SQL, actual-as-user SQL]. Both return a count.
// `v` = the visible account ids for the user, `h` = their herd, `u` = their id.
const counts = [
  ['herds', `select count(*) from public.herds where id = h`, `select count(*) from public.herds`],
  ['herd_members', `select count(*) from public.herd_members where herd_id = h`, `select count(*) from public.herd_members`],
  ['profiles', `select count(*) from public.herd_members where herd_id = h`, `select count(*) from public.profiles`],
  ['herd_invites', `select count(*) from public.herd_invites where herd_id = h`, `select count(*) from public.herd_invites`],
  // Never another member's private account, whatever the rest of the rules say.
  ['mates_private_accounts', `select 0`, `select count(*) from public.accounts where is_private and user_id <> u`],
  [
    'plaid_items',
    `select count(*) from public.plaid_items i where i.herd_id = h and (i.user_id = u or exists (select 1 from public.accounts a where a.item_id = i.id and a.id = any (v)))`,
    `select count(*) from public.plaid_items`,
  ],
  ['accounts', `select cardinality(v)`, `select count(*) from public.accounts`],
  ['transactions', `select count(*) from public.transactions where account_id = any (v)`, `select count(*) from public.transactions`],
  ['balance_snapshots', `select count(*) from public.balance_snapshots where account_id = any (v)`, `select count(*) from public.balance_snapshots`],
  ['recurring_streams', `select count(*) from public.recurring_streams where account_id = any (v)`, `select count(*) from public.recurring_streams`],
  ['budgets', `select count(*) from public.budgets where herd_id = h`, `select count(*) from public.budgets`],
  ['categories', `select count(*) from public.categories where herd_id is null or herd_id = h`, `select count(*) from public.categories`],
  ['user_categories', `select count(*) from public.categories where herd_id is null or herd_id = h`, `select count(*) from public.user_categories`],
  ['category_overrides', `select count(*) from public.category_overrides where herd_id = h`, `select count(*) from public.category_overrides`],
  ['merchant_rules', `select count(*) from public.merchant_rules where herd_id = h`, `select count(*) from public.merchant_rules`],
  [
    'monthly_category_totals',
    `select count(*) from (select 1 from public.transactions t join public.accounts a on a.id = t.account_id where t.account_id = any (v) and not a.hidden group by date_trunc('month', t.date::timestamp), t.category_id, t.iso_currency_code) x`,
    `select count(*) from public.monthly_category_totals`,
  ],
  [
    'monthly_person_totals',
    // A split row (11b) counts once per person in it.
    `select count(*) from (select 1 from public.transactions t join public.accounts a on a.id = t.account_id left join lateral jsonb_each(t.split) s on true where t.account_id = any (v) and not a.hidden group by date_trunc('month', t.date::timestamp), coalesce(s.key::uuid, t.paid_by), t.category_id, t.iso_currency_code) x`,
    `select count(*) from public.monthly_person_totals`,
  ],
  ['settlements', `select count(*) from public.settlements where herd_id = h`, `select count(*) from public.settlements`],
  [
    'shared_lines',
    `select count(*) from public.transactions t join public.accounts a on a.id = t.account_id left join public.categories c on c.id = t.category_id where t.account_id = any (v) and not t.pending and not a.is_private and not a.hidden and coalesce(c.kind, 'expense') = 'expense' and t.split is not null`,
    `select count(*) from public.shared_lines`,
  ],
  [
    'transaction_questions',
    // The herd's questions, only where the transaction itself is visible (15d).
    `select count(*) from public.transaction_questions q join public.transactions t on t.id = q.transaction_id where q.herd_id = h and t.account_id = any (v)`,
    `select count(*) from public.transaction_questions`,
  ],
  [
    'daily_net_worth',
    `select count(distinct s.date) from public.balance_snapshots s join public.accounts a on a.id = s.account_id where s.account_id = any (v) and not a.hidden and a.in_totals`,
    `select count(*) from public.daily_net_worth`,
  ],
  ['plans', `select count(*) from public.plans`, `select count(*) from public.plans`],
  [
    'subscriptions',
    // Your own row, and a herd mate's Tusk Herd.
    `select count(*) from public.subscriptions s where s.user_id = u or (s.plan = 'tusk_herd' and exists (select 1 from public.herd_members m where m.herd_id = h and m.user_id = s.user_id))`,
    `select count(*) from public.subscriptions`,
  ],
];

// SQL for a jwt claims value (Phase 16e): `sid` is a SQL uuid expression, `method` the amr entry.
const claims = (sid, method) =>
  `json_build_object('sub', u, 'role', 'authenticated', 'session_id', ${sid}, ` +
  `'amr', json_build_array(json_build_object('method', '${method}', 'timestamp', 1)))::text`;

// Everything a herd member could read; zero for a session the server has not verified.
const TF_ROWS = `(
    (select count(*) from public.herds) + (select count(*) from public.herd_members)
    + (select count(*) from public.herd_invites)
    + (select count(*) from public.plaid_items) + (select count(*) from public.accounts)
    + (select count(*) from public.transactions) + (select count(*) from public.balance_snapshots)
    + (select count(*) from public.recurring_streams) + (select count(*) from public.budgets)
    + (select count(*) from public.category_overrides) + (select count(*) from public.merchant_rules)
    + (select count(*) from public.settlements) + (select count(*) from public.transaction_questions)
    + (select count(*) from public.monthly_category_totals) + (select count(*) from public.shared_lines)
    + (select count(*) from public.daily_net_worth)
    + (select count(*) from public.categories where herd_id is not null))`;

function block(userId) {
  const expected = counts.map(([name, sql]) => `e := e || jsonb_build_object('${name}', (${sql}));`).join('\n');
  const actual = counts.map(([name, , sql]) => `a := a || jsonb_build_object('${name}', (${sql}));`).join('\n');
  return `do $rls$
declare
  u uuid := '${userId}';
  h uuid;
  v uuid[];
  e jsonb := '{}';
  a jsonb := '{}';
  w jsonb := '{}';
  n int;
  tf_s1 uuid := gen_random_uuid();
  tf_s2 uuid := gen_random_uuid();
  tf_s3 uuid := gen_random_uuid();
  tf_other uuid;
  foreign_tx uuid;
  own_tx uuid;
  other_herd uuid;
  builtin uuid;
  r text;
  mate_account uuid;
  outsider uuid;
  mate uuid;
  auto_tx uuid;
  auto_src text;
  other_cat uuid;
  my_cat uuid;
  ai_on boolean;
  foreign_cat uuid;
  budgets_before int;
  crowd_cat uuid;
  crowd_expected boolean;
  custom_cat uuid;
begin
  ${setup}
  select herd_id, role into h, r from public.herd_members where user_id = u;
  select coalesce(array_agg(id), '{}') into v from public.accounts
    where herd_id = h and (not is_private or user_id = u);
  select id into foreign_tx from public.transactions where herd_id <> h limit 1;
  select id into own_tx from public.transactions where account_id = any (v) limit 1;
  select id into other_herd from public.herds where id <> h limit 1;
  select id into builtin from public.categories where herd_id is null and parent_id is null limit 1;
  select id into mate_account from public.accounts where herd_id = h and user_id <> u and not is_private limit 1;
  -- Invariant: the banks you connected are always in your herd.
  w := w || jsonb_build_object('own_banks_elsewhere',
    (select count(*) from public.plaid_items where user_id = u and herd_id <> h));
  -- Invariant (9d): owners and payers are members of the row's herd.
  w := w || jsonb_build_object('owners_payers_outside_herd',
    (select count(*) from public.accounts a where a.herd_id = h and a.owner_id is not null
       and not exists (select 1 from public.herd_members m where m.herd_id = h and m.user_id = a.owner_id))
    + (select count(*) from public.transactions t where t.herd_id = h and t.paid_by is not null
       and not exists (select 1 from public.herd_members m where m.herd_id = h and m.user_id = t.paid_by)));
  select user_id into outsider from public.herd_members where herd_id <> h limit 1;
  select user_id into mate from public.herd_members where herd_id = h and user_id <> u limit 1;
  -- Phase 12c: give the mate a consent row, so mates_consents_visible is meaningful.
  if mate is not null then
    insert into public.consents (user_id, kind) values (mate, 'crowd_labels') on conflict do nothing;
  end if;
  -- Phase 12a: a row Tusky categorized, and a built-in category it is not in.
  select id, category_source into auto_tx, auto_src from public.transactions
    where account_id = any (v) and not category_is_manual limit 1;
  select c.id into other_cat from public.categories c
    where c.herd_id is null and c.parent_id is null
      and c.id is distinct from (select category_id from public.transactions where id = auto_tx)
      and c.slug is distinct from 'uncategorized'
    limit 1;
  -- Phase 13: a built-in category this user may budget, another herd's custom
  -- one they may not, and how many budgets other herds hold (read as the admin,
  -- because RLS hides them from the user the probes run as).
  select id into my_cat from public.categories where herd_id is null and parent_id is null and kind = 'expense' limit 1;
  select id into foreign_cat from public.categories where herd_id is not null and herd_id <> h limit 1;
  -- None on this database yet? Make one, so the probe below always runs. The
  -- block rolls back, so it never exists outside it.
  if foreign_cat is null and other_herd is not null and builtin is not null then
    insert into public.categories (herd_id, parent_id, name, kind, icon, color)
    values (other_herd, builtin, 'RLS probe', 'expense', 'tag', '#888888')
    returning id into foreign_cat;
  end if;
  select count(*) into budgets_before from public.budgets where herd_id <> h;
  -- Invariant (11b): everyone named in a split is in the row's herd.
  w := w || jsonb_build_object('splits_outside_herd',
    (select count(*) from public.transactions t cross join lateral jsonb_each(t.split) s where t.herd_id = h
       and not exists (select 1 from public.herd_members m where m.herd_id = h and m.user_id::text = s.key)));
  ${expected}

  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  ${actual}

  -- Another herd's transaction: RLS hides it, so the update touches nothing.
  if foreign_tx is not null then
    update public.transactions set category_is_manual = category_is_manual where id = foreign_tx;
    get diagnostics n = row_count;
    w := w || jsonb_build_object('update_other_herd_rows', n);
  end if;
  -- A column the app may not write, on the user's own row.
  if own_tx is not null then
    begin
      update public.transactions set amount = amount where id = own_tx;
      w := w || jsonb_build_object('update_amount', 'allowed');
    exception when insufficient_privilege then
      w := w || jsonb_build_object('update_amount', 'denied');
    end;
  end if;
  -- A budget planted in another herd.
  if other_herd is not null then
    begin
      insert into public.budgets (herd_id, category_id, amount) values (other_herd, builtin, 1);
      w := w || jsonb_build_object('insert_foreign_budget', 'allowed');
    exception when insufficient_privilege or check_violation then
      w := w || jsonb_build_object('insert_foreign_budget', 'denied');
    end;
  end if;
  -- Only the member who connected an account decides who sees it.
  if mate_account is not null then
    begin
      update public.accounts set is_private = true where id = mate_account;
      w := w || jsonb_build_object('privatize_mates_account', 'allowed');
    exception when insufficient_privilege then
      w := w || jsonb_build_object('privatize_mates_account', 'denied');
    end;
  end if;
  -- Who paid (9d): never someone outside the herd.
  if own_tx is not null and outsider is not null then
    begin
      update public.transactions set paid_by = outsider, paid_by_is_manual = true where id = own_tx;
      w := w || jsonb_build_object('payer_outside_herd', 'allowed');
    exception when check_violation then
      w := w || jsonb_build_object('payer_outside_herd', 'denied');
    end;
  end if;
  -- A mate's shared account can be made yours, and its rows follow.
  if mate_account is not null then
    update public.accounts set owner_id = u where id = mate_account;
    w := w || jsonb_build_object('owner_change_followed',
      not exists (select 1 from public.transactions where account_id = mate_account
                  and not paid_by_is_manual and paid_by is distinct from u));
  end if;
  -- Splits (11b): herd members only, adding up to 100; a valid one makes the row nobody's alone.
  if own_tx is not null and outsider is not null then
    begin
      update public.transactions set split = jsonb_build_object(u::text, 50, outsider::text, 50) where id = own_tx;
      w := w || jsonb_build_object('split_outside_herd', 'allowed');
    exception when check_violation then
      w := w || jsonb_build_object('split_outside_herd', 'denied');
    end;
  end if;
  if own_tx is not null and mate is not null then
    begin
      update public.transactions set split = jsonb_build_object(u::text, 60, mate::text, 30) where id = own_tx;
      w := w || jsonb_build_object('split_not_100', 'allowed');
    exception when check_violation then
      w := w || jsonb_build_object('split_not_100', 'denied');
    end;
    update public.transactions set split = jsonb_build_object(u::text, 60, mate::text, 40) where id = own_tx;
    w := w || jsonb_build_object('split_clears_payer',
      (select paid_by is null and paid_by_is_manual from public.transactions where id = own_tx));
  end if;
  -- Settlements (11b): between herd members, in your own herd.
  if outsider is not null then
    begin
      insert into public.settlements (from_user, to_user, amount) values (u, outsider, 1);
      w := w || jsonb_build_object('settle_with_outsider', 'allowed');
    exception when check_violation then
      w := w || jsonb_build_object('settle_with_outsider', 'denied');
    end;
  end if;
  if other_herd is not null and mate is not null then
    begin
      insert into public.settlements (herd_id, from_user, to_user, amount) values (other_herd, u, mate, 1);
      w := w || jsonb_build_object('settle_in_other_herd', 'allowed');
    exception when insufficient_privilege or check_violation then
      w := w || jsonb_build_object('settle_in_other_herd', 'denied');
    end;
  end if;
  if mate is not null then
    insert into public.settlements (from_user, to_user, amount) values (mate, u, 1);
    w := w || jsonb_build_object('settle_with_mate_visible', (select count(*) = 1 from public.settlements where from_user = mate and to_user = u and amount = 1));
  end if;
  -- Questions (15d): ask a herd mate, never yourself or an outsider; asking requeues the row.
  if own_tx is not null then
    begin
      insert into public.transaction_questions (transaction_id, asked_to) values (own_tx, u);
      w := w || jsonb_build_object('ask_self', 'allowed');
    exception when check_violation then
      w := w || jsonb_build_object('ask_self', 'denied');
    end;
    if outsider is not null then
      begin
        insert into public.transaction_questions (transaction_id, asked_to) values (own_tx, outsider);
        w := w || jsonb_build_object('ask_outsider', 'allowed');
      exception when insufficient_privilege or check_violation then
        w := w || jsonb_build_object('ask_outsider', 'denied');
      end;
    end if;
    if mate is not null then
      update public.transactions set reviewed_at = now() where id = own_tx and not pending;
      insert into public.transaction_questions (transaction_id, asked_to, body) values (own_tx, mate, 'What was this?');
      w := w || jsonb_build_object('ask_mate_requeues',
        (select reviewed_at is null or pending from public.transactions where id = own_tx));
      -- The mate asks me; my memo answers it. (Inserted as the admin: the mate is not the caller.)
      reset role;
      insert into public.transaction_questions (herd_id, transaction_id, asked_by, asked_to)
        select herd_id, id, mate, u from public.transactions where id = own_tx;
      perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      update public.transactions set notes = 'RLS answer' where id = own_tx;
      w := w || jsonb_build_object('memo_answers_question',
        not exists (select 1 from public.transaction_questions where transaction_id = own_tx and asked_to = u and resolved_at is null));
    end if;
  end if;
  -- Terms (15c): accepting records one active row per user.
  perform public.accept_terms('rls-check');
  w := w || jsonb_build_object('terms_recorded',
    (select count(*) = 1 from public.consents where user_id = u and kind = 'terms' and withdrawn_at is null and version = 'rls-check'));
  -- Phase 12a: only the trigger writes where a category came from.
  if own_tx is not null then
    begin
      update public.transactions set category_source = 'ai' where id = own_tx;
      w := w || jsonb_build_object('update_category_source', 'allowed');
    exception when insufficient_privilege then
      w := w || jsonb_build_object('update_category_source', 'denied');
    end;
  end if;
  -- A hand-picked category is stamped manual, and remembers which source it corrected.
  if auto_tx is not null and other_cat is not null then
    update public.transactions set category_id = other_cat, category_is_manual = true where id = auto_tx;
    w := w || jsonb_build_object('correction_recorded',
      (select category_source = 'manual' and corrected_from = auto_src from public.transactions where id = auto_tx));
  end if;
  -- Phase 13: replace_budgets writes only the caller's herd, atomically.
  if my_cat is not null then
    perform public.replace_budgets(jsonb_build_array(jsonb_build_object('category_id', my_cat, 'amount', 123)));
    w := w || jsonb_build_object('replace_budgets_scoped',
      (select count(*) = 1 from public.budgets where herd_id = h));
    -- Applying twice leaves one set, not two.
    perform public.replace_budgets(jsonb_build_array(jsonb_build_object('category_id', my_cat, 'amount', 321)));
    w := w || jsonb_build_object('replace_budgets_idempotent',
      (select count(*) = 1 and max(amount) = 321 from public.budgets where herd_id = h));
    -- An unknown category fails the whole call and leaves the herd's budgets alone.
    begin
      perform public.replace_budgets(jsonb_build_array(jsonb_build_object('category_id', gen_random_uuid(), 'amount', 9)));
      w := w || jsonb_build_object('replace_budgets_unknown_category', 'allowed');
    exception when others then
      w := w || jsonb_build_object('replace_budgets_unknown_category', 'denied');
    end;
    -- Another herd's custom category: the FK would allow it, the category_in_herd
    -- trigger is what refuses it. This is the case an FK check alone would miss.
    if foreign_cat is not null then
      begin
        perform public.replace_budgets(jsonb_build_array(jsonb_build_object('category_id', foreign_cat, 'amount', 9)));
        w := w || jsonb_build_object('replace_budgets_foreign_category', 'allowed');
      exception when others then
        w := w || jsonb_build_object('replace_budgets_foreign_category', 'denied');
      end;
    end if;
    w := w || jsonb_build_object('replace_budgets_intact_after_failure',
      (select count(*) = 1 and max(amount) = 321 from public.budgets where herd_id = h));
  end if;
  -- Phase 12b: the AI cache is server-only, and the switch is your own.
  begin
    perform 1 from public.ai_category_cache limit 1;
    w := w || jsonb_build_object('read_ai_cache', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('read_ai_cache', 'denied');
  end;
  update public.profiles set ai_categorize = true where user_id = u;
  select ai_categorize into ai_on from public.profiles where user_id = u;
  w := w || jsonb_build_object('own_ai_switch', ai_on);
  -- Phase 14a: plans and subscriptions are server-written; my_plan is mine.
  begin
    update public.subscriptions set plan = 'tusk_herd' where user_id = u;
    w := w || jsonb_build_object('update_own_subscription', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('update_own_subscription', 'denied');
  end;
  begin
    insert into public.subscriptions (user_id, plan, store) values (gen_random_uuid(), 'tusk', 'comp');
    w := w || jsonb_build_object('insert_subscription', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('insert_subscription', 'denied');
  end;
  begin
    update public.plans set max_banks = 99 where id = 'free';
    w := w || jsonb_build_object('update_plans', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('update_plans', 'denied');
  end;
  begin
    perform 1 from public.plan_for(u);
    w := w || jsonb_build_object('call_plan_for', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('call_plan_for', 'denied');
  end;
  w := w || jsonb_build_object('my_plan_rows', (select count(*) from public.my_plan()));
  if mate is not null then
    update public.profiles set ai_categorize = true where user_id = mate;
    get diagnostics n = row_count;
    w := w || jsonb_build_object('mates_ai_switch_rows', n);
  end if;
  -- Only the owner renames the herd.
  update public.herds set name = name where id = h;
  get diagnostics n = row_count;
  w := w || jsonb_build_object('rename_herd_matches_role', (n = 1) = (r = 'owner'));
  -- Server-only table.
  begin
    perform 1 from public.plaid_tokens limit 1;
    w := w || jsonb_build_object('read_plaid_tokens', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('read_plaid_tokens', 'denied');
  end;

  -- Phase 12c: the pool and consents are nobody's to read, and consent is your own.
  begin
    perform 1 from public.community_labels limit 1;
    w := w || jsonb_build_object('read_community_labels', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('read_community_labels', 'denied');
  end;
  begin
    perform public.community_tallies(array['k:test']);
    w := w || jsonb_build_object('call_community_tallies', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('call_community_tallies', 'denied');
  end;
  begin
    insert into public.consents (user_id, kind) values (u, 'crowd_labels');
    w := w || jsonb_build_object('insert_consent_directly', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('insert_consent_directly', 'denied');
  end;
  if mate is not null then
    w := w || jsonb_build_object('mates_consents_visible',
      (select count(*) from public.consents where user_id = mate));
  end if;
  perform public.set_consent('crowd_labels', true);
  w := w || jsonb_build_object('own_consent_granted',
    (select count(*) = 1 from public.consents where user_id = u and kind = 'crowd_labels' and withdrawn_at is null));
  if auto_tx is not null then
    select c.id into crowd_cat from public.categories c
      where c.herd_id is null and c.parent_id is null and c.slug is distinct from 'uncategorized'
        and c.id is distinct from (select category_id from public.transactions where id = auto_tx)
      order by c.id desc limit 1;
    update public.transactions set category_id = crowd_cat, category_is_manual = true where id = auto_tx;
    reset role;
    -- Contributes unless the row's account is private or its merchant is blank.
    select not a.is_private and coalesce(nullif(t.merchant_entity_id, ''), nullif(t.merchant_key, '')) is not null
      into crowd_expected
      from public.transactions t join public.accounts a on a.id = t.account_id where t.id = auto_tx;
    w := w || jsonb_build_object('crowd_contributed_as_expected',
      (select count(*) > 0 from public.community_labels
         where contributor = private.label_contributor(u) and category_id = crowd_cat) = crowd_expected);
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    -- A custom category contributes its group, never its own id.
    insert into public.categories (name, parent_id, icon, color)
      values ('RLS crowd probe', crowd_cat, 'tag', '#888888') returning id into custom_cat;
    update public.transactions set category_id = custom_cat where id = auto_tx;
    reset role;
    w := w || jsonb_build_object('crowd_custom_is_group',
      not exists (select 1 from public.community_labels where category_id = custom_cat));
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
  -- Withdrawing forgets everything this user contributed; granting again works.
  perform public.set_consent('crowd_labels', false);
  perform public.set_consent('crowd_labels', true);
  w := w || jsonb_build_object('crowd_regrant',
    (select count(*) = 2 from public.consents where user_id = u and kind = 'crowd_labels'));
  perform public.set_consent('crowd_labels', false);
  reset role;
  w := w || jsonb_build_object('crowd_withdraw_forgets',
    not exists (select 1 from public.community_labels where contributor = private.label_contributor(u)));
  -- A missing pepper must never block a fix. Only when this login may touch the
  -- vault; otherwise the probe is left out (and so not checked).
  if auto_tx is not null then
    begin
      delete from vault.secrets where name = 'label_pepper';
      perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.set_consent('crowd_labels', true);
      begin
        update public.transactions set category_id = other_cat where id = auto_tx;
        w := w || jsonb_build_object('fix_without_pepper', 'allowed');
      exception when others then
        w := w || jsonb_build_object('fix_without_pepper', 'denied');
      end;
      reset role;
    exception when insufficient_privilege then
      reset role;
    end;
  end if;

  -- Phase 16e: with two-step sign-in on, a session has no herd until the server
  -- verified it (a two_factor_sessions row for ITS session_id). The jwt's amr is
  -- never consulted: an otp-only session (a mailbox, no password) sees nothing.
  -- Three real auth.sessions rows exist only inside this rolled-back block.
  reset role;
  select user_id into tf_other from public.herd_members where user_id <> u limit 1;
  if tf_other is null then select id into tf_other from auth.users where id <> u limit 1; end if;
  insert into auth.sessions (id, user_id) values (tf_s1, u), (tf_s2, u);
  insert into auth.sessions (id, user_id) values (tf_s3, tf_other);
  update public.profiles set two_factor = true where user_id = u;
  perform set_config('request.jwt.claims', ${claims('tf_s1', 'password')}, true);
  execute 'set local role authenticated';
  w := w || jsonb_build_object('tf_password_rows', ${TF_ROWS});
  update public.transactions set category_is_manual = category_is_manual;
  get diagnostics n = row_count;
  w := w || jsonb_build_object('tf_password_updates', n);
  if my_cat is not null then
    begin
      insert into public.budgets (herd_id, category_id, amount) values (h, my_cat, 5);
      w := w || jsonb_build_object('tf_password_write', 'allowed');
    exception when insufficient_privilege or check_violation or not_null_violation then
      w := w || jsonb_build_object('tf_password_write', 'denied');
    end;
  end if;
  -- The own row stays readable, so the gate can tell why; the flag itself is not writable.
  w := w || jsonb_build_object('tf_own_profile_readable',
    (select count(*) = 1 and bool_and(two_factor) from public.profiles where user_id = u));
  begin
    update public.profiles set two_factor = false where user_id = u;
    w := w || jsonb_build_object('tf_direct_update', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('tf_direct_update', 'denied');
  end;
  begin
    perform public.set_two_factor(false);
    w := w || jsonb_build_object('tf_rpc_without_code', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('tf_rpc_without_code', 'denied');
  end;
  w := w || jsonb_build_object('tf_gate_says_unverified', not public.my_second_step_done());
  -- An otp-only claim set (the mailbox-only sign-in) on an unmarked session: nothing.
  perform set_config('request.jwt.claims', ${claims('tf_s2', 'otp')}, true);
  w := w || jsonb_build_object('tf_otp_only_rows', ${TF_ROWS});
  begin
    perform public.set_two_factor(false);
    w := w || jsonb_build_object('tf_otp_only_rpc', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('tf_otp_only_rpc', 'denied');
  end;
  -- No session_id at all: nothing.
  perform set_config('request.jwt.claims', ${claims('null::uuid', 'password')}, true);
  w := w || jsonb_build_object('tf_no_session_rows', ${TF_ROWS});
  -- The two tables are server-only.
  begin
    perform count(*) from public.two_factor_sessions;
    w := w || jsonb_build_object('tf_sessions_table', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('tf_sessions_table', 'denied');
  end;
  begin
    insert into public.two_factor_sessions (session_id, user_id) values (tf_s1, u);
    w := w || jsonb_build_object('tf_self_mark', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('tf_self_mark', 'denied');
  end;
  -- A session marked for ANOTHER user does not count, even carrying this user's sub.
  reset role;
  insert into public.two_factor_sessions (session_id, user_id) values (tf_s3, tf_other);
  perform set_config('request.jwt.claims', ${claims('tf_s3', 'password')}, true);
  execute 'set local role authenticated';
  w := w || jsonb_build_object('tf_other_users_session_rows', ${TF_ROWS});
  -- Marked for this user, the session sees exactly what it saw before, whatever its amr says.
  reset role;
  insert into public.two_factor_sessions (session_id, user_id) values (tf_s1, u);
  perform set_config('request.jwt.claims', ${claims('tf_s1', 'password')}, true);
  execute 'set local role authenticated';
  w := w || jsonb_build_object('tf_marked_sees_herd',
    (select count(*) from public.transactions) = (a ->> 'transactions')::int
    and (select count(*) from public.accounts) = (a ->> 'accounts')::int
    and (select count(*) from public.herd_members) = (a ->> 'herd_members')::int
    and private.my_herd_id() is not distinct from h);
  w := w || jsonb_build_object('tf_gate_says_verified', public.my_second_step_done());
  perform public.set_two_factor(true);
  w := w || jsonb_build_object('tf_rpc_with_code', (select two_factor from public.profiles where user_id = u));
  perform public.set_two_factor(false);
  w := w || jsonb_build_object('tf_rpc_turns_off', not (select two_factor from public.profiles where user_id = u));
  -- Off again: any session is whole once more.
  perform set_config('request.jwt.claims', ${claims('tf_s2', 'password')}, true);
  w := w || jsonb_build_object('tf_off_password_sees_herd',
    (select count(*) from public.transactions) = (a ->> 'transactions')::int);
  reset role;

  -- Phase 13: as the admin again, prove the delete never reached another herd.
  -- Asked as the caller this would be vacuous: RLS hides those rows anyway.
  reset role;
  w := w || jsonb_build_object('replace_budgets_other_herds_untouched',
    (select count(*) from public.budgets where herd_id <> h) = budgets_before);

  raise exception 'RLS_RESULT %', jsonb_build_object('expected', e, 'actual', a, 'writes', w);
end
$rls$`;
}

const WRITE_EXPECT = {
  update_other_herd_rows: 0,
  update_amount: 'denied',
  insert_foreign_budget: 'denied',
  read_plaid_tokens: 'denied',
  own_banks_elsewhere: 0,
  privatize_mates_account: 'denied',
  rename_herd_matches_role: true,
  owners_payers_outside_herd: 0,
  payer_outside_herd: 'denied',
  owner_change_followed: true,
  splits_outside_herd: 0,
  split_outside_herd: 'denied',
  split_not_100: 'denied',
  split_clears_payer: true,
  settle_with_outsider: 'denied',
  settle_in_other_herd: 'denied',
  settle_with_mate_visible: true,
  ask_self: 'denied',
  ask_outsider: 'denied',
  ask_mate_requeues: true,
  memo_answers_question: true,
  terms_recorded: true,
  update_category_source: 'denied',
  correction_recorded: true,
  replace_budgets_scoped: true,
  replace_budgets_idempotent: true,
  replace_budgets_unknown_category: 'denied',
  replace_budgets_foreign_category: 'denied',
  replace_budgets_intact_after_failure: true,
  replace_budgets_other_herds_untouched: true,
  read_ai_cache: 'denied',
  own_ai_switch: true,
  mates_ai_switch_rows: 0,
  read_community_labels: 'denied',
  call_community_tallies: 'denied',
  insert_consent_directly: 'denied',
  mates_consents_visible: 0,
  own_consent_granted: true,
  crowd_contributed_as_expected: true,
  crowd_custom_is_group: true,
  crowd_regrant: true,
  crowd_withdraw_forgets: true,
  fix_without_pepper: 'allowed',
  update_own_subscription: 'denied',
  insert_subscription: 'denied',
  update_plans: 'denied',
  call_plan_for: 'denied',
  my_plan_rows: 1,
  tf_password_rows: 0,
  tf_password_updates: 0,
  tf_password_write: 'denied',
  tf_own_profile_readable: true,
  tf_direct_update: 'denied',
  tf_rpc_without_code: 'denied',
  tf_gate_says_unverified: true,
  tf_otp_only_rows: 0,
  tf_otp_only_rpc: 'denied',
  tf_no_session_rows: 0,
  tf_sessions_table: 'denied',
  tf_self_mark: 'denied',
  tf_other_users_session_rows: 0,
  tf_marked_sees_herd: true,
  tf_gate_says_verified: true,
  tf_rpc_with_code: true,
  tf_rpc_turns_off: true,
  tf_off_password_sees_herd: true,
};

let failures = 0;
for (const userId of users) {
  const { out, err } = query(block(userId));
  const text = `${out ?? ''}${err ?? ''}`;
  const match = text.match(/RLS_RESULT (\{.*?\})(?:\\n|"|$)/s);
  if (!match) {
    console.log(`FAIL ${userId}: no result\n${text.slice(0, 800)}`);
    failures++;
    continue;
  }
  const { expected, actual, writes } = JSON.parse(match[1].replace(/\\"/g, '"'));
  console.log(`\nuser ${userId}${scenario ? ` (after --${scenario})` : ''}`);
  for (const name of Object.keys(expected)) {
    const ok = expected[name] === actual[name];
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name.padEnd(24)} sees ${actual[name]}, should ${expected[name]}`);
  }
  for (const [name, want] of Object.entries(WRITE_EXPECT)) {
    if (!(name in writes)) continue;
    const ok = writes[name] === want;
    if (!ok) failures++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name.padEnd(24)} ${writes[name]} (want ${want})`);
  }
}

console.log(failures ? `\n${failures} FAILED` : '\nall PASS');
process.exit(failures ? 1 : 0);
