/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  activePeriod,
  afterPurchase,
  bankUsage,
  deleteWarning,
  herdPayer,
  offeringsErrorDetail,
  ownPaidPlan,
  periodOf,
  type PlanDetail,
  planSummary,
  paywallTiers,
  productChange,
  storeName,
  tierAction,
} from './paywall.ts';

const NOW = new Date('2026-10-10T12:00:00Z');
const detail = (over: Partial<PlanDetail>): PlanDetail => ({
  plan: 'tusk', source: 'own', expires_at: null, max_banks: 10, banks_used: 2, over_limit_since: null,
  status: 'active', store: 'play', own_plan: 'tusk', own_expires_at: null, ...over,
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

test('buying over an active Play plan: rank decides, and monthly to yearly is an upgrade', () => {
  assert.deepEqual(productChange(['tusklet:monthly'], 'tusk', 'monthly'), { oldProductIdentifier: 'tusklet', upgrade: true });
  assert.deepEqual(productChange(['tusk_herd:yearly'], 'tusk', 'yearly'), { oldProductIdentifier: 'tusk_herd', upgrade: false });
  assert.deepEqual(productChange(['tusk:monthly'], 'tusk', 'yearly'), { oldProductIdentifier: 'tusk', upgrade: true });
  assert.deepEqual(productChange(['tusk:yearly'], 'tusk', 'monthly'), { oldProductIdentifier: 'tusk', upgrade: false });
  assert.equal(productChange(['tusk:monthly'], 'tusk', 'monthly'), null);
  assert.equal(productChange([], 'tusk', 'monthly'), null);
  assert.equal(productChange(['something_else'], 'tusk', 'monthly'), null);
  // One Play subscription per plan and period (tusk_monthly:<base plan>).
  assert.deepEqual(productChange(['tusk_monthly:p1m'], 'tusk', 'yearly'), { oldProductIdentifier: 'tusk_monthly', upgrade: true });
  assert.deepEqual(productChange(['tusk_herd_yearly:yearly'], 'tusklet', 'yearly'), { oldProductIdentifier: 'tusk_herd_yearly', upgrade: false });
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
  assert.equal(periodOf('tusk_monthly:monthly'), 'monthly');
  assert.equal(periodOf('tusk_herd_yearly:base'), 'yearly');
  assert.equal(activePeriod(['tusk_yearly:p1y'], 'tusk'), 'yearly');
  assert.equal(periodOf('tusk_herd_yearly_v2'), 'yearly');
  assert.equal(activePeriod(['tusk_monthly_v2'], 'tusk'), 'monthly');
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

test('a plan I pay for myself shows even while a herd mate covers me', () => {
  const covered = detail({ plan: 'tusk_herd', source: 'herd', own_plan: 'tusklet', own_expires_at: '2026-11-01T00:00:00Z' });
  assert.equal(ownPaidPlan({ ...covered, store: 'play', status: 'active' }, NOW), 'tusklet');
});

test('trial, comp, lapsed and expired rows are not a paid plan of my own', () => {
  assert.equal(ownPaidPlan(detail({ store: 'trial', own_plan: 'trial' }), NOW), null);
  assert.equal(ownPaidPlan(detail({ store: 'comp' }), NOW), null);
  assert.equal(ownPaidPlan(detail({ status: 'expired' }), NOW), null);
  assert.equal(ownPaidPlan(detail({ own_plan: 'tusk', own_expires_at: '2026-10-09T00:00:00Z' }), NOW), null);
  assert.equal(ownPaidPlan(detail({ status: 'grace', own_expires_at: '2026-10-12T00:00:00Z' }), NOW), 'tusk');
});

test("a failed offerings load names RevenueCat's message and code", () => {
  assert.equal(
    offeringsErrorDetail({
      message: 'There is an issue with your configuration.',
      underlyingErrorMessage: 'None of the products registered in the RevenueCat dashboard could be fetched.',
      readableErrorCode: 'CONFIGURATION_ERROR',
      code: '23',
    }),
    'There is an issue with your configuration. None of the products registered in the RevenueCat dashboard could be fetched. (CONFIGURATION_ERROR)',
  );
  assert.equal(offeringsErrorDetail({ message: 'Same', underlyingErrorMessage: 'Same', code: 10 }), 'Same (10)');
  assert.equal(offeringsErrorDetail(new Error('Network down')), 'Network down');
  assert.equal(offeringsErrorDetail(null), 'Unknown error.');
});
