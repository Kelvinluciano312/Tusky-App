# Phase 14c — Purchases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user buy Tusklet, Tusk or Tusk Herd in the app through RevenueCat, with the server (never the app) turning RevenueCat's state into the `subscriptions` row that grants access, plus a Plan screen and a paywall.

**Architecture:**
- **One server path grants access.** A pure `subscriptionFromRc()` in `_shared/revenuecat.ts` maps a RevenueCat subscriber (fetched from RevenueCat's REST API, never taken from an event body) to a `subscriptions` row. `syncSubscriber()` reads the current row, maps, and writes. Two thin functions call it: `revenuecat-webhook` (public, shared-secret header, RevenueCat calls it) and `plan-refresh` (JWT, the app calls it right after a purchase or restore so the plan updates without waiting for the webhook).
- **The app** configures `react-native-purchases` with the signed-in Supabase user id, shows a paywall built from RevenueCat's offerings (prices) and our `plans` table (limits), and a Plan screen from `my_plan()` plus the user's own `subscriptions` row. Pure wording and grouping live in `lib/paywall.ts`.
- **Dev testing uses RevenueCat's Test Store**, so purchases run on the emulator with no Play Console. The server accepts Test Store purchases only where `PLAID_ENV=sandbox` (dev).

**Tech Stack:** Deno Edge Functions, RevenueCat REST API v1, `react-native-purchases`, Expo SDK 57 dev builds, Postgres.

**Spec:** `docs/superpowers/specs/2026-09-28-phase-14-monetization-design.md` (sections "Buying" and "Testing"; milestone 14c). 14a (plans, `my_plan`, `plan_for`) is merged; 14b (`sameSecret`, `usePlan`, `PlanBanner`) is on `pedro-14b`. Branch `pedro-14c` from `pedro-14b`.

## Global Constraints

- The app never decides access. It only reads `my_plan()` and the user's `subscriptions` row. Every write to `subscriptions` comes from the service role.
- The webhook trusts only the ids in the event. It re-fetches each subscriber from `GET https://api.revenuecat.com/v1/subscribers/{app_user_id}` with `REVENUECAT_SECRET_KEY` and writes from that state, so repeated and out-of-order events are harmless.
- `revenuecat-webhook` is public (`verify_jwt = false`). Its first act is `sameSecret(req.headers.get('Authorization'), Deno.env.get('REVENUECAT_WEBHOOK_SECRET'))` from `_shared/enforce.ts`; anything else gets 401. With no secret configured, nothing is accepted.
- Entitlement ids in RevenueCat: `tusklet`, `tusk`, `tusk_herd` (the same strings as `plans.id`). Package ids in the `default` offering: `tusklet_monthly`, `tusklet_yearly`, `tusk_monthly`, `tusk_yearly`, `tusk_herd_monthly`, `tusk_herd_yearly`.
- Mapping rules:
  - A billing issue maps to `grace`, an expiration to `expired`. An entitlement is live while `expires_date` or `grace_period_expires_date` is in the future (or `expires_date` is null).
  - Several live entitlements: the best-ranked wins (`tusk_herd` > `tusk` > `tusklet`).
  - Stores: `play_store` → `play`, `app_store` → `app_store`, `test_store` → `test` (only when Test Store is allowed). Any other store is ignored.
  - A `comp` row is never changed. A `trial` row is changed only by a live purchase.
  - The write sets `plan`, `store`, `status`, `expires_at` and nothing else: `over_limit_since` belongs to `plan-enforcer`.
- Answers: bad secret → 401. RevenueCat API failure → 500, so RevenueCat retries. Anything else unexpected (unknown user, anonymous id, TEST event) → logged, 200.
- The RevenueCat app user id is the Supabase user id: `Purchases.configure({ apiKey, appUserID: userId })` once, `Purchases.logIn(userId)` on later sign-ins, `Purchases.logOut()` on sign-out.
- RevenueCat public keys live in `apps/mobile/.env`: `EXPO_PUBLIC_REVENUECAT_KEY` (dev, the Test Store key) and `EXPO_PUBLIC_PROD_REVENUECAT_KEY` (production, **left empty** until Pedro and Kelvyn launch). With no key for the active backend, the paywall says plans are coming soon.
- Prices are never hardcoded: they come from the store through `pkg.product.priceString`. Limits come from the `plans` table.
- Every UI string uses `AppText`, colors and spacing come from `constants/theme.ts`, and the paywall uses our own components, not RevenueCat's prebuilt paywall.
- No secret value ever goes in the repo or the chat. Production is not touched.

## Review Focus

1. **A purchase lands before the webhook.** The user buys, returns to the Plan screen, and must see the new plan without a reload. `plan-refresh` runs the same `syncSubscriber` for the caller, then the app refetches `['plan']`. (Task 2: a `syncSubscriber` test that the caller's live purchase is written; Task 7 checks it live.)
2. **A trial user who buys and then lets it lapse** must not get their old trial back, and **a trial user whose RevenueCat record is empty** (they opened the paywall and left) must keep the trial. (Task 1: two mapper tests.)
3. **A restore moves a purchase from one Tusky account to another** (RevenueCat's TRANSFER). The old account must lose the plan and the new one gain it. (Task 2: `eventUserIds` returns both sides of a TRANSFER.)
4. **The Test Store literal.** The docs do not show the v1 `store` value for Test Store purchases; this plan assumes `test_store`. If a Test Store purchase is ignored, check the logged store and fix the one mapping line. (Task 7 checks the row after a live Test Store purchase.)
5. **A user covered by a herd mate's Tusk Herd opens the paywall** and must be told they are already covered before buying a second plan. (Task 3: a `planSummary` test for source `herd`; Task 5 shows it at the top of the paywall.)

## Not in this plan

- **Play Console products and license-tester purchases.** Play Billing works only on a build from the internal testing track, and release builds talk to production. That test waits on Pedro's go-ahead for production (see the handoff).
- **Deleting an account.** The app has no delete-account flow yet, so there is nothing to put the spec's "cancel in the store first" warning in front of. When one is built, it must show that warning for `store in ('play','app_store')`.
- **The invite link.** 9c already shares `tusky:///join/<code>` from the Herd screen and `/join/[code]` opens the join flow with the code filled in. This plan only adds a way to it from the Plan screen for a Tusk Herd payer, and re-checks the link in Task 7. An https link (tappable in chat apps) needs a domain and App Links: later.
- iOS and the App Store.

---

### Task 1: Map a RevenueCat subscriber to a subscription row (pure)

**Files:**
- Create: `supabase/functions/_shared/revenuecat.ts`
- Create: `supabase/functions/_shared/revenuecat.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type PaidPlan = 'tusklet' | 'tusk' | 'tusk_herd';
  export type RcEntitlement = { expires_date: string | null; grace_period_expires_date: string | null; product_identifier: string };
  export type RcSubscription = { store: string; expires_date: string | null; billing_issues_detected_at: string | null };
  export type RcSubscriber = { entitlements: Record<string, RcEntitlement>; subscriptions: Record<string, RcSubscription> };
  export type SubRow = { plan: string; store: string; status: 'active' | 'grace' | 'expired'; expires_at: string | null };
  export function subscriptionFromRc(s: RcSubscriber, current: SubRow | null, now: Date, allowTest: boolean): SubRow | null; // null = leave the row as it is
  ```

- [ ] **Step 1: Check the branch**

Run: `git branch --show-current`
Expected: `pedro-14c` (made from `pedro-14b` when this plan was committed).

- [ ] **Step 2: Write the failing tests**

`supabase/functions/_shared/revenuecat.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert';

import { type RcSubscriber, type SubRow, subscriptionFromRc } from './revenuecat.ts';

const NOW = new Date('2026-10-10T12:00:00Z');
const FUTURE = '2026-11-10T12:00:00Z';
const PAST = '2026-10-01T12:00:00Z';

const sub = (
  ents: Record<string, { product: string; expires: string | null; grace?: string | null }>,
  subs: Record<string, { store: string; expires?: string | null; billing?: string | null }> = {},
): RcSubscriber => ({
  entitlements: Object.fromEntries(
    Object.entries(ents).map(([id, e]) => [
      id,
      { product_identifier: e.product, expires_date: e.expires, grace_period_expires_date: e.grace ?? null },
    ]),
  ),
  subscriptions: Object.fromEntries(
    Object.entries(subs).map(([id, s]) => [
      id,
      { store: s.store, expires_date: s.expires ?? null, billing_issues_detected_at: s.billing ?? null },
    ]),
  ),
});

const TRIAL: SubRow = { plan: 'trial', store: 'trial', status: 'active', expires_at: FUTURE };
const COMP: SubRow = { plan: 'tusk', store: 'comp', status: 'active', expires_at: null };
const PAID_TUSK: SubRow = { plan: 'tusk', store: 'play', status: 'active', expires_at: PAST };

Deno.test('a live Play purchase replaces the trial', () => {
  const s = sub({ tusk: { product: 'tusk:monthly', expires: FUTURE } }, { 'tusk:monthly': { store: 'play_store', expires: FUTURE } });
  assertEquals(subscriptionFromRc(s, TRIAL, NOW, false), { plan: 'tusk', store: 'play', status: 'active', expires_at: FUTURE });
});

Deno.test('the subscription is found by its base id when the entitlement names the base plan', () => {
  const s = sub({ tusklet: { product: 'tusklet:yearly', expires: FUTURE } }, { tusklet: { store: 'play_store', expires: FUTURE } });
  assertEquals(subscriptionFromRc(s, TRIAL, NOW, false)?.store, 'play');
});

Deno.test('the best-ranked live entitlement wins', () => {
  const s = sub(
    { tusklet: { product: 'tusklet:monthly', expires: FUTURE }, tusk_herd: { product: 'tusk_herd:yearly', expires: FUTURE } },
    { 'tusklet:monthly': { store: 'play_store' }, 'tusk_herd:yearly': { store: 'play_store' } },
  );
  assertEquals(subscriptionFromRc(s, TRIAL, NOW, false)?.plan, 'tusk_herd');
});

Deno.test('a billing issue is grace, and grace runs to the grace end', () => {
  const s = sub(
    { tusk: { product: 'tusk:monthly', expires: PAST, grace: FUTURE } },
    { 'tusk:monthly': { store: 'play_store', billing: PAST } },
  );
  assertEquals(subscriptionFromRc(s, PAID_TUSK, NOW, false), { plan: 'tusk', store: 'play', status: 'grace', expires_at: FUTURE });
});

Deno.test('a billing issue inside the paid period is grace too', () => {
  const s = sub({ tusk: { product: 'tusk:monthly', expires: FUTURE } }, { 'tusk:monthly': { store: 'play_store', billing: PAST } });
  assertEquals(subscriptionFromRc(s, PAID_TUSK, NOW, false)?.status, 'grace');
});

Deno.test('nothing live expires a row we wrote, keeping the latest plan and expiry', () => {
  const s = sub(
    { tusklet: { product: 'tusklet:monthly', expires: '2026-09-01T00:00:00Z' }, tusk: { product: 'tusk:monthly', expires: PAST } },
    { 'tusklet:monthly': { store: 'play_store' }, 'tusk:monthly': { store: 'play_store' } },
  );
  assertEquals(subscriptionFromRc(s, PAID_TUSK, NOW, false), { plan: 'tusk', store: 'play', status: 'expired', expires_at: PAST });
});

Deno.test('a lapsed purchase never brings the trial back', () => {
  const s = sub({ tusk: { product: 'tusk:monthly', expires: PAST } }, { 'tusk:monthly': { store: 'play_store' } });
  assertEquals(subscriptionFromRc(s, PAID_TUSK, NOW, false)?.plan, 'tusk');
  assertEquals(subscriptionFromRc(s, PAID_TUSK, NOW, false)?.status, 'expired');
});

Deno.test('an empty RevenueCat record leaves a trial alone', () => {
  assertEquals(subscriptionFromRc(sub({}), TRIAL, NOW, false), null);
});

Deno.test('an expired purchase leaves a running trial alone', () => {
  const s = sub({ tusk: { product: 'tusk:monthly', expires: PAST } }, { 'tusk:monthly': { store: 'play_store' } });
  assertEquals(subscriptionFromRc(s, TRIAL, NOW, false), null);
});

Deno.test('a comp row is never changed, even by a live purchase', () => {
  const s = sub({ tusk_herd: { product: 'tusk_herd:monthly', expires: FUTURE } }, { 'tusk_herd:monthly': { store: 'play_store' } });
  assertEquals(subscriptionFromRc(s, COMP, NOW, false), null);
});

Deno.test('Test Store purchases count only where allowed', () => {
  const s = sub({ tusk: { product: 'tusk_monthly', expires: FUTURE } }, { tusk_monthly: { store: 'test_store' } });
  assertEquals(subscriptionFromRc(s, TRIAL, NOW, false), null);
  assertEquals(subscriptionFromRc(s, TRIAL, NOW, true)?.store, 'test');
});

Deno.test('entitlements we do not sell and unknown stores are ignored', () => {
  const s = sub(
    { pro: { product: 'pro', expires: FUTURE }, tusk: { product: 'tusk_promo', expires: FUTURE } },
    { pro: { store: 'play_store' }, tusk_promo: { store: 'promotional' } },
  );
  assertEquals(subscriptionFromRc(s, TRIAL, NOW, true), null);
});

Deno.test('no current row means nothing to write', () => {
  const s = sub({ tusk: { product: 'tusk:monthly', expires: FUTURE } }, { 'tusk:monthly': { store: 'play_store' } });
  assertEquals(subscriptionFromRc(s, null, NOW, false), null);
});
```

- [ ] **Step 3: Run the tests to see them fail**

Run: `npx -y deno test --allow-env supabase/functions/_shared/revenuecat.test.ts`
Expected: FAIL, module `./revenuecat.ts` not found.

- [ ] **Step 4: Write the mapper**

`supabase/functions/_shared/revenuecat.ts`:

```ts
/**
 * Purchases (Phase 14c). RevenueCat knows what a user bought; this turns its
 * subscriber record into our `subscriptions` row. The record is always fetched
 * from RevenueCat's API, never read from a webhook body, so a repeated or late
 * event only writes the same answer again.
 */
export type PaidPlan = 'tusklet' | 'tusk' | 'tusk_herd';

export type RcEntitlement = {
  expires_date: string | null;
  grace_period_expires_date: string | null;
  product_identifier: string;
};
export type RcSubscription = { store: string; expires_date: string | null; billing_issues_detected_at: string | null };
export type RcSubscriber = { entitlements: Record<string, RcEntitlement>; subscriptions: Record<string, RcSubscription> };

export type SubRow = { plan: string; store: string; status: 'active' | 'grace' | 'expired'; expires_at: string | null };

/** Best first. The same order as `plans.rank`. */
const PAID: PaidPlan[] = ['tusk_herd', 'tusk', 'tusklet'];

/** Rows this file writes. A trial or comp row was written by someone else. */
const PURCHASED = new Set(['play', 'app_store', 'test']);

function storeOf(s: string, allowTest: boolean): string | null {
  if (s === 'play_store') return 'play';
  if (s === 'app_store') return 'app_store';
  if (s === 'test_store' && allowTest) return 'test';
  return null;
}

/** Play names a product `subscription:base_plan`; RevenueCat may key it either way. */
function subscriptionFor(s: RcSubscriber, product: string): RcSubscription | undefined {
  return s.subscriptions[product] ?? s.subscriptions[product.split(':')[0]];
}

/** When access ends: the paid period, or the grace period if that runs later. Null never ends. */
const endOf = (e: RcEntitlement): string | null =>
  e.expires_date === null
    ? null
    : e.grace_period_expires_date !== null && Date.parse(e.grace_period_expires_date) > Date.parse(e.expires_date)
    ? e.grace_period_expires_date
    : e.expires_date;

/**
 * The row RevenueCat's state calls for, or null to leave the current row
 * alone: a comp row, a trial nobody has paid over, or a user we have no row for.
 */
export function subscriptionFromRc(
  s: RcSubscriber,
  current: SubRow | null,
  now: Date,
  allowTest: boolean,
): SubRow | null {
  if (!current || current.store === 'comp') return null;

  const ours = PAID.flatMap((plan) => {
    const e = s.entitlements[plan];
    const sub = e && subscriptionFor(s, e.product_identifier);
    const store = sub && storeOf(sub.store, allowTest);
    if (!e || !sub || !store) return [];
    const until = endOf(e);
    const live = until === null || Date.parse(until) > now.getTime();
    const billing = sub.billing_issues_detected_at !== null || (e.expires_date !== null && Date.parse(e.expires_date) <= now.getTime());
    return [{ plan, store, until, live, billing }];
  });

  const live = ours.find((x) => x.live);
  if (live) {
    return { plan: live.plan, store: live.store, status: live.billing ? 'grace' : 'active', expires_at: live.until };
  }
  if (!PURCHASED.has(current.store) || ours.length === 0) return null;
  const last = ours.reduce((a, b) => (Date.parse(b.until ?? '') > Date.parse(a.until ?? '') ? b : a));
  return { plan: last.plan, store: last.store, status: 'expired', expires_at: last.until };
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `npx -y deno test --allow-env supabase/functions/_shared/revenuecat.test.ts`
Expected: 13 passed.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/revenuecat.ts supabase/functions/_shared/revenuecat.test.ts
git commit -m "feat(plans): map a RevenueCat subscriber to a subscription row (Phase 14c)"
```

---

### Task 2: `revenuecat-webhook` and `plan-refresh`

**Files:**
- Modify: `supabase/functions/_shared/revenuecat.ts` (add the client, `eventUserIds`, `syncSubscriber`)
- Modify: `supabase/functions/_shared/revenuecat.test.ts`
- Create: `supabase/functions/revenuecat-webhook/index.ts`
- Create: `supabase/functions/plan-refresh/index.ts`
- Create: `supabase/migrations/20261010120000_phase14c_test_store.sql`
- Modify: `supabase/config.toml` (after the `[functions.plan-enforcer]` block)
- Modify: `supabase/functions/.env.example`

**Interfaces:**
- Consumes: `subscriptionFromRc`, `SubRow`, `RcSubscriber` (Task 1); `sameSecret` from `_shared/enforce.ts`; `getAdminClient`, `getAuthedUser`, `jsonResponse` from `_shared/lib.ts`.
- Produces:
  ```ts
  export type RcClient = { subscriber(appUserId: string): Promise<RcSubscriber> };
  export function revenueCatClient(secretKey: string): RcClient;           // throws on any non-2xx
  export function eventUserIds(body: unknown): string[];                   // Supabase user ids only
  export type SubStore = { read(userId: string): Promise<SubRow | null>; write(userId: string, row: SubRow): Promise<void> };
  export async function syncSubscriber(db: SubStore, rc: RcClient, userId: string, now: Date, allowTest: boolean): Promise<'written' | 'unchanged' | 'no_row'>;
  export function adminSubStore(admin: SupabaseClient): SubStore;
  ```
  The app calls `supabase.functions.invoke('plan-refresh')` and gets `{ result: 'written' | 'unchanged' | 'no_row' }`.

- [ ] **Step 1: Write the failing tests** (append to `revenuecat.test.ts`)

```ts
import { eventUserIds, type RcClient, type SubStore, syncSubscriber } from './revenuecat.ts';

const U1 = '0b7c7d55-6f6b-4a57-9d63-2d6f0f7c1a01';
const U2 = '0b7c7d55-6f6b-4a57-9d63-2d6f0f7c1a02';

Deno.test('eventUserIds: a purchase names its user', () => {
  assertEquals(eventUserIds({ event: { type: 'INITIAL_PURCHASE', app_user_id: U1 } }), [U1]);
});

Deno.test('eventUserIds: a transfer names both sides', () => {
  assertEquals(
    eventUserIds({ event: { type: 'TRANSFER', transferred_from: [U1, '$RCAnonymousID:abc'], transferred_to: [U2] } }),
    [U1, U2],
  );
});

Deno.test('eventUserIds: anonymous ids, test events and junk name nobody', () => {
  assertEquals(eventUserIds({ event: { type: 'TEST', app_user_id: '$RCAnonymousID:abc' } }), []);
  assertEquals(eventUserIds({ event: { type: 'RENEWAL', app_user_id: 42 } }), []);
  assertEquals(eventUserIds(null), []);
  assertEquals(eventUserIds('nope'), []);
});

function memoryStore(rows: Record<string, SubRow>): SubStore & { writes: [string, SubRow][] } {
  const writes: [string, SubRow][] = [];
  return {
    writes,
    read: (id) => Promise.resolve(rows[id] ?? null),
    write: (id, row) => {
      writes.push([id, row]);
      return Promise.resolve();
    },
  };
}
const rcWith = (s: RcSubscriber): RcClient => ({ subscriber: () => Promise.resolve(s) });
const LIVE_TUSK = sub({ tusk: { product: 'tusk:monthly', expires: FUTURE } }, { 'tusk:monthly': { store: 'play_store' } });

Deno.test('syncSubscriber: a caller who just bought is written at once', async () => {
  const db = memoryStore({ [U1]: TRIAL });
  assertEquals(await syncSubscriber(db, rcWith(LIVE_TUSK), U1, NOW, false), 'written');
  assertEquals(db.writes, [[U1, { plan: 'tusk', store: 'play', status: 'active', expires_at: FUTURE }]]);
});

Deno.test('syncSubscriber: the same state twice writes nothing the second time', async () => {
  const db = memoryStore({ [U1]: { plan: 'tusk', store: 'play', status: 'active', expires_at: FUTURE } });
  assertEquals(await syncSubscriber(db, rcWith(LIVE_TUSK), U1, NOW, false), 'unchanged');
  assertEquals(db.writes, []);
});

Deno.test('syncSubscriber: a user we do not know is skipped', async () => {
  const db = memoryStore({});
  assertEquals(await syncSubscriber(db, rcWith(LIVE_TUSK), U1, NOW, false), 'no_row');
});

Deno.test('syncSubscriber: a RevenueCat failure throws, so the webhook answers 500 and is retried', async () => {
  const db = memoryStore({ [U1]: TRIAL });
  const down: RcClient = { subscriber: () => Promise.reject(new Error('RevenueCat 503')) };
  let threw = false;
  try {
    await syncSubscriber(db, down, U1, NOW, false);
  } catch {
    threw = true;
  }
  assertEquals([threw, db.writes.length], [true, 0]);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx -y deno test --allow-env supabase/functions/_shared/revenuecat.test.ts`
Expected: FAIL, `eventUserIds` is not exported.

- [ ] **Step 3: Add the client, `eventUserIds`, `syncSubscriber` and `adminSubStore`** (append to `revenuecat.ts`; add `import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';` at the top)

```ts
export type RcClient = { subscriber(appUserId: string): Promise<RcSubscriber> };

/** RevenueCat's REST API (v1), with the project's secret key. Throws on anything but 2xx. */
export function revenueCatClient(secretKey: string): RcClient {
  return {
    async subscriber(appUserId) {
      const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
        headers: { Authorization: `Bearer ${secretKey}`, Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`RevenueCat ${res.status}`);
      const body = await res.json();
      const s = body?.subscriber ?? {};
      return { entitlements: s.entitlements ?? {}, subscriptions: s.subscriptions ?? {} };
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whose state to re-fetch for a webhook. Only the ids are read from the body.
 * A transfer (a restore on another account) changes both sides. Anonymous
 * RevenueCat ids are never ours: the app logs in with the Supabase id first.
 */
export function eventUserIds(body: unknown): string[] {
  const e = (body as { event?: Record<string, unknown> } | null)?.event;
  if (!e || typeof e !== 'object') return [];
  const raw = e.type === 'TRANSFER'
    ? [e.transferred_from, e.transferred_to].flatMap((x) => (Array.isArray(x) ? x : []))
    : [e.app_user_id];
  return [...new Set(raw.filter((x): x is string => typeof x === 'string' && UUID.test(x)))];
}

export type SubStore = {
  read(userId: string): Promise<SubRow | null>;
  write(userId: string, row: SubRow): Promise<void>;
};

const same = (a: SubRow, b: SubRow) =>
  a.plan === b.plan && a.store === b.store && a.status === b.status &&
  (a.expires_at === null ? b.expires_at === null : b.expires_at !== null && Date.parse(a.expires_at) === Date.parse(b.expires_at));

/** Re-read one user from RevenueCat and write what it calls for. RevenueCat failures throw. */
export async function syncSubscriber(
  db: SubStore,
  rc: RcClient,
  userId: string,
  now: Date,
  allowTest: boolean,
): Promise<'written' | 'unchanged' | 'no_row'> {
  const current = await db.read(userId);
  if (!current) return 'no_row';
  const next = subscriptionFromRc(await rc.subscriber(userId), current, now, allowTest);
  if (!next || same(next, current)) return 'unchanged';
  await db.write(userId, next);
  return 'written';
}

/** The service-role store. The update names four columns: over_limit_since is plan-enforcer's. */
export function adminSubStore(admin: SupabaseClient): SubStore {
  return {
    async read(userId) {
      const { data, error } = await admin
        .from('subscriptions').select('plan, store, status, expires_at').eq('user_id', userId).maybeSingle();
      if (error) throw error;
      return data as SubRow | null;
    },
    async write(userId, row) {
      const { error } = await admin
        .from('subscriptions')
        .update({ plan: row.plan, store: row.store, status: row.status, expires_at: row.expires_at })
        .eq('user_id', userId);
      if (error) throw error;
    },
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx -y deno test --allow-env supabase/functions/_shared/revenuecat.test.ts`
Expected: 20 passed.

- [ ] **Step 5: Allow the `test` store in the database**

`supabase/migrations/20261010120000_phase14c_test_store.sql`:

```sql
-- Phase 14c: RevenueCat's Test Store buys on dev with no Play Console. Its rows
-- carry store 'test'; revenuecat-webhook writes them only where PLAID_ENV is sandbox.
alter table public.subscriptions drop constraint subscriptions_store_check;
alter table public.subscriptions add constraint subscriptions_store_check
  check (store in ('play', 'app_store', 'comp', 'trial', 'test'));
```

- [ ] **Step 6: Write the webhook**

`supabase/functions/revenuecat-webhook/index.ts`:

```ts
import { sameSecret } from '../_shared/enforce.ts';
import { getAdminClient, jsonResponse } from '../_shared/lib.ts';
import { adminSubStore, eventUserIds, revenueCatClient, syncSubscriber } from '../_shared/revenuecat.ts';

/**
 * RevenueCat's webhook (Phase 14c). Public, so the shared Authorization value
 * is checked before anything else. The body only says whom to look at: each
 * user's state is re-fetched from RevenueCat and written from there.
 */
Deno.serve(async (req) => {
  if (!sameSecret(req.headers.get('Authorization'), Deno.env.get('REVENUECAT_WEBHOOK_SECRET'))) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // An unreadable body names nobody; it is answered 200 below.
  }
  const ids = eventUserIds(body);
  if (ids.length === 0) {
    console.log('revenuecat-webhook: no Tusky user in event', (body as { event?: { type?: unknown } })?.event?.type);
    return jsonResponse({ ok: true, users: 0 });
  }

  const db = adminSubStore(getAdminClient());
  const rc = revenueCatClient(Deno.env.get('REVENUECAT_SECRET_KEY') ?? '');
  const allowTest = Deno.env.get('PLAID_ENV') === 'sandbox';
  try {
    const results = [];
    for (const id of ids) results.push([id, await syncSubscriber(db, rc, id, new Date(), allowTest)]);
    console.log('revenuecat-webhook', JSON.stringify(results));
    return jsonResponse({ ok: true, users: ids.length });
  } catch (err) {
    // RevenueCat or the database failed: a non-200 makes RevenueCat retry.
    console.error('revenuecat-webhook failed', err);
    return jsonResponse({ error: 'sync_failed' }, 500);
  }
});
```

- [ ] **Step 7: Write `plan-refresh`**

`supabase/functions/plan-refresh/index.ts`:

```ts
import { getAdminClient, getAuthedUser, jsonResponse } from '../_shared/lib.ts';
import { adminSubStore, revenueCatClient, syncSubscriber } from '../_shared/revenuecat.ts';

/**
 * The app calls this right after a purchase or restore (Phase 14c), so the new
 * plan shows without waiting for the webhook. It runs the webhook's own path
 * for the caller: RevenueCat is asked, the app is never believed.
 */
Deno.serve(async (req) => {
  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);
  try {
    const result = await syncSubscriber(
      adminSubStore(admin),
      revenueCatClient(Deno.env.get('REVENUECAT_SECRET_KEY') ?? ''),
      user.id,
      new Date(),
      Deno.env.get('PLAID_ENV') === 'sandbox',
    );
    return jsonResponse({ result });
  } catch (err) {
    console.error('plan-refresh failed', err);
    return jsonResponse({ error: 'refresh_failed' }, 502);
  }
});
```

- [ ] **Step 8: Register the public function and document the secrets**

In `supabase/config.toml`, after the `[functions.plan-enforcer]` block:

```toml
[functions.revenuecat-webhook]
verify_jwt = false
```

At the end of `supabase/functions/.env.example`:

```sh
# RevenueCat (Phase 14c). Dashboard → Project settings → API keys: the v1 SECRET key
# (never the public SDK key, which goes in apps/mobile/.env). The webhook secret is
# any long random string, set both here and as the webhook's Authorization header
# value in RevenueCat → Integrations → Webhooks. Without it, every webhook is refused.
REVENUECAT_SECRET_KEY=
REVENUECAT_WEBHOOK_SECRET=
```

- [ ] **Step 9: Type-check both functions and run every Edge Function test**

Run: `npx -y deno check supabase/functions/revenuecat-webhook/index.ts supabase/functions/plan-refresh/index.ts && npx -y deno test --allow-env supabase/functions/_shared/`
Expected: no type errors; all tests pass (247 from 14b plus 20 new).

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/_shared/revenuecat.ts supabase/functions/_shared/revenuecat.test.ts supabase/functions/revenuecat-webhook supabase/functions/plan-refresh supabase/migrations/20261010120000_phase14c_test_store.sql supabase/config.toml supabase/functions/.env.example
git commit -m "feat(plans): revenuecat-webhook and plan-refresh write the plan from RevenueCat (Phase 14c)"
```

---

### Task 3: What the Plan screen and paywall say (pure)

**Files:**
- Create: `apps/mobile/src/lib/paywall.ts`
- Create: `apps/mobile/src/lib/paywall.test.ts`

**Interfaces:**
- Consumes: `type PlanInfo` from `lib/plan-banner.ts` (`import type`).
- Produces:
  ```ts
  export type PaidPlan = 'tusklet' | 'tusk' | 'tusk_herd';
  export const PLAN_NAMES: Record<string, string>;
  export type PlanDetail = PlanInfo & { status: string | null; store: string | null };
  export type PlanLimits = { id: string; max_banks: number; history_days: number; scope: 'self' | 'herd' };
  export type PackageLike = { identifier: string; product: { identifier: string; priceString: string } };
  export type Tier<P extends PackageLike> = { plan: PaidPlan; name: string; lines: string[]; monthly: P | null; yearly: P | null };
  export function paywallTiers<P extends PackageLike>(packages: P[], limits: PlanLimits[]): Tier<P>[];
  export function planSummary(p: PlanDetail, now: Date, payerName: string | null): { title: string; detail: string };
  export function bankUsage(used: number, max: number): string;
  export function herdPayer(rows: { user_id: string; status: string; expires_at: string | null }[], me: string, now: Date): string | null;
  export function productChange(active: string[], target: string): { oldProductIdentifier: string; upgrade: boolean } | null;
  ```

- [ ] **Step 1: Write the failing tests**

`apps/mobile/src/lib/paywall.test.ts`:

```ts
/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { bankUsage, herdPayer, type PlanDetail, planSummary, paywallTiers, productChange } from './paywall.ts';

const NOW = new Date('2026-10-10T12:00:00Z');
const detail = (over: Partial<PlanDetail>): PlanDetail => ({
  plan: 'tusk', source: 'own', expires_at: null, max_banks: 10, banks_used: 2, over_limit_since: null,
  status: 'active', store: 'play', ...over,
});
const LIMITS = [
  { id: 'free', max_banks: 0, history_days: 0, scope: 'self' as const },
  { id: 'tusklet', max_banks: 3, history_days: 365, scope: 'self' as const },
  { id: 'tusk', max_banks: 10, history_days: 730, scope: 'self' as const },
  { id: 'tusk_herd', max_banks: 15, history_days: 730, scope: 'herd' as const },
];
const pkg = (identifier: string, price: string) => ({ identifier, product: { identifier: `${identifier}-p`, priceString: price } });

test('tiers come in plan order with both periods, whatever order the store sends', () => {
  const tiers = paywallTiers(
    [pkg('tusk_herd_yearly', '$99.00'), pkg('tusklet_monthly', '$3.99'), pkg('tusk_monthly', '$6.99'), pkg('tusklet_yearly', '$45.00')],
    LIMITS,
  );
  assert.deepEqual(tiers.map((t) => [t.plan, t.monthly?.product.priceString ?? null, t.yearly?.product.priceString ?? null]), [
    ['tusklet', '$3.99', '$45.00'],
    ['tusk', '$6.99', null],
    ['tusk_herd', null, '$99.00'],
  ]);
});

test('a tier with no package on sale is left out, and unknown packages are ignored', () => {
  assert.deepEqual(paywallTiers([pkg('tusk_monthly', '$6.99'), pkg('$rc_lifetime', '$99')], LIMITS).map((t) => t.plan), ['tusk']);
});

test('tier lines come from the plans table', () => {
  const [tusklet, , herd] = paywallTiers(
    [pkg('tusklet_monthly', 'a'), pkg('tusk_monthly', 'b'), pkg('tusk_herd_monthly', 'c')],
    LIMITS,
  );
  assert.deepEqual(tusklet.lines, ['Up to 3 banks', '12 months of history', 'Every feature']);
  assert.deepEqual(herd.lines, ['Up to 15 banks, shared', '24 months of history', 'Every feature', 'Covers everyone in your herd']);
});

test('trial days left, and its last day', () => {
  assert.deepEqual(planSummary(detail({ plan: 'trial', source: 'trial', store: 'trial', expires_at: '2026-10-22T12:00:00Z' }), NOW, null), {
    title: 'Free trial',
    detail: '12 days left',
  });
  assert.equal(planSummary(detail({ plan: 'trial', source: 'trial', expires_at: '2026-10-10T18:00:00Z' }), NOW, null).detail, 'Last day');
});

test('covered by a herd mate names them', () => {
  assert.deepEqual(planSummary(detail({ plan: 'tusk_herd', source: 'herd', store: 'trial' }), NOW, 'Kel'), {
    title: 'Tusk Herd',
    detail: "Covered by Kel's Tusk Herd",
  });
  assert.equal(planSummary(detail({ plan: 'tusk_herd', source: 'herd' }), NOW, null).detail, "Covered by a herd mate's Tusk Herd");
});

test('free, comp, grace and paid', () => {
  assert.equal(planSummary(detail({ plan: 'free', source: 'free', max_banks: 0 }), NOW, null).title, 'Free');
  assert.equal(planSummary(detail({ store: 'comp' }), NOW, null).detail, 'Complimentary');
  assert.equal(
    planSummary(detail({ status: 'grace', expires_at: '2026-10-15T12:00:00Z' }), NOW, null).detail,
    "Your payment didn't go through. Update it in the Play Store to keep your banks.",
  );
  assert.match(planSummary(detail({ expires_at: '2026-11-10T12:00:00Z' }), NOW, null).detail, /^Paid through Nov 10$/);
});

test('bank usage', () => {
  assert.equal(bankUsage(2, 3), '2 of 3 banks');
  assert.equal(bankUsage(1, 1), '1 of 1 bank');
  assert.equal(bankUsage(0, 0), 'No banks on this plan');
});

test('the herd payer is a live Tusk Herd row that is not mine', () => {
  const rows = [
    { user_id: 'me', status: 'active', expires_at: null },
    { user_id: 'old', status: 'expired', expires_at: '2026-10-01T00:00:00Z' },
    { user_id: 'lapsed', status: 'active', expires_at: '2026-10-09T00:00:00Z' },
    { user_id: 'kel', status: 'grace', expires_at: '2026-10-12T00:00:00Z' },
  ];
  assert.equal(herdPayer(rows, 'me', NOW), 'kel');
  assert.equal(herdPayer(rows.slice(0, 3), 'me', NOW), null);
});

test('buying over an active Play plan changes the product; rank decides upgrade', () => {
  assert.deepEqual(productChange(['tusklet:monthly'], 'tusk'), { oldProductIdentifier: 'tusklet', upgrade: true });
  assert.deepEqual(productChange(['tusk_herd:yearly'], 'tusk'), { oldProductIdentifier: 'tusk_herd', upgrade: false });
  assert.deepEqual(productChange(['tusk:monthly'], 'tusk'), { oldProductIdentifier: 'tusk', upgrade: false });
  assert.equal(productChange([], 'tusk'), null);
  assert.equal(productChange(['something_else'], 'tusk'), null);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run (inside `apps/mobile`): `npm test`
Expected: FAIL, `./paywall.ts` not found.

- [ ] **Step 3: Write `lib/paywall.ts`**

```ts
import type { PlanInfo } from './plan-banner.ts';

/**
 * What the Plan screen and paywall say (Phase 14c). Pure: prices come from the
 * store, limits from the `plans` table, and the plan itself from the server.
 */
export type PaidPlan = 'tusklet' | 'tusk' | 'tusk_herd';

const ORDER: PaidPlan[] = ['tusklet', 'tusk', 'tusk_herd'];

export const PLAN_NAMES: Record<string, string> = {
  free: 'Free',
  trial: 'Free trial',
  tusklet: 'Tusklet',
  tusk: 'Tusk',
  tusk_herd: 'Tusk Herd',
};

export type PlanDetail = PlanInfo & { status: string | null; store: string | null };
export type PlanLimits = { id: string; max_banks: number; history_days: number; scope: 'self' | 'herd' };
export type PackageLike = { identifier: string; product: { identifier: string; priceString: string } };
export type Tier<P extends PackageLike> = {
  plan: PaidPlan;
  name: string;
  lines: string[];
  monthly: P | null;
  yearly: P | null;
};

const DAY = 86_400_000;

function tierLines(l: PlanLimits): string[] {
  const banks = `Up to ${l.max_banks} ${l.max_banks === 1 ? 'bank' : 'banks'}${l.scope === 'herd' ? ', shared' : ''}`;
  const lines = [banks, `${Math.round(l.history_days / 30.4)} months of history`, 'Every feature'];
  return l.scope === 'herd' ? [...lines, 'Covers everyone in your herd'] : lines;
}

/** Packages are named `<plan>_monthly` / `<plan>_yearly` in the `default` offering. */
export function paywallTiers<P extends PackageLike>(packages: P[], limits: PlanLimits[]): Tier<P>[] {
  const find = (id: string) => packages.find((p) => p.identifier === id) ?? null;
  return ORDER.flatMap((plan) => {
    const l = limits.find((x) => x.id === plan);
    const monthly = find(`${plan}_monthly`);
    const yearly = find(`${plan}_yearly`);
    if (!l || (!monthly && !yearly)) return [];
    return [{ plan, name: PLAN_NAMES[plan], lines: tierLines(l), monthly, yearly }];
  });
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export function planSummary(p: PlanDetail, now: Date, payerName: string | null): { title: string; detail: string } {
  const title = PLAN_NAMES[p.plan] ?? p.plan;
  if (p.source === 'free') {
    return { title, detail: 'Your trial has ended. Everything you tracked is still here; a plan connects your banks again.' };
  }
  if (p.source === 'trial') {
    const left = p.expires_at ? Math.ceil((Date.parse(p.expires_at) - now.getTime()) / DAY) : 0;
    return { title, detail: left <= 1 ? 'Last day' : `${left} days left` };
  }
  if (p.source === 'herd') return { title, detail: `Covered by ${payerName ?? 'a herd mate'}'s Tusk Herd` };
  if (p.store === 'comp') return { title, detail: 'Complimentary' };
  if (p.status === 'grace') {
    return { title, detail: "Your payment didn't go through. Update it in the Play Store to keep your banks." };
  }
  return { title, detail: p.expires_at ? `Paid through ${shortDate(p.expires_at)}` : 'Active' };
}

export function bankUsage(used: number, max: number): string {
  if (max === 0) return 'No banks on this plan';
  return `${used} of ${max} ${max === 1 ? 'bank' : 'banks'}`;
}

/** Whose Tusk Herd covers me: a live row that is not mine (RLS shows only herd mates'). */
export function herdPayer(
  rows: { user_id: string; status: string; expires_at: string | null }[],
  me: string,
  now: Date,
): string | null {
  const live = rows.find(
    (r) =>
      r.user_id !== me &&
      (r.status === 'active' || r.status === 'grace') &&
      (r.expires_at === null || Date.parse(r.expires_at) > now.getTime()),
  );
  return live?.user_id ?? null;
}

/**
 * Play replaces a running subscription instead of adding a second one. Active
 * ids look like `tusk:monthly`; the old product is the part before the colon.
 */
export function productChange(active: string[], target: string): { oldProductIdentifier: string; upgrade: boolean } | null {
  const old = active.map((id) => id.split(':')[0]).find((id): id is PaidPlan => (ORDER as string[]).includes(id));
  if (!old) return null;
  return { oldProductIdentifier: old, upgrade: ORDER.indexOf(target as PaidPlan) > ORDER.indexOf(old) };
}
```

- [ ] **Step 4: Run the tests to see them pass**

Run (inside `apps/mobile`): `npm test`
Expected: all pass (110 from 14b plus 9 new).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/paywall.ts apps/mobile/src/lib/paywall.test.ts
git commit -m "feat(app): word the plan and group the paywall's tiers (Phase 14c)"
```

---

### Task 4: The RevenueCat SDK in the app

**Files:**
- Modify: `apps/mobile/package.json` (through `npx expo install`)
- Create: `apps/mobile/src/lib/purchases.ts`
- Modify: `apps/mobile/src/app/_layout.tsx` (identify the RevenueCat user with the session)
- Modify: `apps/mobile/.env.example`

**Interfaces:**
- Consumes: `backend` from `lib/supabase.ts`; `productChange`, `PaidPlan` from `lib/paywall.ts`; `useSession` from `lib/session.tsx`.
- Produces:
  ```ts
  export const purchasesEnabled: boolean;                        // a key exists for this backend
  export function identifyPurchaser(userId: string | null): Promise<void>;
  export function useOfferings(): UseQueryResult<PurchasesPackage[]>;          // key ['offerings']
  export function useBuy(): UseMutationResult<'bought' | 'cancelled', Error, { pkg: PurchasesPackage; plan: PaidPlan }>;
  export function useRestore(): UseMutationResult<void, Error, void>;
  export function manageSubscriptionsUrl(): Promise<string>;
  ```

- [ ] **Step 1: Install the SDK**

Run (inside `apps/mobile`): `npx expo install react-native-purchases`
Expected: `react-native-purchases` added to `dependencies`. Read its README's Expo section in `node_modules/react-native-purchases/README.md` and confirm no config plugin is needed for Android. If it names one, add it to `app.json` `plugins`.

- [ ] **Step 2: Add the keys to `.env.example`** (append)

```sh
# RevenueCat public SDK keys (Phase 14c), per backend. Dev uses the project's Test
# Store key (starts with test_), so purchases run on the emulator with no Play
# Console. Leave the production key empty until launch: the paywall then says
# plans are coming soon. Never put RevenueCat's secret key here.
EXPO_PUBLIC_REVENUECAT_KEY=
EXPO_PUBLIC_PROD_REVENUECAT_KEY=
```

- [ ] **Step 3: Write `lib/purchases.ts`**

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Purchases, { PRORATION_MODE, PURCHASES_ERROR_CODE, type PurchasesPackage } from 'react-native-purchases';

import { type PaidPlan, productChange } from '@/lib/paywall';
import { backend, supabase } from '@/lib/supabase';

/**
 * Buying (Phase 14c). RevenueCat talks to the store; our server decides what
 * a purchase grants. After a purchase or restore the app asks `plan-refresh`
 * to re-read RevenueCat, then refetches the plan. The app never grants access.
 */

// `||` not `??`: unset EXPO_PUBLIC_ vars arrive as empty strings.
const apiKey =
  backend === 'real' ? process.env.EXPO_PUBLIC_PROD_REVENUECAT_KEY || '' : process.env.EXPO_PUBLIC_REVENUECAT_KEY || '';

/** Without a key for this backend there is nothing to buy: the paywall says so. */
export const purchasesEnabled = apiKey !== '';

let configured = false;
/** Settles once RevenueCat knows who is signed in; a purchase waits for it. */
let identified: Promise<void> = Promise.resolve();

/** RevenueCat's user is always the Supabase user, so a purchase can never be anonymous. */
export function identifyPurchaser(userId: string | null): Promise<void> {
  if (!purchasesEnabled) return Promise.resolve();
  identified = (async () => {
    if (!configured) {
      if (!userId) return;
      Purchases.configure({ apiKey, appUserID: userId });
      configured = true;
    } else if (userId) {
      await Purchases.logIn(userId);
    } else {
      await Purchases.logOut().catch(() => {}); // already anonymous
    }
  })().catch((err) => console.warn('RevenueCat identify failed', err));
  return identified;
}

export function useOfferings() {
  return useQuery({
    queryKey: ['offerings'],
    enabled: purchasesEnabled,
    queryFn: async (): Promise<PurchasesPackage[]> => {
      await identified;
      const offerings = await Purchases.getOfferings();
      return offerings.current?.availablePackages ?? [];
    },
  });
}

async function refreshPlan(queryClient: ReturnType<typeof useQueryClient>) {
  const { error } = await supabase.functions.invoke('plan-refresh');
  if (error) console.warn('plan-refresh failed; the webhook will catch up', error);
  await queryClient.invalidateQueries({ queryKey: ['plan'] });
}

export function useBuy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ pkg, plan }: { pkg: PurchasesPackage; plan: PaidPlan }): Promise<'bought' | 'cancelled'> => {
      await identified;
      // Play replaces a running plan; Test Store keys (test_…) have no Play subscription to replace.
      const info = apiKey.startsWith('test_') ? null : productChange((await Purchases.getCustomerInfo()).activeSubscriptions, plan);
      try {
        await Purchases.purchasePackage(
          pkg,
          null,
          info && {
            oldProductIdentifier: info.oldProductIdentifier,
            prorationMode: info.upgrade
              ? PRORATION_MODE.IMMEDIATE_WITH_TIME_PRORATION
              : PRORATION_MODE.DEFERRED,
          },
        );
      } catch (err) {
        if ((err as { code?: string }).code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) return 'cancelled';
        throw err;
      }
      await refreshPlan(queryClient);
      return 'bought';
    },
  });
}

