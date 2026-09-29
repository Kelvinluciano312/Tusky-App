import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

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
    const billing = sub.billing_issues_detected_at !== null ||
      (e.expires_date !== null && Date.parse(e.expires_date) <= now.getTime());
    return [{ plan, store, until, live, billing }];
  });

  const live = ours.find((x) => x.live);
  if (live) {
    return { plan: live.plan, store: live.store, status: live.billing ? 'grace' : 'active', expires_at: live.until };
  }
  if (!PURCHASED.has(current.store)) return null;
  if (ours.length === 0) {
    // Nothing of ours left: a restore moved the purchase to another account.
    // The client throws on any failed fetch, so an outage never looks like this.
    const ended = current.expires_at !== null && Date.parse(current.expires_at) < now.getTime()
      ? current.expires_at
      : now.toISOString();
    return { ...current, status: 'expired', expires_at: ended };
  }
  const last = ours.reduce((a, b) => (Date.parse(b.until ?? '') > Date.parse(a.until ?? '') ? b : a));
  return { plan: last.plan, store: last.store, status: 'expired', expires_at: last.until };
}

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
  (a.expires_at === null
    ? b.expires_at === null
    : b.expires_at !== null && Date.parse(a.expires_at) === Date.parse(b.expires_at));

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
