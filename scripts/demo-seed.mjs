#!/usr/bin/env node
// Seed (or re-seed) the App Review demo account: one fake bank, three accounts,
// about 100 days of transactions, a few left in the review queue, recurring
// streams, budgets, balance history. Nothing here ever calls Plaid, and the
// bank's plaid_items row is flagged is_demo with NO plaid_tokens row.
//
//   node scripts/demo-seed.mjs <user-id>           # dev only: seeds the linked project
//   node scripts/demo-seed.mjs <user-id> --print   # prints the SQL, touches nothing (for production)
//
// The user must already exist (create the account in the dashboard first, with
// email confirmed). Re-running wipes and rebuilds the demo bank, so it is also
// how the account is reset after a review. The SQL is one DO block, so it either
// all happens or none of it does, and it refuses to touch a user who has a real
// bank or shares a herd. See docs/ops/app-review.md.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEV_REF = 'ifibrsgqdibcomzxencf';

const args = process.argv.slice(2);
const print = args.includes('--print');
const user = args.find((a) => !a.startsWith('--'));
if (!user || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(user)) {
  console.error('usage: node scripts/demo-seed.mjs <user-id> [--print]');
  process.exit(2);
}

// Always the version the app asks people to accept, so the demo account is never sent to accept-terms.
const legal = readFileSync(new URL('../apps/mobile/src/constants/legal.ts', import.meta.url), 'utf8');
const terms = /TERMS_VERSION\s*=\s*'([0-9A-Za-z._-]{1,32})'/.exec(legal)?.[1];
if (!terms) {
  console.error('could not read TERMS_VERSION from apps/mobile/src/constants/legal.ts');
  process.exit(2);
}