export function useRestore() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await identified;
      await Purchases.restorePurchases();
      await refreshPlan(queryClient);
    },
  });
}

/** Cancelling and changing payment happen in the store. */
export async function manageSubscriptionsUrl(): Promise<string> {
  const info = await Purchases.getCustomerInfo().catch(() => null);
  return info?.managementURL || 'https://play.google.com/store/account/subscriptions?package=com.tusky.app';
}
```

Before moving on, open `node_modules/react-native-purchases/dist/purchases.d.ts` and check three names against the installed version: `PRORATION_MODE` (newer versions may call it `GOOGLE_PRORATION_MODE`), `PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR`, and `purchasePackage`'s third parameter (`GoogleProductChangeInfo`). If one differs, use the installed name; the behavior stays the same.

- [ ] **Step 4: Identify the RevenueCat user with the session**

In `apps/mobile/src/app/_layout.tsx`, add `import { identifyPurchaser } from '@/lib/purchases';` and, in the component that calls `useSession()` (line 84), after that line:

```tsx
  const userId = session?.user.id ?? null;
  // RevenueCat's user follows the Supabase user (Phase 14c).
  useEffect(() => {
    void identifyPurchaser(userId);
  }, [userId]);
```

Import `useEffect` from `react` if the file does not already.

- [ ] **Step 5: Typecheck and lint**

Run (inside `apps/mobile`): `npm run typecheck && npx expo lint`
Expected: clean.

- [ ] **Step 6: Rebuild the dev client** (a native module was added; hot reload is not enough)

Kill whatever listens on 8081, then (inside `apps/mobile`, `JAVA_HOME` pointed at `~/.gradle/jdks/eclipse_adoptium-17-amd64-windows.2`): `npx expo run:android --device Pixel_7`
Expected: the app opens on the emulator and signs in as before. `node scripts/emu.mjs logs` shows no "Cannot find native module". With `EXPO_PUBLIC_REVENUECAT_KEY` still empty, nothing calls RevenueCat.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/src/lib/purchases.ts apps/mobile/src/app/_layout.tsx apps/mobile/.env.example
git commit -m "feat(app): RevenueCat follows the signed-in user (Phase 14c)"
```

