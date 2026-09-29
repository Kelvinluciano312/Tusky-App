import { assertEquals } from 'jsr:@std/assert';

import {
  eventUserIds,
  type RcClient,
  type RcSubscriber,
  type SubRow,
  type SubStore,
  subscriptionFromRc,
  syncSubscriber,
} from './revenuecat.ts';

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

Deno.test('a record emptied by a transfer expires the row we wrote, from now', () => {
  const row: SubRow = { plan: 'tusk', store: 'play', status: 'active', expires_at: FUTURE };
  assertEquals(subscriptionFromRc(sub({}), row, NOW, false), {
    plan: 'tusk', store: 'play', status: 'expired', expires_at: NOW.toISOString(),
  });
});

Deno.test('syncSubscriber: after a restore elsewhere, the old account loses the plan', async () => {
  const db = memoryStore({ [U1]: { plan: 'tusk_herd', store: 'play', status: 'active', expires_at: FUTURE } });
  assertEquals(await syncSubscriber(db, rcWith(sub({})), U1, NOW, false), 'written');
  assertEquals(db.writes[0][1].status, 'expired');
});