const sql = `-- Tusky App Review demo data for ${user} (terms ${terms}). Safe to re-run.
do $seed$
declare
  v_user constant uuid := '${user}';
  v_terms constant text := '${terms}';
  v_herd uuid;
  v_item uuid;
  v_checking uuid;
  v_savings uuid;
  v_card uuid;
  v_uncategorized integer;
  v_budgets integer;
begin
  select herd_id into v_herd from public.herd_members where user_id = v_user;
  if v_herd is null then
    raise exception 'demo-seed: user % does not exist yet; create the account first', v_user;
  end if;
  if (select count(*) from public.herd_members where herd_id = v_herd) <> 1 then
    raise exception 'demo-seed: the herd has other members; the demo account must be alone';
  end if;
  if exists (select 1 from public.plaid_items where user_id = v_user and not is_demo) then
    raise exception 'demo-seed: this user has a real bank linked (a reviewer may have added one). Disconnect it in the app first, so Plaid stops billing for it';
  end if;

  -- Clean slate. The cascade takes the demo bank's accounts, transactions, snapshots and streams.
  delete from public.plaid_items where user_id = v_user and is_demo;
  delete from public.budgets where herd_id = v_herd;

  insert into public.plaid_items (user_id, plaid_item_id, institution_id, institution_name, status, is_demo)
  values (v_user, 'demo-' || v_user, 'ins_demo', 'Tusky Demo Bank', 'active', true)
  returning id into v_item;

  -- Balances are set below, from the transactions, so the history never dips below zero.
  insert into public.accounts (user_id, item_id, plaid_account_id, name, official_name, mask, type, subtype, current_balance, available_balance)
  values (v_user, v_item, 'demo-' || v_user || '-checking', 'Everyday Checking', 'Tusky Demo Everyday Checking', '0001', 'depository', 'checking', 0, 0)
  returning id into v_checking;
  insert into public.accounts (user_id, item_id, plaid_account_id, name, official_name, mask, type, subtype, current_balance, available_balance)
  values (v_user, v_item, 'demo-' || v_user || '-savings', 'Rainy Day Savings', 'Tusky Demo Rainy Day Savings', '0002', 'depository', 'savings', 0, 0)
  returning id into v_savings;
  insert into public.accounts (user_id, item_id, plaid_account_id, name, official_name, mask, type, subtype, current_balance, available_balance)
  values (v_user, v_item, 'demo-' || v_user || '-card', 'Demo Rewards Card', 'Tusky Demo Rewards Card', '0003', 'credit', 'credit card', 0, 5000)
  returning id into v_card;

  -- Transactions use Tusky's ledger sign: positive is money in, negative is money out.
  with days as (
    select (current_date - g.n) as d from generate_series(0, 99) g(n)
  ),
  monthly(acct, dom, name, merchant, slug, pfc_primary, pfc_detailed, amount) as (values
    ('checking',  1, 'MAPLE STREET APARTMENTS RENT', 'Maple Street Apartments', 'rent',                  'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_RENT',                       -1150.00),
    ('checking',  8, 'CITY POWER AND LIGHT',         'City Power & Light',       'gas_and_electric',      'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',        -92.40),
    ('checking', 12, 'FIBERLINE INTERNET',           'Fiberline Internet',       'internet_and_cable',    'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_INTERNET_AND_CABLE',         -65.00),
    ('checking', 15, 'NORTHWIND MOBILE',             'Northwind Mobile',         'phone',                 'RENT_AND_UTILITIES', 'RENT_AND_UTILITIES_TELEPHONE',                  -45.00),
    ('card',      3, 'IRON WORKS FITNESS',           'Iron Works Fitness',       'fitness',               'PERSONAL_CARE',      'PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS',        -39.00),
    ('card',      5, 'NETFLIX.COM',                  'Netflix',                  'streaming_and_music',   'ENTERTAINMENT',      'ENTERTAINMENT_TV_AND_MOVIES',                   -15.49),
    ('card',      9, 'SPOTIFY USA',                  'Spotify',                  'streaming_and_music',   'ENTERTAINMENT',      'ENTERTAINMENT_MUSIC_AND_AUDIO',                 -11.99),
    ('checking', 20, 'PAYMENT TO DEMO REWARDS CARD', 'Demo Rewards Card',        'credit_card_payment',   'LOAN_PAYMENTS',      'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',           -1400.00),
    ('card',     20, 'PAYMENT THANK YOU',            'Demo Rewards Card',        'credit_card_payment',   'LOAN_PAYMENTS',      'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',            1400.00),
    ('checking',  2, 'TRANSFER TO SAVINGS',          'Rainy Day Savings',        'savings_and_investments','TRANSFER_OUT',      'TRANSFER_OUT_SAVINGS',                        -300.00),
    ('savings',   2, 'TRANSFER FROM CHECKING',       'Everyday Checking',        'savings_and_investments','TRANSFER_IN',       'TRANSFER_IN_SAVINGS',                          300.00),
    ('savings',  28, 'INTEREST PAID',                'Demo Bank Interest',       'interest_and_dividends','INCOME',             'INCOME_INTEREST_EARNED',                         3.12)
  ),
  monthly_rows as (
    select m.acct, ((date_trunc('month', current_date::timestamp) - k.k * interval '1 month') + (m.dom - 1) * interval '1 day')::date as d,
           m.name, m.merchant, m.slug, m.pfc_primary, m.pfc_detailed, m.amount, false as pending
    from monthly m cross join generate_series(0, 4) k(k)
  ),
  -- Netflix raised its price recently, so the recurring screen has a price change to show.
  monthly_priced as (
    select acct, d, name, merchant, slug, pfc_primary, pfc_detailed,
           case
             when merchant = 'Netflix' then (case when d = max(d) over (partition by merchant) then -15.49 else -13.99 end)
             when slug = 'gas_and_electric' then amount - (extract(month from d)::int % 4) * 4.15
             else amount
           end as amount,
           pending
    from monthly_rows
    where d between current_date - 99 and current_date
  ),
  payroll_rows as (
    select 'checking' as acct, (current_date - 3 - 14 * k.k) as d, 'BRIGHTWAVE INC PAYROLL' as name, 'Brightwave Inc' as merchant,
           'paychecks' as slug, 'INCOME' as pfc_primary, 'INCOME_WAGES' as pfc_detailed, 1650.00 as amount, false as pending
    from generate_series(0, 8) k(k)
    where current_date - 3 - 14 * k.k >= current_date - 99
  ),
  rules(acct, slug, merchants, pfc_primary, pfc_detailed, min_amt, spread, dows, pct) as (values
    ('card',     'coffee_shops',          array['Blue Bottle Coffee', 'Starbucks', 'Philz Coffee'],         'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE',           4.25,  4.0, array[1, 2, 3, 4, 5], 55),
    ('card',     'groceries',             array['Whole Foods Market', 'Trader Joe''s', 'Safeway'],          'FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES',        38.0, 72.0, array[3, 6],          85),
    ('card',     'restaurants_and_bars',  array['La Taqueria', 'Nopa', 'Sushi Ran', 'Pizzeria Delfina'],    'FOOD_AND_DRINK', 'FOOD_AND_DRINK_RESTAURANT',       22.0, 48.0, array[5, 6],          55),
    ('card',     'fast_food',             array['Chipotle', 'Shake Shack', 'In-N-Out'],                     'FOOD_AND_DRINK', 'FOOD_AND_DRINK_FAST_FOOD',         9.0,  9.0, null::int[],          12),
    ('card',     'food_delivery',         array['DoorDash', 'Uber Eats'],                                   'FOOD_AND_DRINK', 'FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK', 24.0, 26.0, array[0, 1, 2],    20),
    ('checking', 'fuel',                  array['Shell', 'Chevron'],                                        'TRANSPORTATION', 'TRANSPORTATION_GAS',              36.0, 22.0, null::int[],          11),
    ('card',     'rideshare_and_taxi',    array['Uber', 'Lyft'],                                            'TRANSPORTATION', 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', 11.0, 24.0, null::int[],   9),
    ('card',     'online_marketplaces',   array['Amazon'],                                                  'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_ONLINE_MARKETPLACES', 12.0, 85.0, null::int[], 9),
    ('card',     'department_and_superstores', array['Target', 'Costco'],                                   'GENERAL_MERCHANDISE', 'GENERAL_MERCHANDISE_SUPERSTORES', 30.0, 110.0, array[0, 6], 20)
  ),
  daily as (
    select r.acct, r.slug, r.pfc_primary, r.pfc_detailed, r.merchants, r.min_amt, r.spread, r.dows, r.pct,
           days.d, abs(hashtext(r.slug || days.d::text)::bigint) as h
    from rules r cross join days
    where days.d <= current_date - 2
  ),
  daily_rows as (
    select acct, d,
           upper(merchants[1 + ((h / 100) % array_length(merchants, 1))::int]) as name,
           merchants[1 + ((h / 100) % array_length(merchants, 1))::int] as merchant,
           slug, pfc_primary, pfc_detailed,
           -round((min_amt + ((h / 7) % 1000) / 1000.0 * spread)::numeric, 2) as amount,
           false as pending
    from daily
    where (dows is null or extract(dow from d)::int = any (dows)) and h % 100 < pct
  ),
  pending_rows as (
    select * from (values
      ('card', current_date,     'BLUE BOTTLE COFFEE', 'Blue Bottle Coffee', 'coffee_shops', 'FOOD_AND_DRINK', 'FOOD_AND_DRINK_COFFEE',    -5.75, true),
      ('card', current_date - 1, 'WHOLE FOODS MARKET', 'Whole Foods Market', 'groceries',    'FOOD_AND_DRINK', 'FOOD_AND_DRINK_GROCERIES', -61.18, true)
    ) p(acct, d, name, merchant, slug, pfc_primary, pfc_detailed, amount, pending)
  ),
  gen as (
    select * from monthly_priced
    union all select * from payroll_rows
    union all select * from daily_rows
    union all select * from pending_rows
  ),
  lined as (
    select g.*, c.id as category_id, c.kind,
           case when not g.pending and c.kind = 'expense' then
             row_number() over (partition by (not g.pending and c.kind = 'expense') order by g.d desc, g.merchant, g.amount)
           end as recency,
           row_number() over (order by g.d, g.merchant, g.amount, g.acct) as seq
    from gen g left join public.categories c on c.slug = g.slug and c.herd_id is null
  )
  insert into public.transactions (user_id, account_id, item_id, plaid_transaction_id, name, merchant_name, amount, date, pending,
                                   payment_channel, pfc_primary, pfc_detailed, pfc_confidence, category_id, reviewed_at)
  select v_user,
         case l.acct when 'checking' then v_checking when 'savings' then v_savings else v_card end,
         v_item,
         'demo-' || v_user || '-' || l.seq,
         l.name, l.merchant, l.amount, l.d, l.pending,
         'other', l.pfc_primary, l.pfc_detailed, 'VERY_HIGH', l.category_id,
         -- The newest eight posted expenses wait in the review deck; the rest were reviewed the next day.
         case when l.pending or l.recency <= 8 then null else least(now(), l.d::timestamptz + interval '20 hours') end
  from lined l;

  select count(*) into v_uncategorized from public.transactions where item_id = v_item and category_id is null;
  if v_uncategorized > 0 then
    raise exception 'demo-seed: % transactions have no category; a category slug is wrong', v_uncategorized;
  end if;

  -- Balances that make the history stay above a comfortable floor. Pending rows are not in a balance.
  with s as (
    select a.id, a.type, a.subtype, g.n,
           coalesce((select sum(t.amount) from public.transactions t
                     where t.account_id = a.id and not t.pending and t.date > current_date - g.n), 0) as after_sum
    from public.accounts a cross join generate_series(0, 99) g(n)
    where a.item_id = v_item
  ),
  b as (
    select id, type,
           case
             when type = 'credit' then 150 - min(after_sum)
             when subtype = 'savings' then 8000 + max(after_sum)
             else 1800 + max(after_sum)
           end as bal
    from s group by id, type, subtype
  )
  update public.accounts a
  set current_balance = round(b.bal, 2),
      available_balance = case when b.type = 'credit' then round(5000 - b.bal, 2) else round(b.bal, 2) end
  from b where a.id = b.id;

  insert into public.balance_snapshots (account_id, user_id, date, balance)
  select a.id, v_user, current_date - g.n,
         round(a.current_balance - (case a.type when 'credit' then -1 else 1 end) *
               coalesce((select sum(t.amount) from public.transactions t
                         where t.account_id = a.id and not t.pending and t.date > current_date - g.n), 0), 2)
  from public.accounts a cross join generate_series(0, 99) g(n)
  where a.item_id = v_item;

  insert into public.recurring_streams (user_id, account_id, merchant_key, direction, name, category_id, frequency,
                                        average_amount, last_amount, previous_amount, amount_change,
                                        first_date, last_date, next_date, occurrences)
  select v_user, x.account_id, x.merchant_key, x.direction, x.merchant_name, x.category_id, x.frequency,
         x.avg_amount, x.last_amount, x.prev_amount, nullif(round(abs(x.last_amount) - abs(x.prev_amount), 2), 0),
         x.first_date, x.last_date,
         case x.frequency when 'monthly' then (x.last_date + interval '1 month')::date else x.last_date + 14 end,
         x.n
  from (
    select t.account_id, t.merchant_key, t.merchant_name, s.frequency,
           case when avg(t.amount) > 0 then 'inflow' else 'outflow' end as direction,
           (array_agg(t.category_id order by t.date desc))[1] as category_id,
           round(avg(t.amount), 2) as avg_amount,
           (array_agg(t.amount order by t.date desc))[1] as last_amount,
           (array_agg(t.amount order by t.date desc))[2] as prev_amount,
           min(t.date) as first_date, max(t.date) as last_date, count(*)::int as n
    from public.transactions t
    join (values ('Maple Street Apartments', 'monthly'), ('Brightwave Inc', 'biweekly'), ('Netflix', 'monthly'), ('Spotify', 'monthly'))
      s(merchant, frequency) on s.merchant = t.merchant_name
    where t.item_id = v_item and not t.pending
    group by t.account_id, t.merchant_key, t.merchant_name, s.frequency
  ) x;

  -- A group and its children are never budgeted at once: three children, one whole group.
  insert into public.budgets (herd_id, category_id, amount)
  select v_herd, c.id, b.amount
  from (values ('groceries', 550), ('coffee_shops', 60), ('restaurants_and_bars', 250), ('shopping', 300)) b(slug, amount)
  join public.categories c on c.slug = b.slug and c.herd_id is null;
  get diagnostics v_budgets = row_count;
  if v_budgets <> 4 then
    raise exception 'demo-seed: expected 4 budgets, made %', v_budgets;
  end if;

  update public.profiles
  set display_name = 'Alex Demo', onboarded_at = coalesce(onboarded_at, now()), two_factor = false, ai_categorize = false
  where user_id = v_user;
  if not found then
    raise exception 'demo-seed: user % has no profile', v_user;
  end if;

  -- A long trial, not a comped plan: a store purchase never overwrites a comp row
  -- (revenuecat.ts), and App Review must be able to buy a plan and see it take effect.
  -- 90 days outlasts any review; re-seeding renews it. The plan enforcer skips demo banks.
  insert into public.subscriptions (user_id, plan, store, status, expires_at, over_limit_since)
  values (v_user, 'trial', 'trial', 'active', now() + interval '90 days', null)
  on conflict (user_id) do update
    set plan = 'trial', store = 'trial', status = 'active', expires_at = now() + interval '90 days', over_limit_since = null;

  perform private.record_terms(v_user, v_terms);
  -- Nothing a reviewer taps on fake merchants should reach the shared crowd pool.
  update public.consents set withdrawn_at = now()
  where user_id = v_user and kind = 'crowd_labels' and withdrawn_at is null;
end
$seed$;
`;