---

### Task 5: The paywall

**Files:**
- Create: `apps/mobile/src/app/paywall.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx` (register the route)
- Modify: `apps/mobile/src/lib/queries.ts` (add `usePlanLimits`, extend `usePlan`, add `useHerdPayer`)
- Modify: `apps/mobile/src/lib/plan-banner.ts` (no change to logic; `PlanInfo` stays the base type)

**Interfaces:**
- Consumes: `paywallTiers`, `planSummary`, `herdPayer`, `PLAN_NAMES`, `PlanDetail`, `PlanLimits`, `PaidPlan` (Task 3); `purchasesEnabled`, `useOfferings`, `useBuy`, `useRestore` (Task 4); `useHerd` (existing, `lib/queries.ts`).
- Produces:
  ```ts
  export function usePlan(userId: string | undefined): UseQueryResult<PlanDetail>;   // key ['plan'], now with status and store
  export function usePlanLimits(): UseQueryResult<PlanLimits[]>;                    // key ['plans']
  export function useHerdPayer(userId: string | undefined, enabled: boolean): UseQueryResult<string | null>; // key ['plan', 'payer']
  ```
  Route `/paywall`, presented as a modal. Task 6 opens it from the Plan screen, the banners and a plan-limit refusal.

- [ ] **Step 1: Extend the plan queries** in `lib/queries.ts`

