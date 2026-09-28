# Phase 14b — Plan Lifecycle and Reconnect Merge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce what happens when a plan ends or shrinks (a daily job archives banks past the limit, with a 7-day window to choose), warn users in the app beforehand, and merge a reconnected bank's history with the kept one instead of showing it twice.

**Architecture:**
- **The daily job.** pg_cron calls a new `plan-enforcer` Edge Function once a day. The function authenticates the call with a shared secret, and a pure `decide()` in `_shared/enforce.ts` chooses the action. Archiving goes through Phase 6's `disconnectItem(…, 'archive')`.
- **The reconnect merge.** A pure `planMerge()` in `_shared/merge.ts` matches an archived account's rows to the new account's rows. `syncItem` runs it on every sync; it stops early unless the Item has archived twin accounts at the same institution, connected by the same user.
- **The app** reads `my_plan()` plus the user's own `over_limit_since`, and a pure `planBanner()` decides what banner to show.

**Tech Stack:** Postgres (pg_cron, pg_net, Vault), Deno Edge Functions, Expo app.

**Spec:** `docs/superpowers/specs/2026-09-28-phase-14-monetization-design.md` (sections "When a plan ends or shrinks" and "Reconnecting merges the history"; milestone 14b). 14a (plans, `plan_for`, `pastLimit`) is merged.

## Global Constraints

- Dropping to Free: every live bank the user connected is archived on the job's next run, through the keep-history path (`disconnectItem(admin, plaid, item, 'archive')`).
- Dropping to a smaller plan: `subscriptions.over_limit_since` starts the **7-day** window. After 7 days, the banks past the limit in link order (`pastLimit`, from 14a) are archived. Back under the limit, `over_limit_since` returns to null.
- Warnings appear **3 days** before a trial ends, and for the whole 7-day window. They show on Home and in Settings, above Connections.
- A Plaid failure other than `ITEM_NOT_FOUND` leaves the bank connected and retries the next day (`disconnectItem` already returns `plaid_failed`). The job is idempotent.
- `plan-enforcer` is public (`verify_jwt = false`), so the first thing it does is compare the `x-cron-secret` header with `CRON_SECRET` in constant time. No secret value ever goes in the repo or the chat.
- **Merge rules:**
  - Accounts pair on the same institution, name and mask (compared the same way as `isDuplicateLink`), within the same herd, with the same connector (`accounts.user_id`), and only with archived Items.
  - Rows pair by date, amount and `merchant_key`.
  - Carried to the new row, never over a value already on it: a manual category, `notes`, a hand-picked payer or split whose people are all still herd members, and `reviewed_at`.
  - Every archived row dated on or after the new account's earliest row is deleted, matched or not.
- The merge never fails a sync. It runs after the cursor advance, inside try/catch, like the snapshot.
- Production is not touched. Its push, and its cron secrets, wait on Pedro.

## Review Focus

1. **Plaid delivers history in stages.** The first sync may hold only recent weeks. Later syncs extend the window back, so the merge must run on every sync and never overwrite what an earlier pass carried. (Task 4: a test that runs `planMerge` twice with a growing window.)
2. **A herd plan's pool.** Under `tusk_herd`, the job must judge the herd once, not once per member, and archive the newest bank across the herd. (Task 1: the `decide` test on a herd pool; Task 2 dedupes by herd.)
3. **A payer who left the herd** must not be carried, or the payer or split trigger fails the carry. (Task 4 test.)
4. **Another member's private archived account must never merge into someone else's new bank.** The pair requires the same connector. (Task 5: the query filter; checked in code review.)
5. **A missing Vault secret or `CRON_SECRET`** must make the job do nothing, never act unauthenticated. (Task 2: a `sameSecret` test with an undefined secret.)

---

### Task 1: The enforcer's decision (pure)

**Files:**
- Create: `supabase/functions/_shared/enforce.ts`
- Create: `supabase/functions/_shared/enforce.test.ts`

**Interfaces:**
- Consumes: `PlanState`, `overLimit`, `pastLimit` from `_shared/plans.ts`.
- Produces: `CHOOSE_DAYS = 7`; `type EnforceItem = { id: string; created_at: string; status: string }`; `decide(i: { plan: PlanState; items: EnforceItem[]; overLimitSince: string | null; now: Date }): { archive: string[]; overLimitSince: string | null }`; `sameSecret(given: string | null, expected: string | undefined): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
import { assertEquals } from 'jsr:@std/assert';

import { CHOOSE_DAYS, decide, type EnforceItem, sameSecret } from './enforce.ts';
import type { PlanState } from './plans.ts';

const NOW = new Date('2026-10-10T09:00:00Z');
const plan = (over: Partial<PlanState> = {}): PlanState => ({
  plan: 'tusklet', source: 'own', expires_at: null, max_banks: 3, history_days: 365, ai: true, scope: 'self', banks_used: 3,
  ...over,
});
const item = (id: string, created_at: string): EnforceItem => ({ id, created_at, status: 'active' });
const FOUR = [
  item('a', '2026-01-01T00:00:00Z'),
  item('b', '2026-02-01T00:00:00Z'),
  item('c', '2026-03-01T00:00:00Z'),
  item('d', '2026-04-01T00:00:00Z'),
];

Deno.test('decide: within the limit, nothing happens and the window closes', () => {
  assertEquals(
    decide({ plan: plan(), items: FOUR.slice(0, 3), overLimitSince: '2026-10-01T00:00:00Z', now: NOW }),
    { archive: [], overLimitSince: null },
  );
});

Deno.test('decide: Free archives every bank at once', () => {
  assertEquals(
    decide({ plan: plan({ plan: 'free', max_banks: 0, banks_used: 2 }), items: FOUR.slice(0, 2), overLimitSince: null, now: NOW }),
    { archive: ['a', 'b'], overLimitSince: null },
  );
});

Deno.test('decide: newly over a smaller plan opens the window and archives nothing', () => {
  assertEquals(
    decide({ plan: plan({ banks_used: 4 }), items: FOUR, overLimitSince: null, now: NOW }),
    { archive: [], overLimitSince: NOW.toISOString() },
  );
});

Deno.test('decide: inside the window nothing is archived yet', () => {
  const since = new Date(NOW.getTime() - (CHOOSE_DAYS - 1) * 86_400_000).toISOString();
  assertEquals(decide({ plan: plan({ banks_used: 4 }), items: FOUR, overLimitSince: since, now: NOW }), {
    archive: [],
    overLimitSince: since,
  });
});

Deno.test('decide: after the window, only the newest banks past the limit go', () => {
  const since = new Date(NOW.getTime() - CHOOSE_DAYS * 86_400_000).toISOString();
  assertEquals(decide({ plan: plan({ banks_used: 4 }), items: FOUR, overLimitSince: since, now: NOW }), {
    archive: ['d'],
    overLimitSince: since,
  });
});

Deno.test('decide: a herd pool is judged as one, across members', () => {
  const since = new Date(NOW.getTime() - 8 * 86_400_000).toISOString();
  const pool = [...FOUR, item('e', '2026-05-01T00:00:00Z')];
  assertEquals(
    decide({ plan: plan({ plan: 'tusk_herd', scope: 'herd', max_banks: 3, banks_used: 5 }), items: pool, overLimitSince: since, now: NOW }).archive,
    ['d', 'e'],
  );
});

Deno.test('sameSecret: equal strings only, and never with no secret configured', () => {
  assertEquals(sameSecret('abc123', 'abc123'), true);
  assertEquals(sameSecret('abc124', 'abc123'), false);
  assertEquals(sameSecret('abc', 'abc123'), false);
  assertEquals(sameSecret(null, 'abc123'), false);
  assertEquals(sameSecret('', ''), false);
  assertEquals(sameSecret('anything', undefined), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx -y deno test --allow-env supabase/functions/_shared/enforce.test.ts`
