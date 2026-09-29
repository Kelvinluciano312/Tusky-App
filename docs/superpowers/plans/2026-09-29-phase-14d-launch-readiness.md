# Phase 14d — Launch Readiness (Android, then iOS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** in progress (2026-09-29). The decisions below have answers. RevenueCat's Test Store is set up on dev. 14c's live Test Store run (14c plan, Task 7) goes first.

**Goal:** Make purchases ready to sell on Google Play (14d-1) and then the App Store (14d-2). That means:
- finish the purchase polish 14c's review deferred;
- add in-app account deletion, which both stores require;
- build release apps through EAS;
- prove Play Billing, then StoreKit, live.

**Architecture:**
- **Server.** Two additions. `plan-refresh` gets a per-user cooldown, recorded in a new `subscriptions.refreshed_at` column. A new `delete-account` function runs a pure, injected `deleteAccount()` (`_shared/account.ts`), in this order:
  1. Leave a shared herd.
  2. Remove every live bank at Plaid through Phase 6's `disconnectItem`, stopping on the first failure.
  3. Delete the user's own herd.
  4. Delete the auth user.
  5. Forget the RevenueCat customer.
- **App.** Pure wording and decisions stay in `lib/paywall.ts`, with node tests. The paywall learns to:
  - switch the billing period;
  - explain a deferred downgrade and a purchase that hasn't been confirmed yet;
  - tell "can't load" apart from "coming soon";
  - name the right store;
  - link the privacy policy and terms.

  Settings gains Delete account.
- **Builds.** EAS builds in the cloud, which works from Windows and is the only path to iOS without a Mac.
  - `playtest` is a release build **without** the production env vars. `pickBackend` then chooses the dev project, so Play Billing can be tested against dev while production purchases stay off.
  - `production` is the real release.

**Tech Stack:** Deno Edge Functions, Postgres, Expo SDK 57, `react-native-purchases` 10.10, EAS Build and Submit, Google Play Console, App Store Connect, RevenueCat.

**Spec:** `docs/superpowers/specs/2026-09-28-phase-14-monetization-design.md` (milestone 14d; "Buying"; "Testing"; "Rollout"). Background: 14c's handoff `2026-09-28-phase-14c-handoff.md` ("Deferred minors").

## Decisions for Pedro (answer before Task 1)

| # | Question | Recommended |
| --- | --- | --- |
| D1 | How release builds are made | **EAS Build** (cloud). The free tier gives 30 builds a month, and it is the only way to build iOS without a Mac. The alternative is local `gradlew bundleRelease` with a hand-kept upload keystore, which works only for Android. |
| D2 | Which backend the Play test build talks to | **Dev.** The `playtest` profile leaves out the production env vars, and license-tester purchases are RevenueCat *sandbox* events, which go to the dev webhook. Production purchases stay off until launch, as the spec says. |
| D3 | Webhook and `plan-refresh` racing near a renewal (14c minor) | **Accept and document.** Both re-read RevenueCat, and the next event corrects the row. A conditional write would cost a retry loop for a window of seconds. |
| D4 | iOS testing | Needs an **iPhone** and an **Apple Developer account** ($99/yr). Without them, 14d-2 waits and 14d-1 ships alone. |
| D5 | Legal pages | Play and Apple both want a **privacy policy URL**. Play also wants a **web page for account deletion requests** (a page with an email address is enough). Where do these live: GitHub Pages, Notion, or a domain? |

**Answers (Pedro, 2026-09-29):**

- **D1, D2, D3:** as recommended.
- **D4:** no iPhone yet, so 14d-2 waits.
- **D5:** GitHub Pages, from a `site/` folder in this repo (the repo is public). A domain can point at it later. The app links the pages from a Legal card in Settings, as well as from the paywall (Task 4b).
- **D6 (new): the package name is `com.ouroborosstudios.tusky`.** The Play Console app already uses it, and Play locks the name at the first upload. Task 6 renames the app from `com.tusky.app`, just before the first build. Native Plaid Link refuses a package name that isn't on Plaid's allowed list, so Kelvyn adds the new name in the Plaid dashboard (dev and production) first. Task 5 still links a bank under the old name.
- **Prices** in RevenueCat's Test Store are placeholders. Pedro sets the real ones in the Play Console, and the paywall shows whatever the store returns.

## Global Constraints

- **Access.** The app never grants access. Every write to `subscriptions` comes from the service role, and `refreshed_at` is written only by `plan-refresh`.
- **Deleting an account removes every bank at Plaid first.** Deleting a row never stops Plaid's billing; only `/item/remove` does. On the first bank that fails at Plaid (`plaid_failed` or `busy`), stop and delete nothing else. Retrying finishes the job.
- **What a deleted account leaves behind.** In a shared herd, the user leaves first (`leave_herd`). The herd keeps its config, and the leaver's banks go with them. The user's own herd, and everything in it, is then deleted.
- **Store subscriptions outlive our account.** Deleting an account while `ownPaidPlan` is set warns first, with a Manage subscription button.
- **Play product structure.** Three subscriptions, `tusklet`, `tusk` and `tusk_herd`, each with base plans `monthly` and `yearly` (so product ids read `tusk:monthly`). App Store products are `tusklet_monthly` … `tusk_herd_yearly` in one subscription group, ranked tusk_herd > tusk > tusklet. Packages keep 14c's ids.
- **Webhooks, by RevenueCat environment.** Sandbox events (Test Store, Play license testers, the App Store sandbox) go to **dev**. Production events go to **production**, and that webhook is created only at launch.
- **Keys.** `EXPO_PUBLIC_PROD_REVENUECAT_KEY` (and the iOS production key) stay empty until Pedro and Kelvyn launch.
- **Cooldown.** `plan-refresh` refuses a second call within **10 seconds** with `429 { result: 'too_soon' }`, and makes no RevenueCat call.
- **Secrets.** No secret value goes in the repo or the chat. EAS env vars hold only `EXPO_PUBLIC_*` values, which are public by design.
- **Production.** Every production step (migration, deploys, secrets, webhook) waits for Pedro's go-ahead.

## Review Focus

1. **A herd mate deletes their account.** Settlements where they are `from_user` or `to_user` cascade away with them, so the remaining member's settle-up history loses those payments. A reasonable person expects the balance to stay explainable. Task 5 checks this live and records what the remaining member sees. If the balance jumps, it becomes a finding for Pedro to decide; this plan does not invent a fix.
2. **Plaid fails halfway through a deletion.** One bank is already removed and the next fails. The account must stay usable, and a retry must finish. (Task 2: two tests, "stops at a failure" and "a retry after a partial run".)
3. **Switching Tusk monthly to Tusk yearly on Play.** The base plan changes within the same subscription. This plan assumes `oldProductIdentifier: 'tusk'` with `WITH_TIME_PRORATION`, which Play and RevenueCat must accept. (Task 7 checks it live.)
4. **A second purchase within 10 seconds.** The second `plan-refresh` gets `too_soon`. The user must still see their plan, through the "Purchase received" message and the delayed refetch. (Task 3: an `afterPurchase` test for an unconfirmed purchase; Task 1: a cooldown test.)
5. **The paywall before the plan loads.** A herd-covered user must not be able to tap Choose before the "already covered" card can show. (Task 3: `tierAction` returns disabled while the plan is unknown.)

## Not in this plan