if (print) {
  process.stdout.write(sql);
  process.exit(0);
}

const linked = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim();
if (linked !== DEV_REF) {
  console.error(`refusing: the CLI is linked to ${linked}, not the dev project ${DEV_REF}.`);
  console.error('For production, run with --print and paste the SQL into its SQL editor (Pedro).');
  process.exit(2);
}

const summary = `
select
  (select count(*) from public.accounts a join public.plaid_items i on i.id = a.item_id where i.user_id = '${user}' and i.is_demo) as accounts,
  (select count(*) from public.transactions t join public.plaid_items i on i.id = t.item_id where i.user_id = '${user}' and i.is_demo) as transactions,
  (select count(*) from public.transactions t join public.plaid_items i on i.id = t.item_id where i.user_id = '${user}' and i.is_demo and not t.pending and t.reviewed_at is null) as in_review_queue,
  (select count(*) from public.transactions t join public.plaid_items i on i.id = t.item_id where i.user_id = '${user}' and i.is_demo and t.pending) as pending,
  (select count(*) from public.recurring_streams where user_id = '${user}') as streams,
  (select count(*) from public.budgets b join public.herd_members m on m.herd_id = b.herd_id where m.user_id = '${user}') as budgets,
  (select count(*) from public.plaid_tokens p join public.plaid_items i on i.id = p.item_id where i.user_id = '${user}' and i.is_demo) as demo_tokens,
  (select string_agg(a.name || ' ' || a.current_balance, ' | ' order by a.name) from public.accounts a join public.plaid_items i on i.id = a.item_id where i.user_id = '${user}' and i.is_demo) as balances;`;

// The SQL goes through files: quoting it for a Windows shell is hopeless.
const dir = mkdtempSync(join(tmpdir(), 'demo-seed-'));
const run = (text, format) => {
  const file = join(dir, `q${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, text);
  return execFileSync('npx', ['-y', 'supabase@2.118.0', 'db', 'query', '--linked', '-o', format, '-f', file], {
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
};
try {
  run(sql, 'json');
  const out = JSON.parse(run(summary, 'json'));
  const row = (out.rows ?? out)[0];
  console.log(`Seeded the demo bank for ${user}:`);
  for (const [key, value] of Object.entries(row)) console.log(`  ${key}: ${value}`);
  if (Number(row.demo_tokens) !== 0) {
    console.error('BUG: a demo bank has a plaid_tokens row. It must never have one.');
    process.exit(1);
  }
} catch (err) {
  const text = String(err?.stderr ?? err?.message ?? err);
  console.error(text.match(/ERROR:\s+\S+:\s+([^\\\n"]+)/)?.[1] ?? text);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