Expected: FAIL, `./enforce.ts` not found.

- [ ] **Step 3: Write `_shared/enforce.ts` (the pure part)**

```ts
import { overLimit, pastLimit, type PlanState } from './plans.ts';

/**
 * When a plan ends or shrinks (Phase 14b). The daily plan-enforcer asks decide()
 * what to do for each user (or herd pool) and carries it out. Pure: the I/O is
 * runEnforcer, below.
 */

/** Days a user has to choose which banks to keep after dropping to a smaller plan. */
export const CHOOSE_DAYS = 7;

export type EnforceItem = { id: string; created_at: string; status: string };

export function decide(i: {
  plan: PlanState;
  items: EnforceItem[];
  overLimitSince: string | null;
  now: Date;
}): { archive: string[]; overLimitSince: string | null } {
  if (!overLimit(i.plan)) return { archive: [], overLimitSince: null };
  // Free keeps no live bank: the trial is over, so every bank goes today.
  if (i.plan.max_banks === 0) return { archive: i.items.map((x) => x.id), overLimitSince: null };
  const since = i.overLimitSince ?? i.now.toISOString();
  const due = i.now.getTime() - Date.parse(since) >= CHOOSE_DAYS * 86_400_000;
  return {
    archive: due ? i.items.filter((x) => pastLimit(i.items, x.id, i.plan.max_banks)).map((x) => x.id) : [],
    overLimitSince: since,
  };
}

/** Constant-time comparison of the cron secret. No configured secret means no access. */
export function sameSecret(given: string | null, expected: string | undefined): boolean {
  if (!expected || given === null || given.length !== expected.length) return false;
  let diff = 0;
  for (let k = 0; k < expected.length; k++) diff |= given.charCodeAt(k) ^ expected.charCodeAt(k);
  return diff === 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx -y deno test --allow-env supabase/functions/_shared/enforce.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```sh
git add supabase/functions/_shared/enforce.ts supabase/functions/_shared/enforce.test.ts
git commit -m "feat(plans): decide what a shrunk or ended plan archives (Phase 14b)"
```

---

### Task 2: The `plan-enforcer` function and its daily cron

**Files:**
- Modify: `supabase/functions/_shared/enforce.ts` (add `runEnforcer`)
- Create: `supabase/functions/plan-enforcer/index.ts`
- Modify: `supabase/config.toml` (after the `[functions.plaid-webhook]` block)
- Create: `supabase/migrations/20261009120000_phase14b_plan_enforcer_cron.sql`

**Interfaces:**
- Consumes: `decide`, `sameSecret` (Task 1); `loadPlan` (`_shared/plans.ts`); `disconnectItem` (`_shared/connections.ts`); `getAdminClient`, `getPlaidClient`, `jsonResponse` (`_shared/lib.ts`).
- Produces: `runEnforcer(admin, plaid, now: Date, dryRun: boolean): Promise<EnforceReport[]>`, where `type EnforceReport = { user_id: string; plan: string; scope: 'self' | 'herd'; archive: string[]; overLimitSince: string | null; results: Record<string, string> }`. The endpoint is `POST /functions/v1/plan-enforcer` with the `x-cron-secret` header, and an optional body `{ "dry_run": true }`.

- [ ] **Step 1: Add `runEnforcer` to `_shared/enforce.ts`**

Add at the top: `import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';`, `import type { PlaidApi } from 'npm:plaid@30';`, `import { disconnectItem } from './connections.ts';`, and add `loadPlan` to the `./plans.ts` import. Then append:

