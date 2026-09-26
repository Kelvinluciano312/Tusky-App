#!/usr/bin/env node
// Dev only: put the test user's most recent posted transactions back in the
// review queue, so the reel, Home's to-review card and the feed's missing
// checks always have something to show.
//
//   node scripts/seed-review.mjs            # 25 for the test user
//   node scripts/seed-review.mjs 40         # a different count
//   node scripts/seed-review.mjs 25 <user>  # another user's herd
//
// Runs on the LINKED project and refuses anything but dev: production data is
// real people's review state.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEV_REF = 'ifibrsgqdibcomzxencf';
const TEST_USER = 'ccbd42ef-cba6-4f05-a100-a83a727255b2';

const linked = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim();
if (linked !== DEV_REF) {
  console.error(`refusing: the CLI is linked to ${linked}, not the dev project ${DEV_REF}`);
  process.exit(2);
}

const count = Number(process.argv[2] ?? 25);
const user = process.argv[3] ?? TEST_USER;
if (!Number.isInteger(count) || count < 1 || count > 500 || !/^[0-9a-f-]{36}$/.test(user)) {
  console.error('usage: node scripts/seed-review.mjs [count 1-500] [user-id]');
  process.exit(2);
}

// Posted rows on shown accounts of live banks: exactly what the review queue lists.
const sql = `
with h as (select herd_id from public.herd_members where user_id = '${user}'),
pick as (
  select t.id from public.transactions t
  join public.accounts a on a.id = t.account_id
  join public.plaid_items i on i.id = a.item_id, h
  where t.herd_id = h.herd_id and not t.pending and not a.hidden and i.status <> 'archived'
  order by t.date desc, t.id desc
  limit ${count}
)
update public.transactions set reviewed_at = null where id in (select id from pick) returning id;`;

// The SQL goes through a file: quoting it for a Windows shell is hopeless.
const dir = mkdtempSync(join(tmpdir(), 'seed-review-'));
try {
  const file = join(dir, 'q.sql');
  writeFileSync(file, sql);
  const out = execFileSync('npx', ['-y', 'supabase@2.118.0', 'db', 'query', '--linked', '-o', 'csv', '-f', file], {
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const n = out.split(/\r?\n/).filter((l) => /^[0-9a-f-]{36}$/.test(l.trim())).length;
  console.log(`${n} transactions back in the review queue. Pull to refresh in the app.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
