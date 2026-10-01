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

/** The effective plan, plus my own `subscriptions` row: its status, store, plan and expiry. */
export type PlanDetail = PlanInfo & {
  status: string | null;
  store: string | null;
  own_plan: string | null;
  own_expires_at: string | null;
};
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
    return { title, detail: `Your payment didn't go through. Update it in the ${storeName(p.store)} to keep your banks.` };
  }
  return { title, detail: p.expires_at ? `Paid through ${shortDate(p.expires_at)}` : 'Active' };
}

const BOUGHT = new Set(['play', 'app_store', 'test']);

/**
 * The plan I pay for myself, if it is still running. It can differ from the
 * effective plan: a herd mate's Tusk Herd outranks my own Tusklet, and I still
 * need to find my own subscription to cancel it.
 */
export function ownPaidPlan(p: PlanDetail, now: Date): string | null {
  if (!p.own_plan || !p.store || !BOUGHT.has(p.store)) return null;
  if (p.status !== 'active' && p.status !== 'grace') return null;
  if (p.own_expires_at !== null && Date.parse(p.own_expires_at) <= now.getTime()) return null;
  return p.own_plan;
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

export type Period = 'monthly' | 'yearly';

export function storeName(store: string | null): 'Play Store' | 'App Store' {
  return store === 'app_store' ? 'App Store' : 'Play Store';
}

/** A store product id can't be reused once deleted, so a remade one gets a `_v2` suffix. */
const PERIOD_SUFFIX = /_(monthly|yearly)(?:_v\d+)?$/;

/**
 * `tusk:yearly` or `tusk_yearly:<base plan>` (Play: subscription, then base
 * plan), or `tusk_yearly` / `tusk_yearly_v2` (App Store, Test Store).
 */
export function periodOf(productId: string): Period | null {
  const [sub, basePlan] = productId.split(':');
  const p = basePlan === 'monthly' || basePlan === 'yearly' ? basePlan : sub.match(PERIOD_SUFFIX)?.[1];
  return p === 'monthly' || p === 'yearly' ? p : null;
}

const baseOf = (productId: string) => productId.split(':')[0].replace(PERIOD_SUFFIX, '');

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
  // Play wants the subscription id without its base plan.
  return { oldProductIdentifier: id.split(':')[0], upgrade: rank > 0 || (rank === 0 && period === 'yearly') };
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

/**
 * What the paywall shows when the store's offerings fail to load. RevenueCat's
 * own message and code name the cause (Play credentials, a missing product,
 * a non-tester account), which "check your connection" never did.
 */
export function offeringsErrorDetail(err: unknown): string {
  const e = (err ?? {}) as { message?: unknown; underlyingErrorMessage?: unknown; readableErrorCode?: unknown; code?: unknown };
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const parts = [text(e.message), text(e.underlyingErrorMessage)].filter(Boolean);
  const message = [...new Set(parts)].join(' ') || 'Unknown error.';
  const code = text(e.readableErrorCode) || (e.code != null && e.code !== '' ? String(e.code) : '');
  return code ? `${message} (${code})` : message;
}