Replace `usePlan` (line 896) and add the two new hooks after it. Add `import type { PlanDetail, PlanLimits } from '@/lib/paywall';` and `import { herdPayer } from '@/lib/paywall';` at the top, and drop the now-unused `PlanInfo` import if nothing else uses it.

```ts
/** The signed-in user's plan (Phase 14): my_plan() plus their own row's window, status and store. */
export function usePlan(userId: string | undefined) {
  return useQuery({
    queryKey: ['plan'],
    enabled: !!userId,
    queryFn: async (): Promise<PlanDetail> => {
      const [plan, sub] = await Promise.all([
        supabase.rpc('my_plan').single(),
        supabase.from('subscriptions').select('over_limit_since, status, store').eq('user_id', userId!).maybeSingle(),
      ]);
      if (plan.error) throw plan.error;
      if (sub.error) throw sub.error;
      return {
        ...(plan.data as Omit<PlanDetail, 'over_limit_since' | 'status' | 'store'>),
        over_limit_since: sub.data?.over_limit_since ?? null,
        status: sub.data?.status ?? null,
        store: sub.data?.store ?? null,
      };
    },
  });
}

/** Every plan's limits (Phase 14c): the paywall's lines come from here, not from the app. */
export function usePlanLimits() {
  return useQuery({
    queryKey: ['plans'],
    queryFn: async (): Promise<PlanLimits[]> => {
      const { data, error } = await supabase.from('plans').select('id, max_banks, history_days, scope').order('rank');
      if (error) throw error;
      return data as PlanLimits[];
    },
  });
}

/** Who pays for the herd's Tusk Herd. RLS shows me only herd mates' Tusk Herd rows. */
export function useHerdPayer(userId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['plan', 'payer'],
    enabled: !!userId && enabled,
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('subscriptions').select('user_id, status, expires_at').eq('plan', 'tusk_herd');
      if (error) throw error;
      return herdPayer(data ?? [], userId!, new Date());
    },
  });
}
```