```ts
export type EnforceReport = {
  user_id: string;
  plan: string;
  scope: 'self' | 'herd';
  archive: string[];
  overLimitSince: string | null;
  results: Record<string, string>;
};

/**
 * Every user with a live bank or an open window, judged once (a herd pool once
 * per herd). Never throws for one user: a failure is logged and the rest go on.
 * With dryRun, it decides and reports but changes nothing.
 */
export async function runEnforcer(
  admin: SupabaseClient,
  plaid: PlaidApi,
  now: Date,
  dryRun: boolean,
): Promise<EnforceReport[]> {
  const { data: live, error: liveError } = await admin
    .from('plaid_items').select('user_id, herd_id').in('status', ['active', 'login_required']);
  if (liveError) throw liveError;
  const { data: flagged, error: flaggedError } = await admin
    .from('subscriptions').select('user_id').not('over_limit_since', 'is', null);
  if (flaggedError) throw flaggedError;

  const users = [...new Set([...(live ?? []), ...(flagged ?? [])].map((r) => r.user_id as string))];
  const herdsDone = new Set<string>();
  const reports: EnforceReport[] = [];

  for (const userId of users) {
    try {
      const plan = await loadPlan(admin, userId);
      const { data: member, error: memberError } = await admin
        .from('herd_members').select('herd_id').eq('user_id', userId).single();
      if (memberError) throw memberError;
      const herdId = member.herd_id as string;
      if (plan.scope === 'herd') {
        if (herdsDone.has(herdId)) continue;
        herdsDone.add(herdId);
      }

      const scoped = admin.from('plaid_items').select('id, created_at, status').neq('status', 'archived');
      const { data: items, error: itemsError } = await (plan.scope === 'herd'
        ? scoped.eq('herd_id', herdId)
        : scoped.eq('user_id', userId));
      if (itemsError) throw itemsError;

      // The window lives on every covered member's row: the user's own, or the herd's.
      let covered = [userId];
      if (plan.scope === 'herd') {
        const { data: mates, error: matesError } = await admin
          .from('herd_members').select('user_id').eq('herd_id', herdId);
        if (matesError) throw matesError;
        covered = (mates ?? []).map((m) => m.user_id as string);
      }
      const { data: subs, error: subsError } = await admin
        .from('subscriptions').select('over_limit_since').in('user_id', covered).not('over_limit_since', 'is', null)
        .order('over_limit_since').limit(1);
      if (subsError) throw subsError;
      const overLimitSince = (subs?.[0]?.over_limit_since as string | undefined) ?? null;

      const verdict = decide({ plan, items: items ?? [], overLimitSince, now });
      const results: Record<string, string> = {};

      if (!dryRun) {
        for (const id of verdict.archive) {
          const it = (items ?? []).find((x) => x.id === id)!;
          try {
            results[id] = await disconnectItem(admin, plaid, { id, status: it.status }, 'archive');
          } catch (err) {
            results[id] = `error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        if (verdict.overLimitSince !== overLimitSince) {
          const { error } = await admin
            .from('subscriptions').update({ over_limit_since: verdict.overLimitSince }).in('user_id', covered);
          if (error) throw error;
        }
      }
      reports.push({ user_id: userId, plan: plan.plan, scope: plan.scope, ...verdict, results });
    } catch (err) {
      console.error(`plan-enforcer: user ${userId} skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return reports;
}
```

- [ ] **Step 2: Write the function**

`supabase/functions/plan-enforcer/index.ts`:

```ts
import { runEnforcer, sameSecret } from '../_shared/enforce.ts';
import { getAdminClient, getPlaidClient, jsonResponse } from '../_shared/lib.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

/**
 * The daily plan check (Phase 14b), called by pg_cron. Public, so the cron
 * secret is checked before anything else. It replies at once and works in the
 * background; { dry_run: true } instead waits and returns what it would do.
 */
Deno.serve(async (req) => {
  if (!sameSecret(req.headers.get('x-cron-secret'), Deno.env.get('CRON_SECRET'))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  let body: { dry_run?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // The cron sends {}; an empty body is the same.
  }

  const admin = getAdminClient();
  const plaid = getPlaidClient();
  if (body.dry_run === true) {
    return jsonResponse({ dry_run: true, reports: await runEnforcer(admin, plaid, new Date(), true) });
  }

  EdgeRuntime.waitUntil(
    runEnforcer(admin, plaid, new Date(), false)
      .then((reports) => {
        const acted = reports.filter((r) => r.archive.length > 0 || r.overLimitSince !== null);
        console.log(`plan-enforcer: ${reports.length} judged, ${acted.length} acted`, JSON.stringify(acted));
      })
      .catch((err) => console.error('plan-enforcer failed', err)),
  );
  return jsonResponse({ accepted: true }, 202);
});
```

- [ ] **Step 3: Make it public in config**

In `supabase/config.toml`, after the `[functions.plaid-webhook]` block:

```toml
[functions.plan-enforcer]
verify_jwt = false
```

- [ ] **Step 4: Type-check, test, deploy**

Run: `npx -y deno check supabase/functions/plan-enforcer/index.ts` → no errors.
Run: `npx -y deno test --allow-env supabase/functions/_shared/` → all pass.
Run: `npx -y supabase@2.118.0 functions deploy plan-enforcer --use-api` → `Deployed Functions … plan-enforcer`.

- [ ] **Step 5: Create the secrets on dev, without printing them**

In Git Bash, one command, so the value lives only in a shell variable:

```sh
S=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))") && npx -y supabase@2.118.0 db query --linked "select vault.create_secret('$S', 'cron_secret', 'plan-enforcer cron secret (Phase 14b)')" >/dev/null && npx -y supabase@2.118.0 secrets set CRON_SECRET="$S" >/dev/null && echo set
npx -y supabase@2.118.0 db query --linked "select vault.create_secret('https://ifibrsgqdibcomzxencf.supabase.co', 'project_url', 'This project''s URL, for cron jobs (Phase 14b)')"
```

Expected: `set`, then one row.

- [ ] **Step 6: Check the gate, and a dry run**

```sh
node -e "fetch('https://ifibrsgqdibcomzxencf.supabase.co/functions/v1/plan-enforcer',{method:'POST',body:'{}'}).then(r=>console.log(r.status))"
S=$(npx -y supabase@2.118.0 db query --linked -o csv "select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'" 2>/dev/null | tail -1) && node -e "fetch('https://ifibrsgqdibcomzxencf.supabase.co/functions/v1/plan-enforcer',{method:'POST',headers:{'x-cron-secret':process.argv[1],'content-type':'application/json'},body:JSON.stringify({dry_run:true})}).then(async r=>console.log(r.status, await r.text()))" "$S"
```

Expected: `401` without the header. With it: `200`, and every report has `archive: []` and `overLimitSince: null`, because every dev user is comped Tusk.

- [ ] **Step 7: Schedule it**

`supabase/migrations/20261009120000_phase14b_plan_enforcer_cron.sql`:

```sql
-- Phase 14b: the daily plan check. pg_cron calls the plan-enforcer Edge
-- Function with a shared secret. Both values live in Vault, created per
-- project by hand (docs/ops/production.md), never in the repo. Without them
-- the URL is null and the call fails harmlessly: nothing is enforced.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'plan-enforcer',
  '0 9 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/plan-enforcer',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  $$
);
```

Run: `npx -y supabase@2.118.0 db push` → applies it.
Run: `npx -y supabase@2.118.0 db query --linked -o csv "select jobname, schedule, active from cron.job"` → `plan-enforcer,0 9 * * *,t`.

- [ ] **Step 8: Prove the cron path end to end**

Run the job's command now, then read pg_net's response:

```sh
npx -y supabase@2.118.0 db query --linked "select net.http_post(url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/plan-enforcer', headers := jsonb_build_object('content-type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')), body := '{}'::jsonb)"
npx -y supabase@2.118.0 db query --linked -o csv "select status_code, left(content, 60) as body from net._http_response order by id desc limit 1"
```

Expected: `202,{"accepted":true}`.

- [ ] **Step 9: Commit**

```sh
git add supabase/functions/_shared/enforce.ts supabase/functions/plan-enforcer/index.ts supabase/config.toml supabase/migrations/20261009120000_phase14b_plan_enforcer_cron.sql
git commit -m "feat(plans): a daily plan-enforcer archives banks a plan no longer covers (Phase 14b)"
```

---

### Task 3: The app warns before a removal

**Files:**
- Create: `apps/mobile/src/lib/plan-banner.ts`
- Create: `apps/mobile/src/lib/plan-banner.test.ts`
- Modify: `apps/mobile/src/lib/queries.ts` (add `usePlan`)
- Create: `apps/mobile/src/components/plan-banner.tsx`
- Modify: `apps/mobile/src/app/(tabs)/index.tsx` (render it under the greeting)
- Modify: `apps/mobile/src/app/(tabs)/settings.tsx` (render it above Connections)
- Modify: `apps/mobile/src/lib/plaid.ts` (`BANK_DEPENDENT_KEYS` gains `['plan']`)

**Interfaces:**
- Consumes: `public.my_plan()` (14a); `subscriptions.over_limit_since`.
- Produces: `type PlanInfo = { plan: string; source: 'own' | 'herd' | 'trial' | 'free'; expires_at: string | null; max_banks: number; banks_used: number; over_limit_since: string | null }`; `planBanner(p: PlanInfo, now: Date): { title: string; body: string } | null`; `usePlan(userId)` with query key `['plan']`; `<PlanBanner />`.

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/lib/plan-banner.test.ts`:

```ts
/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planBanner, type PlanInfo } from './plan-banner.ts';

const NOW = new Date('2026-10-10T12:00:00Z');
const info = (over: Partial<PlanInfo> = {}): PlanInfo => ({
  plan: 'tusk', source: 'own', expires_at: null, max_banks: 10, banks_used: 2, over_limit_since: null, ...over,
});

test('nothing to say on a healthy plan', () => {
  assert.equal(planBanner(info(), NOW), null);
});

test('a trial more than 3 days from its end says nothing yet', () => {
  assert.equal(planBanner(info({ plan: 'trial', source: 'trial', expires_at: '2026-10-14T13:00:00Z' }), NOW), null);
});

test('a trial ending within 3 days warns, counting whole days up', () => {
  assert.deepEqual(planBanner(info({ plan: 'trial', source: 'trial', expires_at: '2026-10-12T18:00:00Z' }), NOW), {
    title: 'Your trial ends in 3 days',
    body: 'After that, Tusky disconnects your banks. Everything you have tracked stays here.',
  });
  assert.equal(
    planBanner(info({ plan: 'trial', source: 'trial', expires_at: '2026-10-10T20:00:00Z' }), NOW)?.title,
    'Your trial ends in 1 day',
  );
});

test('over a smaller plan: how many to disconnect, and by when', () => {
  assert.deepEqual(
    planBanner(info({ plan: 'tusklet', max_banks: 3, banks_used: 5, over_limit_since: '2026-10-08T09:00:00Z' }), NOW),
    {
      title: 'Your plan connects up to 3 banks',
      body: 'You have 5. Disconnect 2 in Settings within 5 days, or Tusky disconnects the most recently added.',
    },
  );
});

test('over the limit before the daily check has run: the full window', () => {
  assert.equal(
    planBanner(info({ plan: 'tusklet', max_banks: 3, banks_used: 4 }), NOW)?.body,
    'You have 4. Disconnect 1 in Settings within 7 days, or Tusky disconnects the most recently added.',
  );
});

test('the last day of the window still counts as a day', () => {
  assert.match(
    planBanner(info({ plan: 'tusklet', max_banks: 3, banks_used: 4, over_limit_since: '2026-10-03T13:00:00Z' }), NOW)!.body,
    /within 1 day,/,
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run (in `apps/mobile`): `npm test` → FAIL, cannot find `./plan-banner.ts`.

- [ ] **Step 3: Write `lib/plan-banner.ts`**

```ts
/**
 * The warning a plan owes the user before the daily check acts (Phase 14b):
 * 3 days before a trial ends, and through the 7-day window after dropping to a
 * smaller plan. Pure; the server decides and acts, this only words it.
 */
export type PlanInfo = {
  plan: string;
  source: 'own' | 'herd' | 'trial' | 'free';
  expires_at: string | null;
  max_banks: number;
  banks_used: number;
  over_limit_since: string | null;
};

const DAY = 86_400_000;
const CHOOSE_DAYS = 7; // _shared/enforce.ts
const TRIAL_WARN_DAYS = 3;

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

export function planBanner(p: PlanInfo, now: Date): { title: string; body: string } | null {
  if (p.max_banks > 0 && p.banks_used > p.max_banks) {
    const since = p.over_limit_since ? Date.parse(p.over_limit_since) : now.getTime();
    const left = Math.max(1, Math.ceil((since + CHOOSE_DAYS * DAY - now.getTime()) / DAY));
    return {
      title: `Your plan connects up to ${p.max_banks === 1 ? '1 bank' : `${p.max_banks} banks`}`,
      body: `You have ${p.banks_used}. Disconnect ${p.banks_used - p.max_banks} in Settings within ${days(left)}, or Tusky disconnects the most recently added.`,
    };
  }
  if (p.source === 'trial' && p.expires_at) {
    const left = Math.ceil((Date.parse(p.expires_at) - now.getTime()) / DAY);
    if (left >= 1 && left <= TRIAL_WARN_DAYS) {
      return {
        title: `Your trial ends in ${days(left)}`,
        body: 'After that, Tusky disconnects your banks. Everything you have tracked stays here.',
      };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run (in `apps/mobile`): `npm test` → all pass, including 6 new.

- [ ] **Step 5: `usePlan` in `lib/queries.ts`**

Add near `useProfile`, with `import type { PlanInfo } from '@/lib/plan-banner';` at the top:

```ts
/** The signed-in user's plan (Phase 14): my_plan() plus the 7-day window's start. */
export function usePlan(userId: string | undefined) {
  return useQuery({
    queryKey: ['plan'],
    enabled: !!userId,
    queryFn: async (): Promise<PlanInfo> => {
      const [plan, sub] = await Promise.all([
        supabase.rpc('my_plan').single(),
        supabase.from('subscriptions').select('over_limit_since').eq('user_id', userId!).maybeSingle(),
      ]);
      if (plan.error) throw plan.error;
      if (sub.error) throw sub.error;
      return { ...(plan.data as Omit<PlanInfo, 'over_limit_since'>), over_limit_since: sub.data?.over_limit_since ?? null };
    },
  });
}
```

- [ ] **Step 6: The banner component**

`apps/mobile/src/components/plan-banner.tsx`:

```tsx
import { View } from 'react-native';

import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { planBanner } from '@/lib/plan-banner';
import { usePlan } from '@/lib/queries';

/** A plan warning (Phase 14b), or nothing. Home and Settings show it. */
export function PlanBanner({ userId }: { userId: string | undefined }) {
  const { data: plan } = usePlan(userId);
  const banner = plan ? planBanner(plan, new Date()) : null;
  if (!banner) return null;
  return (
    <Card style={{ gap: Spacing.xs }}>
      <AppText variant="bodyStrong">{banner.title}</AppText>
      <View>
        <AppText tone="dim" variant="caption">
          {banner.body}
        </AppText>
      </View>
    </Card>
  );
}
```

Before writing, check `components/ui/app-text.tsx` for its variant names, and use the strong body variant it actually has.

- [ ] **Step 7: Render it, and refresh it with bank changes**

- In `(tabs)/index.tsx`, render `<PlanBanner userId={…} />` directly after the greeting `<View>…</View>`. Use the same user id the screen already reads (find how `greetName` gets its user: `useSession` or similar), and pass it through.
- In `(tabs)/settings.tsx`, render it directly above the Connections section header.
- In `lib/plaid.ts`, change `BANK_DEPENDENT_KEYS` to `[['plaid_items'], ['plan'], ...HIDDEN_DEPENDENT_KEYS]`.
- Check that `app/bank/[id].tsx`'s disconnect invalidates through the same keys. If it has its own list, add `['plan']` there too.

- [ ] **Step 8: Type-check, lint, test**

Run (in `apps/mobile`): `npm test && npm run typecheck && npx expo lint` → all clean.

- [ ] **Step 9: Commit**

```sh
git add apps/mobile/src
git commit -m "feat(app): warn before a trial ends or a plan's extra banks are disconnected (Phase 14b)"
```

---

### Task 4: The merge plan (pure)

**Files:**
- Create: `supabase/functions/_shared/merge.ts`
- Create: `supabase/functions/_shared/merge.test.ts`

**Interfaces:**
- Produces: `type MergeAccount = { id: string; name: string | null; mask: string | null }`; `pairAccounts(fresh: MergeAccount[], archived: MergeAccount[]): { fresh: string; archived: string }[]`; `type MergeRow = { id: string; date: string; amount: number; merchant_key: string | null; category_id: string | null; category_is_manual: boolean; notes: string | null; paid_by: string | null; paid_by_is_manual: boolean; split: Record<string, number> | null; reviewed_at: string | null }`; `planMerge(oldRows: MergeRow[], newRows: MergeRow[], members: Set<string>): { updates: { id: string; patch: Record<string, unknown> }[]; deleteIds: string[] }`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/_shared/merge.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert';

import { type MergeRow, pairAccounts, planMerge } from './merge.ts';

const row = (id: string, date: string, over: Partial<MergeRow> = {}): MergeRow => ({
  id, date, amount: -12.5, merchant_key: 'starbucks', category_id: 'c-plaid', category_is_manual: false,
  notes: null, paid_by: null, paid_by_is_manual: false, split: null, reviewed_at: null, ...over,
});
const MEMBERS = new Set(['me', 'kel']);

Deno.test('pairAccounts: same name and mask, ignoring case and spaces', () => {
  assertEquals(
    pairAccounts(
      [{ id: 'n1', name: 'Plaid Checking', mask: '0000' }, { id: 'n2', name: 'Plaid Saving', mask: '1111' }],
      [{ id: 'o1', name: ' plaid checking ', mask: '0000' }, { id: 'o3', name: 'Plaid CD', mask: '2222' }],
    ),
    [{ fresh: 'n1', archived: 'o1' }],
  );
});

Deno.test('planMerge: edits move to the twin; the overlap is deleted, older rows stay', () => {
  const old = [
    row('o-early', '2026-01-05'),
    row('o1', '2026-03-01', { category_id: 'c-coffee', category_is_manual: true, notes: 'with Kel', reviewed_at: '2026-03-02T00:00:00Z' }),
    row('o2', '2026-03-02', { amount: -40 }),
  ];
  const fresh = [row('n1', '2026-03-01'), row('n0', '2026-02-20', { merchant_key: 'uber' })];
  assertEquals(planMerge(old, fresh, MEMBERS), {
    updates: [{
      id: 'n1',
      patch: { category_id: 'c-coffee', category_is_manual: true, notes: 'with Kel', reviewed_at: '2026-03-02T00:00:00Z' },
    }],
    deleteIds: ['o1', 'o2'],
  });
});

Deno.test('planMerge: never overwrites what the new row already has', () => {
  const old = [row('o1', '2026-03-01', { notes: 'old memo', category_id: 'c-a', category_is_manual: true })];
  const fresh = [row('n1', '2026-03-01', { notes: 'new memo', category_id: 'c-b', category_is_manual: true })];
  assertEquals(planMerge(old, fresh, MEMBERS).updates, []);
});

Deno.test('planMerge: a payer and a split carry; a leaver does not', () => {
  const old = [
    row('o1', '2026-03-01', { paid_by: 'kel', paid_by_is_manual: true }),
    row('o2', '2026-03-02', { paid_by: null, paid_by_is_manual: true, split: { me: 50, kel: 50 } }),
    row('o3', '2026-03-03', { paid_by: 'gone', paid_by_is_manual: true }),
    row('o4', '2026-03-04', { paid_by: null, paid_by_is_manual: true, split: { me: 50, gone: 50 } }),
  ];
  const fresh = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04'].map((d, k) => row(`n${k + 1}`, d));
  assertEquals(planMerge(old, fresh, MEMBERS).updates, [
    { id: 'n1', patch: { paid_by: 'kel', paid_by_is_manual: true, split: null } },
    { id: 'n2', patch: { paid_by: null, paid_by_is_manual: true, split: { me: 50, kel: 50 } } },
  ]);
});

Deno.test('planMerge: two identical purchases pair one to one', () => {
  const old = [row('o1', '2026-03-01', { notes: 'first' }), row('o2', '2026-03-01', { notes: 'second' })];
  const fresh = [row('n1', '2026-03-01'), row('n2', '2026-03-01')];
  assertEquals(planMerge(old, fresh, MEMBERS).updates.map((u) => [u.id, u.patch.notes]), [['n1', 'first'], ['n2', 'second']]);
});

Deno.test('planMerge: history arriving in stages merges again without undoing the first pass', () => {
  const old = [row('o1', '2026-01-10', { notes: 'jan' }), row('o2', '2026-03-01', { notes: 'mar' })];
  // First sync: only March has arrived.
  const first = planMerge(old, [row('n2', '2026-03-01')], MEMBERS);
  assertEquals(first.deleteIds, ['o2']);
  // Next sync: January arrives; o2 is gone and n2 already carries its memo.
  const second = planMerge([old[0]], [row('n1', '2026-01-10'), row('n2', '2026-03-01', { notes: 'mar' })], MEMBERS);
  assertEquals(second, { updates: [{ id: 'n1', patch: { notes: 'jan' } }], deleteIds: ['o1'] });
});

Deno.test('planMerge: no new rows yet means nothing changes', () => {
  assertEquals(planMerge([row('o1', '2026-03-01')], [], MEMBERS), { updates: [], deleteIds: [] });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx -y deno test --allow-env supabase/functions/_shared/merge.test.ts` → FAIL, `./merge.ts` not found.

- [ ] **Step 3: Write `_shared/merge.ts` (pure part)**

```ts
/**
 * Reconnecting merges the history (Phase 14b). A bank reconnected after its
 * plan lapsed is a new Plaid Item whose history overlaps the kept one. The new
 * copy is the complete one, so in the overlap each kept row hands its edits to
 * its twin and is deleted. Older kept rows stay. Pure; mergeReconnected does the I/O.
 */

export type MergeAccount = { id: string; name: string | null; mask: string | null };

export type MergeRow = {
  id: string;
  date: string;
  amount: number;
  merchant_key: string | null;
  category_id: string | null;
  category_is_manual: boolean;
  notes: string | null;
  paid_by: string | null;
  paid_by_is_manual: boolean;
  split: Record<string, number> | null;
  reviewed_at: string | null;
};

const fold = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** New accounts matched to archived ones: same name and mask (isDuplicateLink's rule). */
export function pairAccounts(fresh: MergeAccount[], archived: MergeAccount[]): { fresh: string; archived: string }[] {
  const pairs: { fresh: string; archived: string }[] = [];
  for (const f of fresh) {
    for (const a of archived) {
      if (fold(a.name) === fold(f.name) && fold(a.mask) === fold(f.mask)) pairs.push({ fresh: f.id, archived: a.id });
    }
  }
  return pairs;
}

const keyOf = (r: MergeRow) => `${r.date}|${r.amount}|${r.merchant_key ?? ''}`;

export function planMerge(
  oldRows: MergeRow[],
  newRows: MergeRow[],
  members: Set<string>,
): { updates: { id: string; patch: Record<string, unknown> }[]; deleteIds: string[] } {
  if (newRows.length === 0) return { updates: [], deleteIds: [] };
  const start = newRows.reduce((m, r) => (r.date < m ? r.date : m), newRows[0].date);
  const byId = (x: MergeRow, y: MergeRow) => (x.id < y.id ? -1 : 1);
  const overlap = oldRows.filter((r) => r.date >= start).sort(byId);

  const twins = new Map<string, MergeRow[]>();
  for (const r of [...newRows].sort(byId)) {
    const k = keyOf(r);
    twins.set(k, [...(twins.get(k) ?? []), r]);
  }

  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  for (const o of overlap) {
    const twin = twins.get(keyOf(o))?.shift();
    if (!twin) continue;
    const patch: Record<string, unknown> = {};
    if (o.category_is_manual && !twin.category_is_manual) {
      patch.category_id = o.category_id;
      patch.category_is_manual = true;
    }
    if (o.notes && !twin.notes) patch.notes = o.notes;
    const peopleStay = (o.paid_by === null || members.has(o.paid_by)) &&
      (o.split === null || Object.keys(o.split).every((id) => members.has(id)));
    if (o.paid_by_is_manual && !twin.paid_by_is_manual && peopleStay) {
      patch.paid_by = o.split ? null : o.paid_by;
      patch.paid_by_is_manual = true;
      patch.split = o.split;
    }
    if (o.reviewed_at && !twin.reviewed_at) patch.reviewed_at = o.reviewed_at;
    if (Object.keys(patch).length > 0) updates.push({ id: twin.id, patch });
  }
  return { updates, deleteIds: overlap.map((r) => r.id) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx -y deno test --allow-env supabase/functions/_shared/merge.test.ts` → 7 passed.

- [ ] **Step 5: Commit**

```sh
git add supabase/functions/_shared/merge.ts supabase/functions/_shared/merge.test.ts
git commit -m "feat(sync): plan how a reconnected bank's history merges with the kept one (Phase 14b)"
```

---

### Task 5: Run the merge in every sync

**Files:**
- Modify: `supabase/functions/_shared/merge.ts` (add `mergeReconnected`)
- Modify: `supabase/functions/_shared/sync.ts` (call it after the cursor advance)

**Interfaces:**
- Consumes: `pairAccounts`, `planMerge` (Task 4).
- Produces: `mergeReconnected(admin: SupabaseClient, item: { id: string; user_id: string; herd_id: string }): Promise<number>`, which returns how many kept rows were replaced.

- [ ] **Step 1: Write `mergeReconnected`**

Append to `_shared/merge.ts` (plus `import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';` at the top):

```ts
const ROW_COLUMNS =
  'id, date, amount, merchant_key, category_id, category_is_manual, notes, paid_by, paid_by_is_manual, split, reviewed_at';

/** Every row of one account, past PostgREST's 1000-row page. */
async function allRows(admin: SupabaseClient, accountId: string, from?: string): Promise<MergeRow[]> {
  const out: MergeRow[] = [];
  for (let page = 0; ; page++) {
    let q = admin.from('transactions').select(ROW_COLUMNS).eq('account_id', accountId);
    if (from) q = q.gte('date', from);
    const { data, error } = await q.order('id').range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...((data ?? []) as MergeRow[]));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * Merge this Item's accounts with archived twins: same institution, same
 * herd, same connector (so another member's private history never moves).
 * Cheap when there is nothing to merge: one query. Throws on a database
 * error; syncItem catches it.
 */
export async function mergeReconnected(
  admin: SupabaseClient,
  item: { id: string; user_id: string; herd_id: string },
): Promise<number> {
  const { data: self, error: selfError } = await admin
    .from('plaid_items').select('institution_id').eq('id', item.id).single();
  if (selfError) throw selfError;
  if (!self?.institution_id) return 0;

  const { data: archived, error: archivedError } = await admin
    .from('accounts')
    .select('id, name, mask, plaid_items!inner(institution_id, status)')
    .eq('herd_id', item.herd_id)
    .eq('user_id', item.user_id)
    .eq('plaid_items.institution_id', self.institution_id)
    .eq('plaid_items.status', 'archived');
  if (archivedError) throw archivedError;
  if (!archived || archived.length === 0) return 0;

  const { data: fresh, error: freshError } = await admin
    .from('accounts').select('id, name, mask').eq('item_id', item.id);
  if (freshError) throw freshError;
  const pairs = pairAccounts(fresh ?? [], archived);
  if (pairs.length === 0) return 0;

  const { data: memberRows, error: memberError } = await admin
    .from('herd_members').select('user_id').eq('herd_id', item.herd_id);
  if (memberError) throw memberError;
  const members = new Set((memberRows ?? []).map((m) => m.user_id as string));

  let replaced = 0;
  for (const pair of pairs) {
    const newRows = await allRows(admin, pair.fresh);
    if (newRows.length === 0) continue;
    const start = newRows.reduce((m, r) => (r.date < m ? r.date : m), newRows[0].date);
    const oldRows = await allRows(admin, pair.archived, start);
    const plan = planMerge(oldRows, newRows, members);
    for (const u of plan.updates) {
      const { error } = await admin.from('transactions').update(u.patch).eq('id', u.id);
      if (error) throw error;
    }
    for (let k = 0; k < plan.deleteIds.length; k += 200) {
      const { error } = await admin.from('transactions').delete().in('id', plan.deleteIds.slice(k, k + 200));
      if (error) throw error;
    }
    replaced += plan.deleteIds.length;
  }
  return replaced;
}
```

- [ ] **Step 2: Call it from `syncItem`**

In `_shared/sync.ts`, import `mergeReconnected` from `./merge.ts`. Directly after `result = { ...base, added: …, modified: …, removed: … };` and before the Jev block, add:

```ts
    // 14b: a reconnected bank takes over its kept history. After the cursor and
    // `result`, like the snapshot: a failed merge must not fail a good sync, and
    // it runs again next sync, since Plaid delivers history in stages.
    try {
      const replaced = await mergeReconnected(admin, item);
      if (replaced > 0) console.log(`item ${item.id}: merged ${replaced} kept rows into the reconnected bank`);
    } catch (err) {
      console.warn(`reconnect merge failed for item ${item.id}: ${describeError(err)}`);
    }
```

- [ ] **Step 3: Type-check, test, deploy**

Run: `npx -y deno test --allow-env supabase/functions/_shared/` → all pass.
Run: `npx -y supabase@2.118.0 functions deploy plaid-sync-transactions plaid-webhook --use-api` → deployed.

- [ ] **Step 4: Commit**

```sh
git add supabase/functions/_shared/merge.ts supabase/functions/_shared/sync.ts
git commit -m "feat(sync): a reconnected bank takes over its kept history (Phase 14b)"
```

---

### Task 6: Live verification on dev

Everything happens on dev, as the test user (`ccbd42ef-…`), and is restored at the end.

- [ ] **Step 1: Mark an edit on the kept First Platypus history**

Pick the most recent archived First Platypus row that has a merchant, and give it a manual category and a memo:

```sh
npx -y supabase@2.118.0 db query --linked -o csv "select t.id, t.date, t.amount, t.merchant_key from transactions t join plaid_items i on i.id = t.item_id where i.status = 'archived' and i.institution_name ilike '%platypus%' and t.merchant_key is not null order by t.date desc limit 1"
npx -y supabase@2.118.0 db query --linked "update transactions set notes = 'merge-check', category_id = (select id from categories where slug = 'coffee' and herd_id is null), category_is_manual = true where id = '<that id>'"
```

(If there's no `coffee` slug, use any built-in child: `select slug from categories where herd_id is null and parent_id is not null limit 1`.)

- [ ] **Step 2: Relink First Platypus on the emulator**

Follow `tusky-tooling-notes`: Settings → **Connect another bank** → First Platypus Bank (the non-OAuth entry, `ins_109508`) → `user_transactions_dynamic` / `pass_good`. Poll `node scripts/emu.mjs ui` between steps. After it returns, pull to refresh on Home.

- [ ] **Step 3: Check the merge**

```sh
npx -y supabase@2.118.0 db query --linked -o csv "with n as (select a.name, a.mask, min(t.date) as start from accounts a join plaid_items i on i.id = a.item_id join transactions t on t.account_id = a.id where i.status = 'active' and i.institution_name ilike '%platypus%' group by a.name, a.mask) select n.name, n.start, (select count(*) from transactions t join accounts a on a.id = t.account_id join plaid_items i on i.id = a.item_id where i.status = 'archived' and a.name = n.name and a.mask is not distinct from n.mask and t.date >= n.start) as kept_in_overlap from n"
npx -y supabase@2.118.0 db query --linked -o csv "select count(*) as carried from transactions t join plaid_items i on i.id = t.item_id where i.status = 'active' and t.notes = 'merge-check'"
```

Expected: `kept_in_overlap` is 0 for every paired account. `carried` is 1 if Sandbox gave the new Item a twin for that row (same date, amount and merchant). If it's 0, check whether a twin exists at all (Sandbox may generate different data per Item). If there's no twin, the unit tests stand as the proof for carrying, and the handoff says so.

- [ ] **Step 4: Enforce a smaller plan against the new bank**

The test user now has two live banks: Chase (09-20) and the new Platypus (today). Shrink Tusklet to 1 bank for the test, and put the test user on it:

```sh
npx -y supabase@2.118.0 db query --linked "update plans set max_banks = 1 where id = 'tusklet'; update subscriptions set plan = 'tusklet', store = 'play' where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2'"
```

Run the enforcer for real (the Task 2 Step 6 command, with body `{}`), then read the result:

```sh
npx -y supabase@2.118.0 db query --linked -o csv "select over_limit_since is not null as window_open from subscriptions where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2'; select institution_name, status from plaid_items where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2' and status <> 'archived'"
```

Expected: `window_open` is t, and both banks are still live. On the emulator, Home shows "Your plan connects up to 1 bank / You have 2. Disconnect 1 in Settings within 7 days…".

Backdate the window and run again:

```sh
npx -y supabase@2.118.0 db query --linked "update subscriptions set over_limit_since = now() - interval '8 days' where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2'"
```

Run the enforcer again (body `{}`). Expected: the new Platypus Item is `archived` and Chase is still `active`. Run it a third time. Expected: nothing changes, and `over_limit_since` is back to null (the user is under the limit again).

- [ ] **Step 5: Restore**

```sh
npx -y supabase@2.118.0 db query --linked "update plans set max_banks = 3 where id = 'tusklet'; update subscriptions set plan = 'tusk', store = 'comp', expires_at = null, over_limit_since = null where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2'; update transactions set notes = null where notes = 'merge-check'"
npx -y supabase@2.118.0 db query --linked -o csv "select id, max_banks from plans order by rank"
```

Expected: 0/2/3/10/15. The re-archived Platypus stays archived; its history is kept, which is the normal state.

- [ ] **Step 6: RLS check**

Run: `node scripts/rls-check.mjs` → `all PASS`.

---

### Task 7: Docs, handoff, PR

**Files:**
- Modify: `CLAUDE.md` (a Phase 14b bullet under the Plans convention)
- Modify: `docs/ops/production.md` (the per-project cron secrets)
- Modify: `docs/superpowers/specs/2026-09-23-phase-6-connections-control-design.md` (the relink-overlap limitation is fixed)
- Create: `docs/superpowers/plans/2026-09-28-phase-14b-handoff.md`

- [ ] **Step 1: CLAUDE.md**

Append to the Plans (Phase 14a) bullet:

```markdown
  - **Lifecycle (14b).** `plan-enforcer` runs daily (pg_cron → pg_net, 09:00 UTC) and is public, so it
    checks `x-cron-secret` against `CRON_SECRET` first. Vault holds `cron_secret` and `project_url`
    per project; without them the job does nothing. Free archives every bank at once; a smaller plan
    opens a 7-day window (`subscriptions.over_limit_since`), then archives the newest past the
    limit. `{ "dry_run": true }` reports without acting. The app's `planBanner` (`lib/plan-banner.ts`)
    warns 3 days before a trial ends and through the window.
  - **Reconnect merge (14b).** Every sync runs `mergeReconnected` (`_shared/merge.ts`): accounts of the
    same connector, institution, name and mask on an archived Item pair with the new ones; in the
    overlap, edits move to the twin (date, amount, merchant_key) and the kept rows are deleted. It
    runs every sync because Plaid delivers history in stages, and it never overwrites a value.
```

- [ ] **Step 2: production.md**

Add a "Cron (Phase 14b)" section with the two commands from Task 2 Step 5, with `project_url` set to production's URL (`https://awiwcgrisyzimzxgddxu.supabase.co`) and every command naming `--project-ref awiwcgrisyzimzxgddxu`. Note that both secrets are created once per project, before the 14b migration is pushed, and that the cron is harmless without them.

- [ ] **Step 3: Phase 6 spec**

Where it lists "Reconnecting a bank whose history was kept creates a new connection. Its first 90 days overlap the kept history and show twice…", append: "Fixed in Phase 14b: the reconnect merge (`_shared/merge.ts`)."

- [ ] **Step 4: The handoff**

Cover:
- what shipped, per task;
- the dev state: the migration, the three functions deployed, the cron scheduled, Vault and function secrets set, and the test user restored;
- what was verified, with the results as seen (including whether Sandbox gave a twin for the carried-memo check);
- what waits on Pedro: production's secrets, then `db push` (12d, 14a and 14b), then deploying `plan-enforcer`, `plaid-sync-transactions`, `plaid-webhook`, `plaid-create-link-token` and `plaid-exchange-token`.

- [ ] **Step 5: Final gate, commit, PR**

```sh
npx -y deno test --allow-env supabase/functions/_shared/
node scripts/rls-check.mjs
cd apps/mobile && npm test && npm run typecheck && npx expo lint
```

All pass. Commit the docs, push `pedro-14b`, unset upstream, and open the PR to `master` in PowerShell with `gh` (see `tusky-tooling-notes`). Pedro merges.
