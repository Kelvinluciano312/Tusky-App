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
    return { title, detail: "Your payment didn't go through. Update it in the Play Store to keep your banks." };
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

/**
 * Play replaces a running subscription instead of adding a second one. Active
 * ids look like `tusk:monthly`; the old product is the part before the colon.
 */
export function productChange(
  active: string[],
  target: string,
): { oldProductIdentifier: string; upgrade: boolean } | null {
  const old = active.map((id) => id.split(':')[0]).find((id): id is PaidPlan => (ORDER as string[]).includes(id));
  if (!old) return null;
  return { oldProductIdentifier: old, upgrade: ORDER.indexOf(target as PaidPlan) > ORDER.indexOf(old) };
}