- [ ] **Step 2: Write the paywall screen**

`apps/mobile/src/app/paywall.tsx`:

```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chips } from '@/components/ui/chips';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { paywallTiers, planSummary } from '@/lib/paywall';
import { purchasesEnabled, useBuy, useOfferings, useRestore } from '@/lib/purchases';
import { useHerd, useHerdPayer, usePlan, usePlanLimits } from '@/lib/queries';
import { useSession } from '@/lib/session';

type Period = 'monthly' | 'yearly';

/**
 * Plans (Phase 14c). Prices are the store's, limits are the `plans` table's,
 * and what a purchase grants is decided by the server after RevenueCat says so.
 */
export default function PaywallScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const userId = session?.user.id;
  const { data: plan } = usePlan(userId);
  const { data: limits = [] } = usePlanLimits();
  const { data: packages = [], isLoading, error } = useOfferings();
  const { data: herd } = useHerd();
  const { data: payerId = null } = useHerdPayer(userId, plan?.source === 'herd');
  const buy = useBuy();
  const restore = useRestore();
  const [period, setPeriod] = useState<Period>('yearly');

  const tiers = paywallTiers(packages, limits);
  const payerName = herd?.members.find((m) => m.user_id === payerId)?.display_name ?? null;
  const failed = (title: string) => (err: Error) => Alert.alert(title, err.message);

  if (!purchasesEnabled || error || (!isLoading && tiers.length === 0)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, padding: Spacing.md }}>
        <Card style={{ gap: Spacing.xs }}>
          <AppText variant="section">Plans are coming soon</AppText>
          <AppText tone="dim">Everything you have tracked stays here in the meantime.</AppText>
        </Card>
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.md }}>
      <AppText variant="display">Keep your banks connected</AppText>
      <AppText tone="dim">Every plan opens every feature. They differ in how many banks stay connected.</AppText>

      {plan?.source === 'herd' ? (
        <Card style={{ gap: Spacing.xs }}>
          <AppText variant="section">You are already covered</AppText>
          <AppText tone="dim">{planSummary(plan, new Date(), payerName).detail}. You do not need a plan of your own.</AppText>
        </Card>
      ) : null}

      <Chips
        options={[
          { value: 'monthly', label: 'Monthly' },
          { value: 'yearly', label: 'Yearly' },
        ]}
        value={period}
        onChange={(v) => setPeriod(v as Period)}
      />

      {tiers.map((tier) => {
        const pkg = tier[period] ?? tier.monthly ?? tier.yearly;
        const current = plan?.source === 'own' && plan.plan === tier.plan && plan.status !== 'expired';
        return (
          <Card key={tier.plan} style={{ gap: Spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <AppText variant="section">{tier.name}</AppText>
              {pkg ? (
                <AppText variant="label">
                  {pkg.product.priceString} / {pkg === tier.yearly ? 'year' : 'month'}
                </AppText>
              ) : null}
            </View>
            {tier.lines.map((line) => (
              <AppText key={line} tone="dim">
                {line}
              </AppText>
            ))}
            <Button
              title={current ? 'Your plan' : `Choose ${tier.name}`}
              disabled={current || !pkg || buy.isPending}
              loading={buy.isPending && buy.variables?.plan === tier.plan}
              onPress={() =>
                pkg &&
                buy.mutate(
                  { pkg, plan: tier.plan },
                  {
                    onSuccess: (r) => r === 'bought' && router.back(),
                    onError: failed('Could not complete the purchase'),
                  },
                )
              }
            />
          </Card>
        );
      })}

      <Button
        title="Restore purchases"
        variant="secondary"
        loading={restore.isPending}
        onPress={() => restore.mutate(undefined, { onError: failed('Could not restore purchases') })}
      />
      <AppText variant="caption" tone="dim">
        Subscriptions renew until you cancel them in the Play Store.
      </AppText>
    </ScrollView>
  );
}
```

