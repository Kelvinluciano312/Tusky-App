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
  if (!PURCHASED.has(current.store) || ours.length === 0) return null;
  const last = ours.reduce((a, b) => (Date.parse(b.until ?? '') > Date.parse(a.until ?? '') ? b : a));
  return { plan: last.plan, store: last.store, status: 'expired', expires_at: last.until };
}