- Push notifications, web checkout, Brazil pricing, and the assistant (the spec's "Later").
- A conditional write against the webhook/refresh race (D3).
- Promotional offers, free trials inside the store, and win-back offers.

---

# 14d-1 — Android launch readiness

### Task 1: `plan-refresh` gets a cooldown

**Files:**
- Create: `supabase/migrations/20261011120000_phase14d_refresh_cooldown.sql`
- Modify: `supabase/functions/_shared/revenuecat.ts`
- Modify: `supabase/functions/_shared/revenuecat.test.ts`
- Modify: `supabase/functions/plan-refresh/index.ts`

**Interfaces:**
- Consumes: `SubStore`, `syncSubscriber`, `RcClient` (14c).
- Produces:
  ```ts
  export const REFRESH_COOLDOWN_MS = 10_000;
  export type RefreshStore = SubStore & { claimRefresh(userId: string, now: Date): Promise<boolean> };
  export async function refreshCaller(db: RefreshStore, rc: RcClient, userId: string, now: Date, allowTest: boolean): Promise<'too_soon' | 'written' | 'unchanged' | 'no_row'>;
  export function adminSubStore(admin: SupabaseClient): RefreshStore; // was SubStore
  ```
  `plan-refresh` answers `200 { result }`, or `429 { result: 'too_soon' }`.

- [ ] **Step 1: Write the failing tests** (append to `revenuecat.test.ts`; add `refreshCaller` and `type RefreshStore` to the import from `./revenuecat.ts`)

```ts
function refreshStore(rows: Record<string, SubRow>, last: Record<string, number> = {}): RefreshStore & { writes: [string, SubRow][] } {
  const base = memoryStore(rows);
  return {
    ...base,
    claimRefresh: (id, now) => {
      if (!rows[id] || (last[id] !== undefined && now.getTime() - last[id] < 10_000)) return Promise.resolve(false);
      last[id] = now.getTime();
      return Promise.resolve(true);
    },
  };
}

Deno.test('refreshCaller: the first call syncs', async () => {
  const db = refreshStore({ [U1]: TRIAL });
  assertEquals(await refreshCaller(db, rcWith(LIVE_TUSK), U1, NOW, false), 'written');
});

Deno.test('refreshCaller: a second call within the cooldown never reaches RevenueCat', async () => {
  const db = refreshStore({ [U1]: TRIAL });
  let calls = 0;
  const counting: RcClient = { subscriber: () => (calls++, Promise.resolve(LIVE_TUSK)) };
  await refreshCaller(db, counting, U1, NOW, false);
  assertEquals(await refreshCaller(db, counting, U1, new Date(NOW.getTime() + 5_000), false), 'too_soon');
  assertEquals(calls, 1);
});

Deno.test('refreshCaller: after the cooldown it syncs again', async () => {
  const db = refreshStore({ [U1]: TRIAL });
  await refreshCaller(db, rcWith(LIVE_TUSK), U1, NOW, false);
  // memoryStore records writes without applying them, so the second sync writes again.
  assertEquals(await refreshCaller(db, rcWith(LIVE_TUSK), U1, new Date(NOW.getTime() + 11_000), false), 'written');
  assertEquals(db.writes.length, 2);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx -y deno test --allow-env supabase/functions/_shared/revenuecat.test.ts`
Expected: FAIL, `refreshCaller` is not exported.

- [ ] **Step 3: Implement** (append to `revenuecat.ts`, and change `adminSubStore`'s return type to `RefreshStore`)

```ts
/** The app may ask for a refresh once per 10 seconds; RevenueCat's rate limit is shared with the webhook. */
export const REFRESH_COOLDOWN_MS = 10_000;

export type RefreshStore = SubStore & { claimRefresh(userId: string, now: Date): Promise<boolean> };

/** plan-refresh: claim the cooldown first, so a loop of calls never reaches RevenueCat. */
export async function refreshCaller(
  db: RefreshStore,
  rc: RcClient,
  userId: string,
  now: Date,
  allowTest: boolean,
): Promise<'too_soon' | 'written' | 'unchanged' | 'no_row'> {
  if (!(await db.claimRefresh(userId, now))) return 'too_soon';
  return syncSubscriber(db, rc, userId, now, allowTest);
}
```

In `adminSubStore`, add beside `read` and `write`:

```ts
    async claimRefresh(userId, now) {
      // One conditional update: two racing calls cannot both claim.
      const since = new Date(now.getTime() - REFRESH_COOLDOWN_MS).toISOString();
      const { data, error } = await admin
        .from('subscriptions')
        .update({ refreshed_at: now.toISOString() })
        .eq('user_id', userId)
        .or(`refreshed_at.is.null,refreshed_at.lt.${since}`)
        .select('user_id');
      if (error) throw error;
      return (data ?? []).length > 0;
    },
```

`supabase/migrations/20261011120000_phase14d_refresh_cooldown.sql`:

```sql
-- Phase 14d: plan-refresh's per-user cooldown. Written only by plan-refresh
-- (service role); the table-level select grant lets the app read it, which is harmless.
alter table public.subscriptions add column refreshed_at timestamptz;
```

In `plan-refresh/index.ts`, import `refreshCaller` instead of `syncSubscriber` and replace the `try` body with:

```ts
    const result = await refreshCaller(
      adminSubStore(admin),
      revenueCatClient(Deno.env.get('REVENUECAT_SECRET_KEY') ?? ''),
      user.id,
      new Date(),
      Deno.env.get('PLAID_ENV') === 'sandbox',
    );
    return jsonResponse({ result }, result === 'too_soon' ? 429 : 200);
```

- [ ] **Step 4: Run the tests and the type check**

Run: `npx -y deno test --allow-env supabase/functions/_shared/ && npx -y deno check supabase/functions/plan-refresh/index.ts`
Expected: all pass (271 + 3).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261011120000_phase14d_refresh_cooldown.sql supabase/functions/_shared/revenuecat.ts supabase/functions/_shared/revenuecat.test.ts supabase/functions/plan-refresh/index.ts
git commit -m "feat(plans): plan-refresh gets a 10-second cooldown per user (Phase 14d)"
```

---

### Task 2: `delete-account` on the server

**Files:**
- Create: `supabase/functions/_shared/account.ts`
- Create: `supabase/functions/_shared/account.test.ts`
- Create: `supabase/functions/delete-account/index.ts`
- Modify: `supabase/functions/_shared/revenuecat.ts` (add `forgetRevenueCatUser`)

**Interfaces:**
- Consumes: `disconnectItem`, `DisconnectResult` (`_shared/connections.ts`); `getAdminClient`, `getAuthedUser`, `getPlaidClient`, `jsonResponse`, `corsHeaders` (`_shared/lib.ts`); the `leave_herd(p_user uuid)` RPC (9c/9d).
- Produces:
  ```ts
  export type AccountOps = {
    herdSize(userId: string): Promise<number>;           // 0 when the user has no herd
    leaveHerd(userId: string): Promise<void>;
    liveItems(userId: string): Promise<{ id: string; status: string }[]>;
    disconnect(item: { id: string; status: string }): Promise<DisconnectResult>;
    herdOf(userId: string): Promise<string | null>;
    deleteHerd(herdId: string): Promise<void>;
    deleteUser(userId: string): Promise<void>;
    forgetPurchaser(userId: string): Promise<void>;
  };
  export async function deleteAccount(ops: AccountOps, userId: string): Promise<'deleted' | 'plaid_failed' | 'busy'>;
  export async function forgetRevenueCatUser(secretKey: string, appUserId: string): Promise<void>; // revenuecat.ts
  ```
  `delete-account` answers `200 { deleted: true }`, `502 { error: 'plaid_failed' }`, or `409 { error: 'busy' }`.

- [ ] **Step 1: Write the failing tests**

`supabase/functions/_shared/account.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert';

import { type AccountOps, deleteAccount } from './account.ts';
import type { DisconnectResult } from './connections.ts';

/** Records every call in order; `herd` and `items` describe the user's state. */
function fakeOps(s: { size: number; herd: string | null; items: string[]; fail?: Record<string, DisconnectResult>; forgetThrows?: boolean }) {
  const log: string[] = [];
  const ops: AccountOps = {
    herdSize: () => Promise.resolve(s.size),
    leaveHerd: (u) => (log.push(`leave ${u}`), s.size = 1, Promise.resolve()),
    liveItems: () => Promise.resolve(s.items.map((id) => ({ id, status: 'active' }))),
    disconnect: (item) => {
      log.push(`disconnect ${item.id}`);
      const r = s.fail?.[item.id] ?? 'ok';
      if (r === 'ok') s.items = s.items.filter((i) => i !== item.id);
      return Promise.resolve(r);
    },
    herdOf: () => Promise.resolve(s.herd),
    deleteHerd: (h) => (log.push(`delete herd ${h}`), s.herd = null, Promise.resolve()),
    deleteUser: (u) => (log.push(`delete user ${u}`), Promise.resolve()),
    forgetPurchaser: (u) => (log.push(`forget ${u}`), s.forgetThrows ? Promise.reject(new Error('rc down')) : Promise.resolve()),
  };
  return { ops, log };
}

Deno.test('alone: every bank goes at Plaid, then the herd, then the user', async () => {
  const { ops, log } = fakeOps({ size: 1, herd: 'h1', items: ['a', 'b'] });
  assertEquals(await deleteAccount(ops, 'u'), 'deleted');
  assertEquals(log, ['disconnect a', 'disconnect b', 'delete herd h1', 'delete user u', 'forget u']);
});

Deno.test('in a shared herd: leave first, so the herd keeps its config', async () => {
  const { ops, log } = fakeOps({ size: 3, herd: 'mine', items: [] });
  await deleteAccount(ops, 'u');
  assertEquals(log[0], 'leave u');
});

Deno.test('stops at a failure: nothing past the failed bank is touched', async () => {
  const { ops, log } = fakeOps({ size: 1, herd: 'h1', items: ['a', 'b', 'c'], fail: { b: 'plaid_failed' } });
  assertEquals(await deleteAccount(ops, 'u'), 'plaid_failed');
  assertEquals(log, ['disconnect a', 'disconnect b']);
});

Deno.test('a busy bank refuses too', async () => {
  const { ops } = fakeOps({ size: 1, herd: 'h1', items: ['a'], fail: { a: 'busy' } });
  assertEquals(await deleteAccount(ops, 'u'), 'busy');
});

Deno.test('a retry after a partial run finishes the job', async () => {
  const s = { size: 1, herd: 'h1' as string | null, items: ['a', 'b'], fail: { b: 'plaid_failed' as DisconnectResult } };
  const first = fakeOps(s);
  await deleteAccount(first.ops, 'u');
  delete (s.fail as Record<string, DisconnectResult>).b;
  const second = fakeOps(s);
  assertEquals(await deleteAccount(second.ops, 'u'), 'deleted');
  assertEquals(second.log, ['disconnect b', 'delete herd h1', 'delete user u', 'forget u']);
});

Deno.test('a run that stopped after the herd went still deletes the user', async () => {
  const { ops, log } = fakeOps({ size: 0, herd: null, items: [] });
  assertEquals(await deleteAccount(ops, 'u'), 'deleted');
  assertEquals(log, ['delete user u', 'forget u']);
});

Deno.test('RevenueCat being down never fails a deletion', async () => {
  const { ops } = fakeOps({ size: 1, herd: 'h1', items: [], forgetThrows: true });
  assertEquals(await deleteAccount(ops, 'u'), 'deleted');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx -y deno test --allow-env supabase/functions/_shared/account.test.ts`
Expected: FAIL, `./account.ts` not found.

- [ ] **Step 3: Write `_shared/account.ts`**

```ts
import type { DisconnectResult } from './connections.ts';

/**
 * Deleting an account (Phase 14d). Both stores require it in the app. Plaid
 * bills per connected Item until /item/remove, and a cascade never calls
 * Plaid, so every live bank is removed there first; on the first failure we
 * stop and delete nothing, and a retry finishes the job. Pure: the function
 * wires the database, Plaid and RevenueCat in.
 */
export type AccountOps = {
  herdSize(userId: string): Promise<number>;
  leaveHerd(userId: string): Promise<void>;
  liveItems(userId: string): Promise<{ id: string; status: string }[]>;
  disconnect(item: { id: string; status: string }): Promise<DisconnectResult>;
  herdOf(userId: string): Promise<string | null>;
  deleteHerd(herdId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  forgetPurchaser(userId: string): Promise<void>;
};

export async function deleteAccount(ops: AccountOps, userId: string): Promise<'deleted' | 'plaid_failed' | 'busy'> {
  // A shared herd keeps its config; leaving takes the user's banks and rows with them.
  if ((await ops.herdSize(userId)) > 1) await ops.leaveHerd(userId);
  for (const item of await ops.liveItems(userId)) {
    const result = await ops.disconnect(item);
    if (result !== 'ok') return result;
  }
  // Now alone: the herd and everything in it go, then the user (profile,
  // subscription and consents cascade; the consents trigger forgets crowd labels).
  const herd = await ops.herdOf(userId);
  if (herd) await ops.deleteHerd(herd);
  await ops.deleteUser(userId);
  await ops.forgetPurchaser(userId).catch((err) => console.warn('RevenueCat forget failed', err));
  return 'deleted';
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `npx -y deno test --allow-env supabase/functions/_shared/account.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Add `forgetRevenueCatUser`** (append to `revenuecat.ts`)

```ts
/** Delete the RevenueCat customer (privacy). It does not cancel a store subscription. */
export async function forgetRevenueCatUser(secretKey: string, appUserId: string): Promise<void> {
  if (!secretKey) return;
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`RevenueCat ${res.status}`);
}
```

- [ ] **Step 6: Write the function**

`supabase/functions/delete-account/index.ts`:

```ts
import { deleteAccount } from '../_shared/account.ts';
import { disconnectItem } from '../_shared/connections.ts';
import { corsHeaders, getAdminClient, getAuthedUser, getPlaidClient, jsonResponse } from '../_shared/lib.ts';
import { forgetRevenueCatUser } from '../_shared/revenuecat.ts';

/**
 * Delete the caller's account (Phase 14d). Banks go at Plaid first; any
 * failure there stops everything, and calling again finishes the job.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  const plaid = getPlaidClient();

  const herdOf = async (id: string) => {
    const { data, error } = await admin.from('herd_members').select('herd_id').eq('user_id', id).maybeSingle();
    if (error) throw error;
    return (data?.herd_id as string | undefined) ?? null;
  };

  try {
    const result = await deleteAccount({
      herdOf,
      herdSize: async (id) => {
        const herd = await herdOf(id);
        if (!herd) return 0;
        const { count, error } = await admin
          .from('herd_members').select('user_id', { count: 'exact', head: true }).eq('herd_id', herd);
        if (error) throw error;
        return count ?? 0;
      },
      leaveHerd: async (id) => {
        const { error } = await admin.rpc('leave_herd', { p_user: id });
        if (error) throw error;
      },
      liveItems: async (id) => {
        const { data, error } = await admin
          .from('plaid_items').select('id, status').eq('user_id', id).neq('status', 'archived');
        if (error) throw error;
        return data ?? [];
      },
      disconnect: (item) => disconnectItem(admin, plaid, item, 'delete'),
      deleteHerd: async (herd) => {
        const { error } = await admin.from('herds').delete().eq('id', herd);
        if (error) throw error;
      },
      deleteUser: async (id) => {
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) throw error;
      },
      forgetPurchaser: (id) => forgetRevenueCatUser(Deno.env.get('REVENUECAT_SECRET_KEY') ?? '', id),
    }, user.id);

    if (result === 'plaid_failed') return jsonResponse({ error: 'plaid_failed' }, 502);
    if (result === 'busy') return jsonResponse({ error: 'busy' }, 409);
    console.log(`delete-account: deleted ${user.id}`);
    return jsonResponse({ deleted: true });
  } catch (err) {
    console.error(`delete-account failed for ${user.id}`, err);
    return jsonResponse({ error: 'delete_failed' }, 500);
  }
});
```

- [ ] **Step 7: Type-check and run every test**

Run: `npx -y deno check supabase/functions/delete-account/index.ts && npx -y deno test --allow-env supabase/functions/_shared/`
Expected: no type errors; all pass.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/account.ts supabase/functions/_shared/account.test.ts supabase/functions/delete-account supabase/functions/_shared/revenuecat.ts
git commit -m "feat(account): delete-account removes every bank at Plaid before anything else (Phase 14d)"
```

---

### Task 3: What the paywall and deletion say (pure)

**Files:**
- Modify: `apps/mobile/src/lib/paywall.ts`
- Modify: `apps/mobile/src/lib/paywall.test.ts`

**Interfaces:**
- Consumes: `PlanDetail`, `ownPaidPlan`, `PLAN_NAMES`, `PaidPlan` (14c).
- Produces:
  ```ts
  export type Period = 'monthly' | 'yearly';
  export function storeName(store: string | null): 'Play Store' | 'App Store';
  export function periodOf(productId: string): Period | null;
  export function activePeriod(active: string[], plan: string): Period | null;
  export function productChange(active: string[], target: string, period: Period): { oldProductIdentifier: string; upgrade: boolean } | null; // signature changes
  export function tierAction(i: { tier: PaidPlan; period: Period; own: string | null; ownPeriod: Period | null; planKnown: boolean; hasPackage: boolean }): { title: string; disabled: boolean };
  export function afterPurchase(i: { outcome: 'bought' | 'deferred'; confirmed: boolean; name: string }): { title: string; body: string } | null;
  export function deleteWarning(p: PlanDetail, now: Date): string | null;
  ```
  `planSummary`'s grace text now names `storeName(p.store)`.

- [ ] **Step 1: Write the failing tests**

In `paywall.test.ts`, replace the existing `productChange` test with the one below, add the new names to the import, and append the rest:

```ts
test('buying over an active Play plan: rank decides, and monthly to yearly is an upgrade', () => {
  assert.deepEqual(productChange(['tusklet:monthly'], 'tusk', 'monthly'), { oldProductIdentifier: 'tusklet', upgrade: true });
  assert.deepEqual(productChange(['tusk_herd:yearly'], 'tusk', 'yearly'), { oldProductIdentifier: 'tusk_herd', upgrade: false });
  assert.deepEqual(productChange(['tusk:monthly'], 'tusk', 'yearly'), { oldProductIdentifier: 'tusk', upgrade: true });
  assert.deepEqual(productChange(['tusk:yearly'], 'tusk', 'monthly'), { oldProductIdentifier: 'tusk', upgrade: false });
  assert.equal(productChange(['tusk:monthly'], 'tusk', 'monthly'), null);
  assert.equal(productChange([], 'tusk', 'monthly'), null);
  assert.equal(productChange(['something_else'], 'tusk', 'monthly'), null);
});

test('store names', () => {
  assert.equal(storeName('app_store'), 'App Store');
  assert.equal(storeName('play'), 'Play Store');
  assert.equal(storeName(null), 'Play Store');
  assert.equal(
    planSummary(detail({ status: 'grace', store: 'app_store' }), NOW, null).detail,
    "Your payment didn't go through. Update it in the App Store to keep your banks.",
  );
});

test('the period of a product, from Play, App Store and Test Store ids', () => {
  assert.equal(periodOf('tusk:yearly'), 'yearly');
  assert.equal(periodOf('tusk_herd_monthly'), 'monthly');
  assert.equal(periodOf('tusk'), null);
  assert.equal(activePeriod(['tusklet:monthly', 'tusk_herd_yearly'], 'tusk_herd'), 'yearly');
  assert.equal(activePeriod(['tusklet:monthly'], 'tusk'), null);
});

test('tier buttons: current, switch period, choose, and wait for the plan', () => {
  const base = { tier: 'tusk' as const, period: 'monthly' as const, own: 'tusk', ownPeriod: 'monthly' as const, planKnown: true, hasPackage: true };
  assert.deepEqual(tierAction(base), { title: 'Your plan', disabled: true });
  assert.deepEqual(tierAction({ ...base, period: 'yearly' }), { title: 'Switch to yearly', disabled: false });
  assert.deepEqual(tierAction({ ...base, own: 'tusklet' }), { title: 'Choose Tusk', disabled: false });
  assert.deepEqual(tierAction({ ...base, own: null, planKnown: false }), { title: 'Choose Tusk', disabled: true });
  assert.deepEqual(tierAction({ ...base, own: null, hasPackage: false }), { title: 'Choose Tusk', disabled: true });
});

test('after a purchase: confirmed says nothing, unconfirmed and deferred explain', () => {
  assert.equal(afterPurchase({ outcome: 'bought', confirmed: true, name: 'Tusk' }), null);
  assert.deepEqual(afterPurchase({ outcome: 'bought', confirmed: false, name: 'Tusk' }), {
    title: 'Purchase received',
    body: 'Your plan updates within a minute. You can keep using Tusky meanwhile.',
  });
  assert.deepEqual(afterPurchase({ outcome: 'deferred', confirmed: true, name: 'Tusklet' }), {
    title: 'Your plan changes at renewal',
    body: 'You move to Tusklet when your current period ends. Until then, nothing changes.',
  });
});

test('deleting an account warns a store subscriber, and nobody else', () => {
  assert.equal(
    deleteWarning(detail({ store: 'play', own_plan: 'tusk' }), NOW),
    'You pay for Tusk through the Play Store. Deleting your Tusky account does not cancel it: cancel it in the store first, or you keep being charged.',
  );
  assert.equal(deleteWarning(detail({ store: 'comp' }), NOW), null);
  assert.equal(deleteWarning(detail({ store: 'trial', own_plan: 'trial' }), NOW), null);
  assert.equal(deleteWarning(detail({ store: 'test' }), NOW), null);
});
```

- [ ] **Step 2: Run them to see them fail**

Run (inside `apps/mobile`): `npm test`
Expected: FAIL, the new names are not exported.

- [ ] **Step 3: Implement** in `lib/paywall.ts`

Replace `productChange` and add the rest:

```ts
export type Period = 'monthly' | 'yearly';

export function storeName(store: string | null): 'Play Store' | 'App Store' {
  return store === 'app_store' ? 'App Store' : 'Play Store';
}

/** `tusk:yearly` (Play) or `tusk_yearly` (App Store, Test Store). */
export function periodOf(productId: string): Period | null {
  const p = productId.includes(':') ? productId.split(':')[1] : productId.match(/_(monthly|yearly)$/)?.[1];
  return p === 'monthly' || p === 'yearly' ? p : null;
}

const baseOf = (productId: string) => productId.split(':')[0].replace(/_(monthly|yearly)$/, '');

/** The period of my running subscription to `plan`, from RevenueCat's active product ids. */
export function activePeriod(active: string[], plan: string): Period | null {
  const id = active.find((a) => baseOf(a) === plan);
  return id ? periodOf(id) : null;
}

/**
 * Play replaces a running subscription instead of adding a second one. A
 * higher plan, or monthly to yearly, applies now; anything else at renewal.
 */
export function productChange(
  active: string[],
  target: string,
  period: Period,
): { oldProductIdentifier: string; upgrade: boolean } | null {
  const id = active.find((a) => (ORDER as string[]).includes(baseOf(a)));
  if (!id) return null;
  const old = baseOf(id) as PaidPlan;
  const oldPeriod = periodOf(id);
  if (old === target && oldPeriod === period) return null;
  const rank = ORDER.indexOf(target as PaidPlan) - ORDER.indexOf(old);
  return { oldProductIdentifier: old, upgrade: rank > 0 || (rank === 0 && period === 'yearly') };
}

export function tierAction(i: {
  tier: PaidPlan;
  period: Period;
  own: string | null;
  ownPeriod: Period | null;
  planKnown: boolean;
  hasPackage: boolean;
}): { title: string; disabled: boolean } {
  if (i.own === i.tier && (i.ownPeriod === null || i.ownPeriod === i.period)) return { title: 'Your plan', disabled: true };
  if (i.own === i.tier) return { title: `Switch to ${i.period}`, disabled: !i.hasPackage };
  return { title: `Choose ${PLAN_NAMES[i.tier]}`, disabled: !i.planKnown || !i.hasPackage };
}

export function afterPurchase(i: {
  outcome: 'bought' | 'deferred';
  confirmed: boolean;
  name: string;
}): { title: string; body: string } | null {
  if (i.outcome === 'deferred') {
    return {
      title: 'Your plan changes at renewal',
      body: `You move to ${i.name} when your current period ends. Until then, nothing changes.`,
    };
  }
  if (!i.confirmed) {
    return { title: 'Purchase received', body: 'Your plan updates within a minute. You can keep using Tusky meanwhile.' };
  }
  return null;
}

/** A store subscription outlives the Tusky account. Test Store purchases are not real money. */
export function deleteWarning(p: PlanDetail, now: Date): string | null {
  const own = ownPaidPlan(p, now);
  if (!own || (p.store !== 'play' && p.store !== 'app_store')) return null;
  return `You pay for ${PLAN_NAMES[own]} through the ${storeName(p.store)}. Deleting your Tusky account does not cancel it: cancel it in the store first, or you keep being charged.`;
}
```

In `planSummary`, change the grace line to:

```ts
    return { title, detail: `Your payment didn't go through. Update it in the ${storeName(p.store)} to keep your banks.` };
```

- [ ] **Step 4: Run the tests to see them pass**

Run (inside `apps/mobile`): `npm test`
Expected: all pass. `npm run typecheck` then fails in `lib/purchases.ts` (the `productChange` call); Task 4 fixes it. Leave it failing only between these two tasks.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/paywall.ts apps/mobile/src/lib/paywall.test.ts
git commit -m "feat(app): period switches, purchase outcomes and store names, worded (Phase 14d)"
```

---

### Task 4: The paywall's polish

**Files:**
- Modify: `apps/mobile/src/lib/purchases.ts`
- Modify: `apps/mobile/src/app/paywall.tsx`
- Create: `apps/mobile/src/constants/legal.ts`
- Modify: `apps/mobile/.env.example`

**Interfaces:**
- Consumes: everything Task 3 produces; `plan-refresh`'s `429` (Task 1).
- Produces:
  ```ts
  // purchases.ts
  export function useActiveProducts(): UseQueryResult<string[]>;   // key ['purchases', 'active']
  export function useBuy(): UseMutationResult<{ outcome: 'bought' | 'deferred' | 'cancelled'; confirmed: boolean }, Error, { pkg: PurchasesPackage; plan: PaidPlan; period: Period }>;
  // constants/legal.ts
  export const PRIVACY_URL: string; export const TERMS_URL: string;
  ```

- [ ] **Step 1: `purchases.ts`**

Replace `refreshPlan`, `useBuy` and `useRestore` with the following. Add `import type { Period } from '@/lib/paywall';` beside the existing paywall import.

```ts
/**
 * Ask the server to re-read RevenueCat, then refetch the plan. Unconfirmed
 * (a failed call, the cooldown, or a webhook still on its way): refetch twice
 * more, so the plan appears without a reload.
 */
async function refreshPlan(queryClient: ReturnType<typeof useQueryClient>): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('plan-refresh');
  const confirmed = !error && (data?.result === 'written' || data?.result === 'unchanged');
  await queryClient.invalidateQueries({ queryKey: ['plan'] });
  void queryClient.invalidateQueries({ queryKey: ['purchases', 'active'] });
  if (!confirmed) {
    for (const ms of [15_000, 60_000]) setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['plan'] }), ms);
  }
  return confirmed;
}

/** My running store products (`tusk:monthly` …), for the paywall's period switch. Display only. */
export function useActiveProducts() {
  return useQuery({
    queryKey: ['purchases', 'active'],
    enabled: purchasesEnabled,
    queryFn: async (): Promise<string[]> => {
      await identified;
      return (await Purchases.getCustomerInfo()).activeSubscriptions;
    },
  });
}

export function useBuy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      pkg,
      plan,
      period,
    }: {
      pkg: PurchasesPackage;
      plan: PaidPlan;
      period: Period;
    }): Promise<{ outcome: 'bought' | 'deferred' | 'cancelled'; confirmed: boolean }> => {
      await readyToBuy();
      // Play replaces a running plan; Test Store keys (test_…) have no Play subscription to replace.
      const change = apiKey.startsWith('test_')
        ? null
        : productChange((await Purchases.getCustomerInfo()).activeSubscriptions, plan, period);
      try {
        await Purchases.purchasePackage(
          pkg,
          null,
          change && {
            oldProductIdentifier: change.oldProductIdentifier,
            replacementMode: change.upgrade ? STORE_REPLACEMENT_MODE.WITH_TIME_PRORATION : STORE_REPLACEMENT_MODE.DEFERRED,
          },
        );
      } catch (err) {
        if ((err as { code?: string }).code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) {
          return { outcome: 'cancelled', confirmed: true };
        }
        throw err;
      }
      const confirmed = await refreshPlan(queryClient);
      return { outcome: change && !change.upgrade ? 'deferred' : 'bought', confirmed };
    },
  });
}

export function useRestore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await readyToBuy();
      await Purchases.restorePurchases();
      await refreshPlan(queryClient);
    },
  });
}
```

- [ ] **Step 2: `constants/legal.ts` and `.env.example`**

```ts
// Store rules want these beside every purchase (Phase 14d). `||` not `??`:
// unset EXPO_PUBLIC_ vars arrive as ''. Apple's standard EULA serves as the
// terms until Tusky has its own.
export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL || '';
export const TERMS_URL =
  process.env.EXPO_PUBLIC_TERMS_URL || 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
```

Append to `apps/mobile/.env.example`:

```sh
# Legal pages shown on the paywall (Phase 14d). The privacy policy is required by
# both stores; the terms default to Apple's standard EULA when empty.
EXPO_PUBLIC_PRIVACY_URL=
EXPO_PUBLIC_TERMS_URL=
```

- [ ] **Step 3: `paywall.tsx`**

These are the changes, in order. Keep the rest of the file as it is.

1. Imports: add `Linking, Platform, Pressable` to the `react-native` import. Add `activePeriod, afterPurchase, PLAN_NAMES, storeName, tierAction` and `type Period` to the `@/lib/paywall` import, and delete the local `type Period` declaration. Add `useActiveProducts` to the `@/lib/purchases` import, and `import { PRIVACY_URL, TERMS_URL } from '@/constants/legal';`.

2. Hooks: change `const { data: packages = [], isLoading, error } = useOfferings();` to `const { data: packages = [], isLoading, error, refetch } = useOfferings();`, and add `const { data: active = [] } = useActiveProducts();`.

3. Replace the single early return with three:

```tsx
  if (!purchasesEnabled) return <Notice title="Plans are coming soon" body="Everything you have tracked stays here in the meantime." />;
  if (error) {
    return (
      <Notice title="Couldn't load plans" body="Check your connection and try again.">
        <Button title="Try again" variant="secondary" onPress={() => void refetch()} />
      </Notice>
    );
  }
  if (isLoading) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (tiers.length === 0) return <Notice title="Plans are coming soon" body="Everything you have tracked stays here in the meantime." />;
```

   Add this component at the bottom of the file, with `import type { ReactNode } from 'react';` at the top:

```tsx
function Notice({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  const colors = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: Spacing.md }}>
      <Card style={{ gap: Spacing.sm }}>
        <AppText variant="section">{title}</AppText>
        <AppText tone="dim">{body}</AppText>
        {children}
      </Card>
    </View>
  );
}
```

4. In the covered card, replace `'You also pay for a plan yourself; you can cancel it in the Play Store.'` with `` `You also pay for a plan yourself; you can cancel it in the ${storeName(plan.store)}.` ``.

5. In the tier loop, delete the `const pkg = tier[period] ?? tier.monthly ?? tier.yearly;` and `const current = …` lines. A tier now buys only the selected period. Put this in their place:

```tsx
        const action = tierAction({
          tier: tier.plan,
          period,
          own,
          ownPeriod: own ? activePeriod(active, own) : null,
          planKnown: !!plan,
          hasPackage: !!tier[period],
        });
        const pkg = tier[period];
```

```tsx
            <Button
              title={action.title}
              disabled={action.disabled || buy.isPending}
              loading={buy.isPending && buy.variables?.plan === tier.plan}
              onPress={() =>
                pkg &&
                buy.mutate(
                  { pkg, plan: tier.plan, period },
                  {
                    onSuccess: ({ outcome, confirmed }) => {
                      if (outcome === 'cancelled') return;
                      const msg = afterPurchase({ outcome, confirmed, name: PLAN_NAMES[tier.plan] });
                      if (msg) Alert.alert(msg.title, msg.body);
                      router.back();
                    },
                    onError: failed('Could not complete the purchase'),
                  },
                )
              }
            />
```

   Replace the price line's `pkg` guard: show `{pkg ? … : <AppText variant="caption" tone="dim">Not sold {period}</AppText>}`.

6. Replace the closing caption with:

```tsx
      <AppText variant="caption" tone="dim">
        Subscriptions renew until you cancel them in the {storeName(Platform.OS === 'ios' ? 'app_store' : 'play')}.
      </AppText>
      <View style={{ flexDirection: 'row', gap: Spacing.md }}>
        {PRIVACY_URL ? (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(PRIVACY_URL)}>
            <AppText variant="caption" tone="brand">Privacy policy</AppText>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(TERMS_URL)}>
          <AppText variant="caption" tone="brand">Terms of use</AppText>
        </Pressable>
      </View>
```

- [ ] **Step 4: Typecheck, lint, test**

Run (inside `apps/mobile`): `npm run typecheck && npx expo lint && npm test`
Expected: clean; all pass.

- [ ] **Step 5: Check it on the emulator with the Test Store key**

With `EXPO_PUBLIC_REVENUECAT_KEY` set (14c Task 7), restart Metro and put the test user on a trial by SQL (as in 14c Task 7 Step 4). Then:
- Buy Tusk monthly. Expected: no alert. The paywall closes, and the Plan screen reads "Tusk".
- Reopen the paywall, choose Yearly, and look at Tusk's button. Expected: "Switch to yearly". (Test Store has no product change, so tapping it buys a second Test Store subscription. Only the label is checked here; Play is checked in Task 7.)
- Within 10 seconds, restore. Expected: no error. `plan-refresh` answered 429 in the function log, and the plan still shows after the 15-second refetch.
- Turn on airplane mode, open the paywall with its query cache cleared (relaunch), and check it shows "Couldn't load plans" with Try again.

Put the test user back as in 14c Task 7 Step 8.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/purchases.ts apps/mobile/src/app/paywall.tsx apps/mobile/src/constants/legal.ts apps/mobile/.env.example
git commit -m "feat(app): the paywall switches periods, explains outcomes, and links the legal pages (Phase 14d)"
```

---

### Task 4b: Legal pages on GitHub Pages (D5)

**Files:**
- Create: `site/index.html`, `site/privacy.html`, `site/delete-account.html`, `site/style.css`
- Create: `.github/workflows/pages.yml` (deploys `site/` only, on pushes to `master` that touch it)
- Modify: `apps/mobile/src/constants/legal.ts` (add `DELETE_URL`, and default `PRIVACY_URL` to the Pages URL)
- Modify: `apps/mobile/src/app/(tabs)/settings.tsx` (a Legal card: Privacy policy, Terms of use, Delete account help)

- [ ] **Step 1: The pages.** Plain static HTML with no build step and no trackers.
  - **Privacy:** what Tusky stores, based on the schema: account email; bank data through Plaid; categories, notes and splits; subscription status through RevenueCat and the stores. Also cover:
    - who processes it: Supabase, Plaid, RevenueCat, Google and Apple, and TypeSafe AI for merchant text only, when AI categorizing is on;
    - crowd labels: opt-in, anonymous, and withdrawn with the consent;
    - retention and deletion;
    - a contact email.
  - **Delete account:** how to delete in the app (Settings → Delete account), what gets deleted, what a shared herd keeps, and the email to write to if you can't sign in.
  - The contact address is Pedro's to choose. Ask before publishing; until then, use `ph.leao2099+tusky@gmail.com`.
- [ ] **Step 2: The workflow.** `actions/upload-pages-artifact` over `site/`, then `actions/deploy-pages`. **Pedro (repo admin)** sets Settings → Pages → Source to **GitHub Actions** once. The URL is then `https://kelvinluciano312.github.io/Tusky-App/`.
- [ ] **Step 3: The app.** `PRIVACY_URL` defaults to `<pages>/privacy.html` and `DELETE_URL` to `<pages>/delete-account.html`, both still overridable by env. Settings gets a Legal card with three links, below the Account card.
- [ ] **Step 4:** Typecheck, lint, test. Check the three links on the emulator (`emu.mjs ui`). The pages 404 until the workflow runs on master, which is expected before the merge.
- [ ] **Step 5: Commit** `feat: privacy and account-deletion pages on GitHub Pages, linked from Settings (Phase 14d)`

---

### Task 5: Delete account in the app

**Files:**
- Modify: `apps/mobile/src/lib/queries.ts` (add `useDeleteAccount`)
- Modify: `apps/mobile/src/app/(tabs)/settings.tsx` (the Account card)

**Interfaces:**
- Consumes: `delete-account` (Task 2); `deleteWarning` (Task 3); `manageSubscriptionsUrl` (14c); `readFunctionError` (`lib/functions.ts`).
- Produces: `useDeleteAccount(): UseMutationResult<void, Error, void>`.

- [ ] **Step 1: The mutation** (append to `lib/queries.ts`)

```ts
/**
 * Delete my account (Phase 14d). The server removes every bank at Plaid first;
 * if one fails, nothing is deleted and trying again finishes the job.
 */
export function useDeleteAccount() {
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke('delete-account');
      if (!error) return;
      const { message } = await readFunctionError(error);
      if (message === 'plaid_failed') {
        throw new Error('A bank could not be disconnected at Plaid, so nothing was deleted. Try again in a few minutes.');
      }
      if (message === 'busy') throw new Error('A bank is syncing right now. Try again in a minute.');
      throw new Error('Your account could not be deleted. Try again in a moment.');
    },
  });
}
```

- [ ] **Step 2: The Account card** (`settings.tsx`)

Imports: add `Linking` to the `react-native` import, `deleteWarning` to the `@/lib/paywall` import, `useDeleteAccount` to the `@/lib/queries` import, and `import { manageSubscriptionsUrl } from '@/lib/purchases';`. Beside the other hooks, add `const deleteAccount = useDeleteAccount();`. After the Sign out button, add:

```tsx
        <Button
          title="Delete account"
          variant="ghost"
          loading={deleteAccount.isPending}
          onPress={() => {
            const confirm = () =>
              Alert.alert(
                'Delete your account?',
                'Tusky disconnects your banks and deletes everything you have tracked. If you share a herd, it keeps what belongs to the herd. This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () =>
                      deleteAccount.mutate(undefined, {
                        onSuccess: async () => {
                          await supabase.auth.signOut();
                          queryClient.clear();
                        },
                        onError: (err) => Alert.alert('Could not delete your account', err.message),
                      }),
                  },
                ],
              );
            const warning = plan ? deleteWarning(plan, new Date()) : null;
            if (!warning) return confirm();
            Alert.alert('Cancel your subscription first', warning, [
              { text: 'Not now', style: 'cancel' },
              { text: 'Manage subscription', onPress: async () => Linking.openURL(await manageSubscriptionsUrl()) },
              { text: 'Delete anyway', style: 'destructive', onPress: confirm },
            ]);
          }}
        />
```

- [ ] **Step 3: Typecheck, lint, test**

Run (inside `apps/mobile`): `npm run typecheck && npx expo lint && npm test`
Expected: clean; all pass.

- [ ] **Step 4: Deploy to dev and delete a throwaway account for real**

```bash
npx supabase db push
npx supabase functions deploy delete-account --use-api
npx supabase functions deploy plan-refresh --use-api
```

1. Create a throwaway user on dev (`ph.leao2099+tuskydelete@gmail.com`) through sign-up on the emulator. Confirm it by SQL: `update auth.users set email_confirmed_at = now() where email = 'ph.leao2099+tuskydelete@gmail.com';`.
2. Connect First Platypus with `user_good` / `pass_good`.
3. Note the Item id, then delete the account from Settings.

Expected:
- The app returns to sign-in.
- `select count(*) from auth.users where email = 'ph.leao2099+tuskydelete@gmail.com'` is 0.
- `select count(*) from plaid_items where id = '<item id>'` is 0.
- The `delete-account` log shows no error.
- The `plaid-webhook` log shows no later activity for that Item.

Then run the herd case (**Review Focus 1**):
1. Create a second throwaway user and invite it into a fresh herd with the first throwaway, not with the test users.
2. Record one settlement between them.
3. Delete the joiner.
4. As the remaining throwaway, open Settle up.

Record what the balance shows in the handoff. It is data for Pedro, not a pass or fail.

Run `node scripts/rls-check.mjs`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/queries.ts "apps/mobile/src/app/(tabs)/settings.tsx"
git commit -m "feat(app): delete your account from Settings, warned about a running store subscription (Phase 14d)"
```

---

### Task 6: Release builds through EAS

This task needs Pedro for the logins (Steps 1 and 5).

**Files:**
- Create: `apps/mobile/eas.json`
- Modify: `apps/mobile/app.json` (EAS project id, added by `eas init`)
- Create: `docs/ops/release.md`

- [ ] **Step 1: Pedro logs in to Expo** (in his own terminal: `cd apps/mobile`, then `npx eas-cli login`; interactive)

- [ ] **Step 2: Link the project**

Run (inside `apps/mobile`): `npx eas-cli init --non-interactive --force`
Expected: `app.json` gains `extra.eas.projectId` and `owner`.

- [ ] **Step 3: `eas.json`**

```json
{
  "cli": { "version": ">= 16.0.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "environment": "development"
    },
    "playtest": {
      "environment": "preview",
      "autoIncrement": true,
      "android": { "buildType": "app-bundle" }
    },
    "production": {
      "environment": "production",
      "autoIncrement": true,
      "android": { "buildType": "app-bundle" }
    }
  },
  "submit": {
    "playtest": { "android": { "track": "internal", "releaseStatus": "draft" } },
    "production": { "android": { "track": "internal", "releaseStatus": "draft" } }
  }
}
```

- [ ] **Step 4: EAS environment variables** (the `.env` file is gitignored, so EAS never sees it)

`preview` gets the dev project only. With no `EXPO_PUBLIC_PROD_*`, `pickBackend` chooses sandbox. Run each command with the value copied from `apps/mobile/.env`, and the RevenueCat **Play** key (`goog_…`) for the last:

```bash
npx eas-cli env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value <dev url> --visibility plaintext
npx eas-cli env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <dev publishable key> --visibility plaintext
npx eas-cli env:create --environment preview --name EXPO_PUBLIC_REVENUECAT_KEY --value <goog_ key> --visibility plaintext
```

`production` gets all four Supabase variables (dev and prod) and `EXPO_PUBLIC_PRIVACY_URL`. Its RevenueCat keys stay unset until launch. `development` needs nothing: dev builds use the local `.env` through Metro.

- [ ] **Step 5: The first Play build and upload** (Pedro)

0. **The rename (D6).** Only after Kelvyn has added `com.ouroborosstudios.tusky` to Plaid's allowed Android package names. Change `android.package` and `ios.bundleIdentifier` in `app.json`, and the Play fallback URL in `lib/purchases.ts` (and the test for it, if there is one). Update the docs that name the package: `CLAUDE.md`, `README.md`, `docs/ops/production.md`. Then rebuild the dev client on the emulator and the phone. It installs as a new app, so sign in again; the old `com.tusky.app` can be uninstalled. Check that Plaid Link still opens on the emulator.
1. The Play Console app already exists (`com.ouroborosstudios.tusky`, draft).
2. Run: `npx eas-cli build --platform android --profile playtest` (interactive the first time: answer **Yes** to "Generate a new Android Keystore?", so EAS keeps the upload key).
3. Pedro downloads the `.aab` from the build page and uploads it by hand to **Internal testing** (Google requires the first upload by hand), then adds himself and Kelvyn as testers.
4. Later uploads: `npx eas-cli submit --platform android --profile playtest`, once Pedro has put a Play service-account key in EAS (`eas credentials`).

- [ ] **Step 6: `docs/ops/release.md`**

Write the steps above as the how-to:
- the three profiles and which backend each talks to;
- the env vars per EAS environment;
- the first manual upload, then `eas submit`;
- `autoIncrement` owning `versionCode`;
- the reminder that a `playtest` build on the internal track **replaces** a `production` build there for everyone on the track.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/eas.json apps/mobile/app.json docs/ops/release.md
git commit -m "chore(build): EAS release builds, and a Play test build that talks to dev (Phase 14d)"
```

---

### Task 7: Play products, and a live Play Billing run

Pedro does Steps 1 and 2. The purchases run on his phone, installed from the internal track.

- [ ] **Step 1: The Play Console** (Pedro)
- Monetize → Subscriptions: create `tusklet`, `tusk` and `tusk_herd`. Give each two auto-renewing base plans, `monthly` and `yearly`, at the spec's prices.
- Turn on a grace period (7 days) and account hold.
- Setup → License testing: add Pedro's and Kelvyn's Google accounts.

- [ ] **Step 2: RevenueCat** (Pedro)
- Add a Play Store app (`com.ouroborosstudios.tusky`) with a Google Cloud service account that has the Play permissions RevenueCat lists, and set up Real-time developer notifications (RevenueCat's Pub/Sub guide).
- Import the six Play products. Attach each to its entitlement and to the matching package in `default` (e.g. `tusk_monthly` gets `tusk:monthly`).
- Edit the dev webhook: environment **Sandbox**, all apps.
- Copy the Play public key (`goog_…`) into the `preview` EAS env (Task 6 Step 4). Rebuild and upload `playtest`.

- [ ] **Step 3: The live run** (license-tester renewals: monthly every 5 minutes, yearly every 30)

For each step, check the test user's `subscriptions` row by SQL and the `revenuecat-webhook` log. First put the test user on a trial by SQL, as in 14c Task 7.

| Action | Expected |
| --- | --- |
| Buy Tusklet monthly | `tusklet, play, active`, expiry about 5 min out; Plan screen "Tusklet" with no reload |
| Wait 6 minutes | renewed: `expires_at` moved forward |
| Buy Tusk monthly (upgrade) | `tusk, play, active` at once |
| Tusk: tap "Switch to yearly" | stays Tusk; the active product becomes `tusk:yearly` (**Review Focus 3**) |
| Buy Tusklet (downgrade) | "Your plan changes at renewal" alert; the row stays `tusk` until renewal, then `tusklet` |
| Play Store → cancel | at the next renewal time, `expired`; Plan screen "Free" |
| Buy again with the "declined" test card | `grace`; Plan screen shows the payment message naming the Play Store |
| Sign in as Kel Test, Restore purchases | Kel's row gains the plan, and the test user's row reads `expired` |
| Delete account (Kel Test, while subscribed) | the "Cancel your subscription first" alert appears first. Choose **Not now**; don't delete Kel |

Then put both test users back to `tusk, comp, active, null` and run `node scripts/rls-check.mjs`.

---

### Task 8: 14d-1 docs, handoff, PR

**Files:**
- Modify: `CLAUDE.md`
  - Purchases (14c) bullet: the cooldown and the period switch.
  - A new **Deleting an account (14d)** bullet: the order, Plaid first, and "never cascade a Plaid Item away without `/item/remove`".
  - Remove the stale "14c is on `pedro-14c`" line.
- Modify: `docs/ops/production.md`: the launch checklist below.
- Create: `docs/superpowers/plans/2026-09-29-phase-14d-1-handoff.md`

- [ ] **Step 1: The production launch checklist** in `docs/ops/production.md`, under RevenueCat. Each item waits for Pedro's go-ahead:
  1. Push the migrations.
  2. Deploy `revenuecat-webhook`, `plan-refresh` and `delete-account`.
  3. Set the two RevenueCat secrets.
  4. Create the production webhook (environment **Production**).
  5. Set `EXPO_PUBLIC_PROD_REVENUECAT_KEY` in the `production` EAS environment.
  6. Build `production` and promote it from Internal testing.
- [ ] **Step 2: The handoff**
  - What shipped.
  - What Task 5 recorded for Review Focus 1.
  - Task 7's table with real results.
  - The Review Focus items still open.
- [ ] **Step 3: Final checks**
  - Repo root: `npx -y deno test --allow-env supabase/functions/_shared/`
  - Inside `apps/mobile`: `npm run typecheck && npx expo lint && npm test`

  Expected: all pass. Quote the counts in the handoff.
- [ ] **Step 4: Commit, push, PR** (never merge)

```bash
git add CLAUDE.md docs/ops/production.md docs/superpowers/plans/2026-09-29-phase-14d-1-handoff.md
git commit -m "docs: Phase 14d-1 handoff"
git push -u origin pedro-14d
gh pr create --base master --title "Phase 14d-1: Android launch readiness" --body-file docs/superpowers/plans/2026-09-29-phase-14d-1-handoff.md
```

---

# 14d-2 — iOS

Starts after 14d-1 merges, on `pedro-14d-ios` from master, and only once D4 is answered: an Apple Developer account and an iPhone.

### Task 9: The app on iOS

**Files:**
- Modify: `apps/mobile/src/lib/environment.ts` and `apps/mobile/src/lib/environment.test.ts` (add `pickRevenueCatKey`)
- Modify: `apps/mobile/src/lib/purchases.ts`
- Modify: `apps/mobile/src/lib/paywall.ts` and `apps/mobile/src/lib/paywall.test.ts` (add `canManage`)
- Modify: `apps/mobile/src/app/plan.tsx`
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/.env.example`

**Interfaces:**
- Produces:
  ```ts
  // environment.ts
  export function pickRevenueCatKey(i: { backend: Backend; platform: 'ios' | 'android' | string; keys: { android: string; ios: string; prodAndroid: string; prodIos: string } }): string;
  // paywall.ts
  export function canManage(p: PlanDetail, now: Date): boolean;   // ownPaidPlan and store is play or app_store
  export function manageFallbackUrl(platform: string): string;
  ```

- [ ] **Step 1: Write the failing tests**

`environment.test.ts` (append; add `pickRevenueCatKey` to the import):

```ts
test('the RevenueCat key follows backend and platform, and an empty key means no purchases', () => {
  const keys = { android: 'goog_dev', ios: 'appl_dev', prodAndroid: '', prodIos: 'appl_prod' };
  assert.equal(pickRevenueCatKey({ backend: 'sandbox', platform: 'android', keys }), 'goog_dev');
  assert.equal(pickRevenueCatKey({ backend: 'sandbox', platform: 'ios', keys }), 'appl_dev');
  assert.equal(pickRevenueCatKey({ backend: 'real', platform: 'android', keys }), '');
  assert.equal(pickRevenueCatKey({ backend: 'real', platform: 'ios', keys }), 'appl_prod');
  assert.equal(pickRevenueCatKey({ backend: 'sandbox', platform: 'web', keys }), '');
});
```

`paywall.test.ts` (append; add `canManage, manageFallbackUrl` to the import):

```ts
test('manage is offered for store subscriptions only', () => {
  assert.equal(canManage(detail({ store: 'play' }), NOW), true);
  assert.equal(canManage(detail({ store: 'app_store' }), NOW), true);
  assert.equal(canManage(detail({ store: 'test' }), NOW), false);
  assert.equal(canManage(detail({ store: 'comp' }), NOW), false);
  assert.equal(canManage(detail({ store: 'play', status: 'expired' }), NOW), false);
});

test('manage falls back to the platform store page', () => {
  assert.equal(manageFallbackUrl('ios'), 'https://apps.apple.com/account/subscriptions');
  assert.equal(manageFallbackUrl('android'), 'https://play.google.com/store/account/subscriptions?package=com.ouroborosstudios.tusky');
});
```

Run `npm test` inside `apps/mobile`. Expected: FAIL, the names are not exported.

- [ ] **Step 2: Implement**

`environment.ts`:

```ts
/**
 * RevenueCat's public key for this launch (Phase 14d-2): one per store and per
 * backend. Empty means purchases are off, and the paywall says plans are coming soon.
 */
export function pickRevenueCatKey(i: {
  backend: Backend;
  platform: string;
  keys: { android: string; ios: string; prodAndroid: string; prodIos: string };
}): string {
  if (i.platform !== 'ios' && i.platform !== 'android') return '';
  if (i.backend === 'real') return i.platform === 'ios' ? i.keys.prodIos : i.keys.prodAndroid;
  return i.platform === 'ios' ? i.keys.ios : i.keys.android;
}
```

`paywall.ts`:

```ts
export function canManage(p: PlanDetail, now: Date): boolean {
  return !!ownPaidPlan(p, now) && (p.store === 'play' || p.store === 'app_store');
}

export function manageFallbackUrl(platform: string): string {
  return platform === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions?package=com.ouroborosstudios.tusky';
}
```

`purchases.ts`:
- Import `Platform` from `react-native`, and `pickRevenueCatKey` from `@/lib/environment`.
- Replace the `apiKey` constant with:

```ts
// `||` not `??`: unset EXPO_PUBLIC_ vars arrive as empty strings. The Test Store key
// works on both platforms, so dev may set it in both slots.
const apiKey = pickRevenueCatKey({
  backend,
  platform: Platform.OS,
  keys: {
    android: process.env.EXPO_PUBLIC_REVENUECAT_KEY || '',
    ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || '',
    prodAndroid: process.env.EXPO_PUBLIC_PROD_REVENUECAT_KEY || '',
    prodIos: process.env.EXPO_PUBLIC_PROD_REVENUECAT_IOS_KEY || '',
  },
});
```

- In `useBuy`, skip the product change on iOS, since the App Store switches plans within a subscription group itself. Use `apiKey.startsWith('test_') || Platform.OS === 'ios' ? null : productChange(…)`.
- In `manageSubscriptionsUrl`, fall back to `manageFallbackUrl(Platform.OS)`.

`plan.tsx`: show Manage subscription when `canManage(plan, new Date())`, replacing `own && plan.store === 'play'`.

`app.json`: add to `expo.ios`:

```json
      "infoPlist": { "ITSAppUsesNonExemptEncryption": false },
```

`.env.example`: add `EXPO_PUBLIC_REVENUECAT_IOS_KEY=` and `EXPO_PUBLIC_PROD_REVENUECAT_IOS_KEY=`, with one comment line: "the App Store key (appl_…); the dev Test Store key works here too".

- [ ] **Step 3: Typecheck, lint, test**

Run (inside `apps/mobile`): `npm run typecheck && npx expo lint && npm test`
Expected: clean; all pass. Android on the emulator behaves exactly as before: the paywall and Plan screen are unchanged.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/lib/environment.ts apps/mobile/src/lib/environment.test.ts apps/mobile/src/lib/purchases.ts apps/mobile/src/lib/paywall.ts apps/mobile/src/lib/paywall.test.ts apps/mobile/src/app/plan.tsx apps/mobile/app.json apps/mobile/.env.example
git commit -m "feat(app): RevenueCat keys and subscription management per platform (Phase 14d-2)"
```

---

### Task 10: App Store products, an iOS build, and a live sandbox run

Pedro does Steps 1 and 2 and holds the iPhone.

- [ ] **Step 1: Apple** (Pedro)
  - Apple Developer Program ($99/yr).
  - App Store Connect → Agreements: sign the **Paid Apps** agreement and fill in tax and banking. Sandbox purchases fail without it.
  - Create the app with bundle id `com.ouroborosstudios.tusky`.
  - Create one subscription group, "Tusky", with six auto-renewable products: `tusklet_monthly`, `tusklet_yearly`, `tusk_monthly`, `tusk_yearly`, `tusk_herd_monthly`, `tusk_herd_yearly`, at the spec's prices. Rank them in the group with Tusk Herd highest, then Tusk, then Tusklet.
  - Users and Access → Sandbox: create a sandbox Apple ID.
- [ ] **Step 2: RevenueCat** (Pedro)
  - Add an App Store app, upload the In-App Purchase key and the App Store Connect API key, and set App Store Server Notifications (V2) to RevenueCat's URL.
  - Import the six products and attach them to the same entitlements and packages.
  - Put the `appl_…` key in `apps/mobile/.env` as `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, and in the `preview` EAS environment.
- [ ] **Step 3: The iOS dev build** (no Mac: EAS)
  - Run `npx eas-cli device:create` and open the link on the iPhone to register it.
  - Run `npx eas-cli build --platform ios --profile development`. It's interactive the first time: let EAS manage certificates and profiles with Pedro's Apple login.
  - Install from the build page. Start Metro as in CLAUDE.md, over Tailscale, and open the dev client on the iPhone.
- [ ] **Step 4: Plaid on iOS**
  - Before connecting, check Plaid's current React Native iOS docs (context7, `react-native-plaid-link-sdk`) for whether OAuth needs a redirect URI or universal link on iOS. Record the answer in the handoff.
  - Connect First Platypus (`user_good` / `pass_good`), then Chase through OAuth.
  - Expected: both link. If Chase fails only because a redirect URI is missing, stop 14d-2 there, record the error, and bring it to Pedro: it needs a hosted https domain (D5).
- [ ] **Step 5: The live sandbox run** (sign in to the sandbox Apple ID when prompted; sandbox renewals are fast, a month is about 5 minutes)

| Action | Expected |
| --- | --- |
| Test user on a trial (SQL), buy Tusklet monthly | `tusklet, app_store, active`; Plan screen "Tusklet" |
| Buy Tusk yearly | `tusk, app_store, active`: Apple upgrades within the group; no product-change code runs |
| Plan screen → Manage subscription | opens the App Store's subscriptions page |
| Cancel in Settings → Apple ID → Subscriptions | after the period, `expired` |
| Restore purchases on Kel Test | Kel gains the plan; the test user's row reads `expired` |
| Delete account while subscribed (Kel) | the alert names the App Store; choose **Not now** |

Put both test users back to `tusk, comp, active, null`. Then run `node scripts/rls-check.mjs`.

---

### Task 11: 14d-2 docs, handoff, PR

- [ ] **Step 1: CLAUDE.md**
  - Under the Pedro's-phone notes, add iOS: the dev build through EAS, the device registered, and Metro over Tailscale the same way.
  - Add the Plaid iOS OAuth answer from Task 10 Step 4 to Hard-won gotchas.
- [ ] **Step 2: `docs/ops/release.md`**
  - The iOS profiles.
  - TestFlight: `npx eas-cli build -p ios --profile production`, then `npx eas-cli submit -p ios`.
  - App Review needs: account deletion (in the app), Restore purchases, privacy and terms links on the paywall, and a demo account for the reviewer on Plaid Sandbox. That means a `playtest`-style iOS build, or a reviewer note about Sandbox credentials.
- [ ] **Step 3: The handoff** `docs/superpowers/plans/2026-09-29-phase-14d-2-handoff.md`, with Task 10's table filled in with real results.
- [ ] **Step 4: Final checks**
  - Repo root: `npx -y deno test --allow-env supabase/functions/_shared/`
  - Inside `apps/mobile`: `npm run typecheck && npx expo lint && npm test`

  Expected: all pass.
- [ ] **Step 5: Commit, push, PR** (never merge)

```bash
git add CLAUDE.md docs/ops/release.md docs/superpowers/plans/2026-09-29-phase-14d-2-handoff.md
git commit -m "docs: Phase 14d-2 handoff"
git push -u origin pedro-14d-ios
gh pr create --base master --title "Phase 14d-2: iOS" --body-file docs/superpowers/plans/2026-09-29-phase-14d-2-handoff.md
```