Before writing, open `components/ui/chips.tsx` and `components/ui/button.tsx` and match their real props (`options`/`value`/`onChange`, `variant`, `loading`, `disabled`). If `Chips` takes different names, use them; if it cannot do a single choice, use two `Button`s with `variant="secondary"` for the unselected period.

- [ ] **Step 3: Register the route** in `_layout.tsx`, after the `join/[code]` screen:

```tsx
        <Stack.Screen name="paywall" options={{ headerShown: true, title: 'Plans', presentation: 'modal' }} />
```

- [ ] **Step 4: Typecheck, lint, test**

Run (inside `apps/mobile`): `npm run typecheck && npx expo lint && npm test`
Expected: clean; all tests pass.

- [ ] **Step 5: Look at it on the emulator** (keys still empty)

Run: `adb shell am start -a android.intent.action.VIEW -d "tusky:///paywall" com.tusky.app`, then `node scripts/emu.mjs ui`.
Expected: "Plans are coming soon" and no crash in `node scripts/emu.mjs logs`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/app/paywall.tsx apps/mobile/src/app/_layout.tsx apps/mobile/src/lib/queries.ts
git commit -m "feat(app): a paywall built from the store's prices and the plans table (Phase 14c)"
```

---

### Task 6: The Plan screen, and the ways into the paywall

**Files:**
- Create: `apps/mobile/src/app/plan.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx` (register `plan`)
- Modify: `apps/mobile/src/app/(tabs)/settings.tsx` (a Plan row; "See plans" after a plan-limit refusal)
- Modify: `apps/mobile/src/components/plan-banner.tsx` (tap opens the paywall)
- Modify: `apps/mobile/src/lib/plaid.ts` (`useConnectBank` reports a plan-limit refusal)
- Modify: `apps/mobile/src/lib/plans.ts` and `apps/mobile/src/lib/plans.test.ts` (copy no longer says "coming soon")

**Interfaces:**
- Consumes: `planSummary`, `bankUsage`, `PLAN_NAMES` (Task 3); `manageSubscriptionsUrl`, `useRestore`, `purchasesEnabled` (Task 4); `usePlan`, `useHerdPayer`, `useHerd` (Task 5).
- Produces: route `/plan`. `useConnectBank()` now returns `{ connectBank, isConnecting, error, planLimited: boolean }`.

- [ ] **Step 1: Update the refusal copy and its tests**

In `lib/plans.test.ts`, change the expectations:

```ts
test('a finished trial says so', () => {
  assert.equal(
    planLimitMessage('free', 0),
    'Your free trial has ended, so Tusky can no longer connect banks. Your history is still here.',
  );
});
```

and in the paid-plan test, expect `'Your plan connects up to 3 banks, and you have reached it. Disconnect one, or choose a bigger plan.'` (and the `1 bank` form the same way). Run `npm test` inside `apps/mobile`: the two tests FAIL.

In `lib/plans.ts`:

```ts
  if (plan === 'free') {
    return 'Your free trial has ended, so Tusky can no longer connect banks. Your history is still here.';
  }
  if (typeof maxBanks === 'number' && maxBanks > 0) {
    const banks = maxBanks === 1 ? '1 bank' : `${maxBanks} banks`;
    return `Your plan connects up to ${banks}, and you have reached it. Disconnect one, or choose a bigger plan.`;
  }
  return 'Your plan has reached its bank limit. Disconnect one, or choose a bigger plan.';
