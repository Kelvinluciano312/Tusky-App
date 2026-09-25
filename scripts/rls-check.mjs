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
const only = process.argv[2];
if (only && !UUID.test(only)) {
  console.error('usage: node scripts/rls-check.mjs [user-id]');
  process.exit(2);
}

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
  ['profiles', `select count(*) from public.profiles where user_id = u`, `select count(*) from public.profiles`],
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
    'daily_net_worth',
    `select count(distinct s.date) from public.balance_snapshots s join public.accounts a on a.id = s.account_id where s.account_id = any (v) and not a.hidden`,
    `select count(*) from public.daily_net_worth`,
  ],
];

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
  foreign_tx uuid;
  own_tx uuid;
  other_herd uuid;
  builtin uuid;
begin
  select herd_id into h from public.herd_members where user_id = u;
  select coalesce(array_agg(id), '{}') into v from public.accounts
    where herd_id = h and (not is_private or user_id = u);
  select id into foreign_tx from public.transactions where herd_id <> h limit 1;
  select id into own_tx from public.transactions where account_id = any (v) limit 1;
  select id into other_herd from public.herds where id <> h limit 1;
  select id into builtin from public.categories where herd_id is null and parent_id is null limit 1;
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
  -- Server-only table.
  begin
    perform 1 from public.plaid_tokens limit 1;
    w := w || jsonb_build_object('read_plaid_tokens', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('read_plaid_tokens', 'denied');
  end;

  raise exception 'RLS_RESULT %', jsonb_build_object('expected', e, 'actual', a, 'writes', w);
end
$rls$`;
}

const WRITE_EXPECT = {
  update_other_herd_rows: 0,
  update_amount: 'denied',
  insert_foreign_budget: 'denied',
  read_plaid_tokens: 'denied',
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
  console.log(`\nuser ${userId}`);
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