```

Run `npm test`: PASS.

- [ ] **Step 2: Report a plan-limit refusal from `useConnectBank`** (`lib/plaid.ts`)

Add `const [planLimited, setPlanLimited] = useState(false);` beside `error`, call `setPlanLimited(false)` next to `setError(null)` at the start of `connectBank`, and `setPlanLimited(true)` on the line before each of the two `throw new Error(planLimitMessage(...))` calls. Return `{ connectBank, isConnecting, error, planLimited }`.

- [ ] **Step 3: Write the Plan screen**

`apps/mobile/src/app/plan.tsx`:

```tsx
import { router } from 'expo-router';
import { Alert, Linking, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlanBanner } from '@/components/plan-banner';
import { AppText } from '@/components/ui/app-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { bankUsage, planSummary } from '@/lib/paywall';
import { manageSubscriptionsUrl, purchasesEnabled, useRestore } from '@/lib/purchases';
import { useHerd, useHerdPayer, usePlan } from '@/lib/queries';
import { useSession } from '@/lib/session';

/** Your plan (Phase 14c): what it is, where it comes from, and how many banks it holds. */
export default function PlanScreen() {
  const colors = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useSession();
  const userId = session?.user.id;
  const { data: plan } = usePlan(userId);
  const { data: herd } = useHerd();
  const { data: payerId = null } = useHerdPayer(userId, plan?.source === 'herd');
  const restore = useRestore();

  if (!plan) return <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} />;

  const payerName = herd?.members.find((m) => m.user_id === payerId)?.display_name ?? null;
  const summary = planSummary(plan, new Date(), payerName);
  const paysForHerd = plan.source === 'own' && plan.plan === 'tusk_herd' && plan.status !== 'expired';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: Spacing.md, paddingBottom: insets.bottom + Spacing.xl, gap: Spacing.md }}>
      <PlanBanner userId={userId} />
      <Card style={{ gap: Spacing.xs }}>
        <AppText variant="display">{summary.title}</AppText>
        <AppText tone="dim">{summary.detail}</AppText>
        <AppText variant="label" style={{ marginTop: Spacing.sm }}>
          {bankUsage(plan.banks_used, plan.max_banks)}
        </AppText>
      </Card>

      <Button title="See plans" onPress={() => router.push('/paywall')} />
      {paysForHerd ? (
        <Button title="Invite someone to your herd" variant="secondary" onPress={() => router.push('/herd')} />
      ) : null}
      {plan.source === 'own' && plan.store === 'play' ? (
        <Button
          title="Manage subscription"
          variant="secondary"
          onPress={async () => Linking.openURL(await manageSubscriptionsUrl())}
        />
      ) : null}
      {purchasesEnabled ? (
        <Button
          title="Restore purchases"
          variant="secondary"
          loading={restore.isPending}
          onPress={() =>
            restore.mutate(undefined, { onError: (err) => Alert.alert('Could not restore purchases', err.message) })
          }
        />
      ) : null}
      <AppText variant="caption" tone="dim">
        Cancel or change payment in the Play Store. Everything you have tracked stays in Tusky whatever your plan.
      </AppText>
    </ScrollView>
  );
}
```

Register it in `_layout.tsx`, before the `paywall` screen:

```tsx
        <Stack.Screen name="plan" options={{ headerShown: true, title: 'Plan' }} />
```

- [ ] **Step 4: Open the Plan screen from Settings, and the paywall after a refusal**

In `settings.tsx`, inside the card that holds the herd row (after the herd `Pressable`, before `</Card>` at line ~153), add a row with the same shape as the herd row. Import `CreditCard` from `lucide-react-native` beside `Users`, and `bankUsage`, `PLAN_NAMES` from `@/lib/paywall`, and read `const { data: plan } = usePlan(session?.user.id);` beside the other queries:

```tsx
        <Pressable
          onPress={() => router.push('/plan')}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: Spacing.sm,
            paddingVertical: Spacing.xs,
            backgroundColor: pressed ? colors.elevated : 'transparent',
          })}>
          <CreditCard size={20} color={colors.brand} strokeWidth={1.75} />
          <View style={{ flex: 1 }}>
            <AppText variant="label">{plan ? PLAN_NAMES[plan.plan] : ' '}</AppText>
            <AppText variant="caption" tone="dim">
              {plan ? `Your plan · ${bankUsage(plan.banks_used, plan.max_banks)}` : ' '}
            </AppText>
          </View>
          <ChevronRight size={18} color={colors.textDim} strokeWidth={1.75} />
        </Pressable>
```

Take `planLimited` from `useConnectBank()` (line 44). Where `settings.tsx` renders `error` (find it with `grep -n "error" "apps/mobile/src/app/(tabs)/settings.tsx"`), add directly after that error text:

```tsx
        {planLimited ? <Button title="See plans" variant="secondary" onPress={() => router.push('/paywall')} /> : null}
```

- [ ] **Step 5: Let the banner open the paywall** (`components/plan-banner.tsx`)

Wrap the `Card` in `Pressable` with `onPress={() => router.push('/paywall')}` and `accessibilityRole="button"`, import `router` from `expo-router` and `Pressable` from `react-native`, and add under the body:

```tsx
      <AppText variant="caption" tone="brand">
        See plans
      </AppText>
```

If `AppText` has no `tone="brand"`, check `components/ui/app-text.tsx` for the tone that uses `colors.brand` and use that.

- [ ] **Step 6: Typecheck, lint, test**

Run (inside `apps/mobile`): `npm run typecheck && npx expo lint && npm test`
Expected: clean; all pass.

- [ ] **Step 7: Look at it on the emulator**

Metro hot-reloads. `node scripts/emu.mjs tap "Settings"`, then `node scripts/emu.mjs ui`: a row "Tusk" / "Your plan · N of 10 banks", N being the test user's live banks (the test user is comp Tusk). Tap it: "Tusk", "Complimentary", "See plans". No crash in `node scripts/emu.mjs logs`.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/app/plan.tsx apps/mobile/src/app/_layout.tsx "apps/mobile/src/app/(tabs)/settings.tsx" apps/mobile/src/components/plan-banner.tsx apps/mobile/src/lib/plaid.ts apps/mobile/src/lib/plans.ts apps/mobile/src/lib/plans.test.ts
git commit -m "feat(app): a Plan screen, and every refusal and warning leads to the paywall (Phase 14c)"
```

---

### Task 7: RevenueCat setup and live verification on dev

This task needs Pedro for Step 1. Everything after it runs against dev only.

- [ ] **Step 1: Pedro sets up RevenueCat** (ask for this; do not guess keys)

1. Create a RevenueCat account (free tier) and one project, "Tusky".
2. **Test Store:** Project settings → Apps → Test Store. Create six products: `tusklet_monthly` ($3.99/mo), `tusklet_yearly` ($45/yr), `tusk_monthly` ($6.99/mo), `tusk_yearly` ($75/yr), `tusk_herd_monthly` ($9.99/mo), `tusk_herd_yearly` ($99/yr).
3. **Entitlements** `tusklet`, `tusk`, `tusk_herd`, each attached to its two products.
4. **Offering** `default` (current), with six custom packages whose identifiers are the product names above.
5. **Webhook:** Integrations → Webhooks → URL `https://ifibrsgqdibcomzxencf.supabase.co/functions/v1/revenuecat-webhook`, limited to the Test Store app, with an Authorization header value (a long random string).
6. Put the Test Store public key in `apps/mobile/.env` as `EXPO_PUBLIC_REVENUECAT_KEY`.
7. Set the dev function secrets one at a time, without printing values (never `--env-file`: that file holds production keys):
   `npx supabase secrets set REVENUECAT_SECRET_KEY=<v1 secret key>` and `npx supabase secrets set REVENUECAT_WEBHOOK_SECRET=<the header value>`.

- [ ] **Step 2: Push the migration and deploy to dev**

```bash
npx supabase db push
npx supabase functions deploy revenuecat-webhook --use-api
npx supabase functions deploy plan-refresh --use-api
```

Expected: the migration `20261010120000` applies; both functions deploy.

- [ ] **Step 3: The webhook refuses strangers**

Run: `curl -s -o /dev/null -w "%{http_code}" -X POST https://ifibrsgqdibcomzxencf.supabase.co/functions/v1/revenuecat-webhook -d '{}'`
Expected: `401`. Then RevenueCat → Webhooks → "Send test event". Expected: RevenueCat shows 200, and the function log says `no Tusky user in event`.

- [ ] **Step 4: Put the test user on a trial**

Save their row first, then set it (linked-DB SQL, as in 14b):

```sql
select plan, store, status, expires_at from subscriptions where user_id = (select id from auth.users where email = 'ph.leao2099+tuskytest@gmail.com');
update subscriptions set plan = 'trial', store = 'trial', status = 'active', expires_at = now() + interval '2 days'
where user_id = (select id from auth.users where email = 'ph.leao2099+tuskytest@gmail.com');
```

Restart Metro (the new key bakes in at start), reload the app. Expected: Home shows "Your trial ends in 2 days" with "See plans".

- [ ] **Step 5: Buy Tusklet monthly through the Test Store**

Tap the banner, choose Monthly, tap "Choose Tusklet", and pick the successful purchase in RevenueCat's test dialog. Expected: the paywall closes, and Settings shows "Tusklet" / "Your plan · 2 of 3 banks" without a reload. In SQL, the row is `tusklet, test, active` with an `expires_at` about a month out, and `over_limit_since` untouched. If `store` is not `test` and the row did not change, read the `revenuecat-webhook` logs for the store RevenueCat reported (Review Focus 4) and fix `storeOf`.

- [ ] **Step 6: Upgrade, restore, cancel**

- Buy Tusk yearly. Expected: "Tusk", "Paid through <a year out>".
- Tap "Restore purchases" on the Plan screen. Expected: no error, plan unchanged.
- RevenueCat → the customer → expire or refund the Test Store subscription (whichever the dashboard offers). Expected within a minute: the row is `tusk, test, expired`, and after a pull on Home the Plan screen reads "Free" with "No banks on this plan"; the trial does not come back.
- Tap "Choose Tusklet" and pick the **cancel** option in the dialog. Expected: no error alert, the paywall stays open.

- [ ] **Step 7: Herd coverage and the invite link**

Set the test user's row by SQL to `tusk_herd, test, active, now() + interval '30 days'`, pull on Home, and check the Plan screen shows "Tusk Herd" and "Invite someone to your herd". (Coverage as seen by a herd mate is `herdPayer`, unit-tested in Task 3; do not join Kel Test into the herd for this.) Tap it, create an invite, and open the shared link on the emulator: `adb shell am start -a android.intent.action.VIEW -d "tusky:///join/<code>" com.tusky.app`. Expected: the invite screen opens with that herd's name. Revoke the invite afterwards.

- [ ] **Step 8: Restore the test user and check nothing leaked**

Put the saved row back (`tusk, comp, active, null` unless it differed). Run `node scripts/rls-check.mjs`. Expected: all PASS.

---

### Task 8: Docs, handoff, PR

**Files:**
- Modify: `CLAUDE.md` (the Plans bullet; the Phase line at the top)
- Modify: `docs/ops/production.md` (a "RevenueCat" paragraph)
- Create: `docs/superpowers/plans/2026-09-28-phase-14c-handoff.md`

- [ ] **Step 1: CLAUDE.md**

Under the **Plans (Phase 14a)** bullet, add:

```md
  - **Purchases (14c).** RevenueCat's app user id is the Supabase user id. Only the server grants a
    plan: `revenuecat-webhook` (public; `Authorization` compared with `REVENUECAT_WEBHOOK_SECRET`) and
    `plan-refresh` (the app, after a purchase or restore) both run `syncSubscriber` in
    `_shared/revenuecat.ts`, which re-fetches the subscriber from RevenueCat and never reads the event
    body beyond its ids. It never changes a `comp` row, changes a trial only for a live purchase, and
    never writes `over_limit_since`. Dev buys through RevenueCat's Test Store (store `test`, accepted
    only where `PLAID_ENV=sandbox`). `EXPO_PUBLIC_PROD_REVENUECAT_KEY` stays empty until launch, so
    production's paywall says plans are coming soon.
```

In the Phase line at the top, add after the milestones: "14c (purchases) is on `pedro-14c`."

- [ ] **Step 2: `docs/ops/production.md`**

Add a **RevenueCat (Phase 14c)** paragraph: production gets its own webhook in the same RevenueCat project, limited to the Play app, pointing at `https://awiwcgrisyzimzxgddxu.supabase.co/functions/v1/revenuecat-webhook`; the production secrets `REVENUECAT_SECRET_KEY` and `REVENUECAT_WEBHOOK_SECRET` are set with `--project-ref awiwcgrisyzimzxgddxu`, one at a time; and `EXPO_PUBLIC_PROD_REVENUECAT_KEY` stays empty until launch.

- [ ] **Step 3: The handoff**

`docs/superpowers/plans/2026-09-28-phase-14c-handoff.md`, in the shape of the 14b handoff: what shipped (Tasks 1–6), dev state (migration, deployed functions, secrets set without printing values, the test user restored), what was verified in Task 7 with the real outputs, and **Waits on Pedro**:
1. The Play Console: create the `tusklet`, `tusk`, `tusk_herd` subscriptions with `monthly` and `yearly` base plans at the spec's prices, link Play to RevenueCat (service account), and attach the Play products to the same entitlements and packages.
2. **Where Play purchases are tested.** Play Billing needs a build from the internal testing track, and release builds talk to production. Either test against production (needs its 14a–14c push and a production RevenueCat key in that build only), or ship an internal-track build that uses the dev backend. Pedro chooses.
3. Production: push the migration, deploy `revenuecat-webhook` and `plan-refresh`, set the two secrets.

- [ ] **Step 4: Final checks**

Run: `npx -y deno test --allow-env supabase/functions/_shared/` (repo root) and `npm run typecheck && npx expo lint && npm test` (inside `apps/mobile`).
Expected: all pass, and the handoff quotes the counts.

- [ ] **Step 5: Commit, push, open the PR** (never merge: Pedro merges)

```bash
git add CLAUDE.md docs/ops/production.md docs/superpowers/plans/2026-09-28-phase-14c-handoff.md
git commit -m "docs: Phase 14c handoff, and purchases in CLAUDE.md"
git push -u origin pedro-14c
gh pr create --base pedro-14b --title "Phase 14c: purchases (RevenueCat, Plan screen, paywall)" --body-file docs/superpowers/plans/2026-09-28-phase-14c-handoff.md
```

If 14b has merged into `master` by then, use `--base master` instead.
