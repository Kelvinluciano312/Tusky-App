/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CategoriesById } from './categories.ts';
import { buildPresets, estimateIncome, historyWindow, typicalByLine } from './presets.ts';

// A tiny taxonomy: the slugs the buckets name, plus one custom child and one unmapped group.
type Cat = { id: string; parent_id: string | null; slug: string | null; kind: 'expense' | 'income' | 'transfer'; name: string; hidden?: boolean };
const CATS: [string, Cat][] = [
  ['g-bills', { id: 'g-bills', parent_id: null, slug: 'bills_and_utilities', kind: 'expense', name: 'Bills & Utilities' }],
  ['g-transport', { id: 'g-transport', parent_id: null, slug: 'transportation', kind: 'expense', name: 'Transportation' }],
  ['g-shopping', { id: 'g-shopping', parent_id: null, slug: 'shopping', kind: 'expense', name: 'Shopping' }],
  ['g-loans', { id: 'g-loans', parent_id: null, slug: 'loan_payments', kind: 'expense', name: 'Loan Payments' }],
  ['g-food', { id: 'g-food', parent_id: null, slug: 'food_and_dining', kind: 'expense', name: 'Food & Dining' }],
  ['c-groceries', { id: 'c-groceries', parent_id: 'g-food', slug: 'groceries', kind: 'expense', name: 'Groceries' }],
  ['c-restaurants', { id: 'c-restaurants', parent_id: 'g-food', slug: 'restaurants_and_bars', kind: 'expense', name: 'Restaurants & Bars' }],
  ['c-gas', { id: 'c-gas', parent_id: 'g-transport', slug: 'gas', kind: 'expense', name: 'Gas' }],
  ['c-mine', { id: 'c-mine', parent_id: 'g-shopping', slug: null, kind: 'expense', name: 'My custom one' }],
  ['g-uncat', { id: 'g-uncat', parent_id: null, slug: 'uncategorized', kind: 'expense', name: 'Uncategorized' }],
  ['g-income', { id: 'g-income', parent_id: null, slug: 'income', kind: 'income', name: 'Income' }],
  ['g-travel', { id: 'g-travel', parent_id: null, slug: 'travel', kind: 'expense', name: 'Travel', hidden: true }],
  ['c-flights', { id: 'c-flights', parent_id: 'g-travel', slug: 'flights', kind: 'expense', name: 'Flights' }],
  ['c-hidden-gas', { id: 'c-hidden-gas', parent_id: 'g-transport', slug: 'gas_hidden', kind: 'expense', name: 'Hidden Gas', hidden: true }],
];
const byId = new Map(CATS) as unknown as CategoriesById;

const MONTHS = ['2026-06-01', '2026-07-01', '2026-08-01'];
/** A view row. `total` keeps the ledger sign, so an expense is negative. */
const row = (month: string, category_id: string, total: number) =>
  ({ month, category_id, iso_currency_code: 'USD', total, transaction_count: 1 });

test('historyWindow takes the 3 full months before the current one', () => {
  assert.deepEqual(historyWindow(new Date(2026, 8, 26)), { from: '2026-06-01', to: '2026-08-01' });
  // The 1st of a month is still inside that month: the window must not include it.
  assert.deepEqual(historyWindow(new Date(2026, 8, 1)), { from: '2026-06-01', to: '2026-08-01' });
  // January reaches back across the year boundary.
  assert.deepEqual(historyWindow(new Date(2026, 0, 15)), { from: '2025-10-01', to: '2025-12-01' });
});

test('typicalByLine takes the median per line, and rolls children into their group', () => {
  const rows = [
    row('2026-06-01', 'g-bills', -100), row('2026-07-01', 'g-bills', -900), row('2026-08-01', 'g-bills', -110),
    // Transportation is only ever spent through its child.
    row('2026-06-01', 'c-gas', -50), row('2026-07-01', 'c-gas', -70), row('2026-08-01', 'c-gas', -60),
  ];
  const typical = typicalByLine(rows, MONTHS, byId);
  // The 900 month is an outlier: the median ignores it.
  assert.equal(typical.get('g-bills'), 110);
  assert.equal(typical.get('g-transport'), 60);
});

test('typicalByLine counts a month with no spend as zero', () => {
  // The herd has data from June, so all three months count. Shopping was spent
  // in July alone: median(0, 300, 0) is 0, so it is not budgetable.
  const rows = [row('2026-06-01', 'g-bills', -100), row('2026-07-01', 'g-shopping', -300)];
  const typical = typicalByLine(rows, MONTHS, byId);
  assert.equal(typical.get('g-shopping') ?? 0, 0);
  assert.equal(typical.has('g-shopping'), false);
});

test('typicalByLine floors a refund-heavy line at zero, and skips uncategorized', () => {
  const rows = [
    row('2026-06-01', 'g-shopping', 40), row('2026-07-01', 'g-shopping', 30), row('2026-08-01', 'g-shopping', 20),
    row('2026-06-01', 'g-uncat', -80), row('2026-07-01', 'g-uncat', -80), row('2026-08-01', 'g-uncat', -80),
  ];
  const typical = typicalByLine(rows, MONTHS, byId);
  // Not budgetable, so it is left out of the map entirely, like a zero line.
  assert.equal(typical.get('g-shopping') ?? 0, 0);
  assert.equal(typical.has('g-shopping'), false);
  assert.equal(typical.has('g-uncat'), false);
});

test('typicalByLine splits Food & Dining into its categories, never the group', () => {
  const rows = [
    row('2026-06-01', 'c-groceries', -400), row('2026-07-01', 'c-groceries', -400), row('2026-08-01', 'c-groceries', -400),
    row('2026-06-01', 'c-restaurants', -100), row('2026-07-01', 'c-restaurants', -100), row('2026-08-01', 'c-restaurants', -100),
  ];
  const typical = typicalByLine(rows, MONTHS, byId);
  assert.equal(typical.has('g-food'), false);
  assert.equal(typical.get('c-groceries'), 400);
  assert.equal(typical.get('c-restaurants'), 100);
});

test('one full month of history still produces a budget', () => {
  // The herd's first transaction is in August. June and July are not zeros —
  // the herd did not exist yet, and counting them would median everything to 0.
  const typical = typicalByLine([row('2026-08-01', 'g-bills', -300)], MONTHS, byId);
  assert.equal(typical.get('g-bills'), 300);
});

test('two months of history take the median of the months that have data', () => {
  const rows = [row('2026-07-01', 'g-bills', -200), row('2026-08-01', 'g-bills', -400)];
  assert.equal(typicalByLine(rows, MONTHS, byId).get('g-bills'), 300);
});

test('a quiet month after the herd started still counts as zero', () => {
  // Data starts in June, so July's silence is a real zero: median(300, 0, 300).
  const rows = [row('2026-06-01', 'g-bills', -300), row('2026-08-01', 'g-bills', -300)];
  assert.equal(typicalByLine(rows, MONTHS, byId).get('g-bills'), 300);
});

test('a hidden group is never budgeted, but a hidden child still rolls up', () => {
  const rows = [
    // The user hid Travel; a preset must not put it back on their Budgets screen.
    row('2026-06-01', 'c-flights', -200), row('2026-07-01', 'c-flights', -200), row('2026-08-01', 'c-flights', -200),
    // A hidden child of a visible group still counts toward that group (spec).
    row('2026-06-01', 'c-hidden-gas', -50), row('2026-07-01', 'c-hidden-gas', -50), row('2026-08-01', 'c-hidden-gas', -50),
  ];
  const typical = typicalByLine(rows, MONTHS, byId);
  assert.equal(typical.has('g-travel'), false);
  assert.equal(typical.has('c-flights'), false);
  assert.equal(typical.get('g-transport'), 50);
});

test('estimateIncome ignores months before the herd had any data', () => {
  assert.equal(estimateIncome([row('2026-08-01', 'g-income', 5000)], MONTHS, byId), 5000);
});

test('estimateIncome is the median of the months, so one bonus does not inflate it', () => {
  const rows = [
    row('2026-06-01', 'g-income', 5000), row('2026-07-01', 'g-income', 9000), row('2026-08-01', 'g-income', 5200),
    row('2026-06-01', 'g-bills', -100),
  ];
  assert.equal(estimateIncome(rows, MONTHS, byId), 5200);
});

test('estimateIncome is zero without income rows', () => {
  assert.equal(estimateIncome([row('2026-06-01', 'g-bills', -100)], MONTHS, byId), 0);
});

test('estimateIncome is whole dollars, so pennies of income read as none', () => {
  // Sandbox and stray refunds leave cents behind. Rounded to 0 they must count
  // as no income, or the field shows "0" beside a caption claiming an estimate.
  const pennies = [
    row('2026-07-01', 'g-income', 0.12), row('2026-08-01', 'g-income', 0.12),
  ];
  assert.equal(estimateIncome(pennies, MONTHS, byId), 0);
  // A real income still comes back whole.
  const real = [
    row('2026-06-01', 'g-income', 5000.49), row('2026-07-01', 'g-income', 5000.49), row('2026-08-01', 'g-income', 5000.49),
  ];
  assert.equal(estimateIncome(real, MONTHS, byId), 5000);
});

const typical = new Map([
  ['g-bills', 1000],   // need
  ['c-groceries', 500], // need
  ['g-loans', 400],    // need, and its own bucket in 70/20/10
  ['g-shopping', 300], // want
  ['c-restaurants', 200], // want
]);
const preset = (id: string, income: number | null) => {
  const found = buildPresets(typical, income, byId).find((p) => p.id === id);
  assert.ok(found, `no preset ${id}`);
  return found;
};
const amountOf = (p: { lines: { categoryId: string; amount: number }[] }, id: string) =>
  p.lines.find((l) => l.categoryId === id)?.amount;

test('Match my spending budgets every line at its typical spend', () => {
  const p = preset('match', null);
  assert.equal(amountOf(p, 'g-bills'), 1000);
  assert.equal(amountOf(p, 'c-restaurants'), 200);
  assert.equal(p.total, 2400);
  // No income: nothing to subtract from.
  assert.equal(p.savings, null);
  assert.equal(p.needsIncome, false);
});

test('50/30/20 keeps typical spend when a bucket is under its cap', () => {
  // Needs 1900 vs a 5000 cap, wants 500 vs 3000: both fit, so nothing is scaled.
  const p = preset('50_30_20', 10000);
  assert.equal(amountOf(p, 'g-bills'), 1000);
  assert.equal(amountOf(p, 'g-shopping'), 300);
  assert.equal(p.total, 2400);
  assert.equal(p.savings, 7600);
});

test('50/30/20 scales a bucket down in proportion when it is over its cap', () => {
  // Income 2000: needs cap 1000 against 1900 typical (ratio 1000/1900), wants cap 600 against 500 (fits).
  const p = preset('50_30_20', 2000);
  assert.equal(amountOf(p, 'g-bills'), 525); // 1000 * 1000/1900 = 526.3 -> 525
  assert.equal(amountOf(p, 'c-groceries'), 265); // 500 * 1000/1900 = 263.2 -> 265
  assert.equal(amountOf(p, 'g-loans'), 210); // 400 * 1000/1900 = 210.5 -> 210
  assert.equal(amountOf(p, 'g-shopping'), 300); // wants untouched
});

test('70/20/10 caps loan payments apart from everyday spending', () => {
  // Income 2000: everyday cap 1400 against 2000 typical (bills+groceries+shopping+restaurants),
  // loans cap 200 against 400 typical.
  const p = preset('70_20_10', 2000);
  assert.equal(amountOf(p, 'g-bills'), 700); // 1000 * 1400/2000
  assert.equal(amountOf(p, 'g-loans'), 200); // 400 * 200/400
});

test('every amount is rounded to the nearest five', () => {
  for (const line of preset('50_30_20', 2000).lines) assert.equal(line.amount % 5, 0);
});

test('a preset never budgets a line with no typical spend', () => {
  const p = preset('match', null);
  assert.equal(p.lines.some((l) => l.amount === 0), false);
  assert.equal(p.lines.length, 5);
});

test('without income the percentage presets are flagged and empty, match still works', () => {
  for (const income of [null, 0]) {
    const p = preset('50_30_20', income);
    assert.equal(p.needsIncome, true);
    assert.deepEqual(p.lines, []);
    assert.equal(p.total, 0);
    // No division by zero anywhere.
    assert.equal(Number.isFinite(p.total), true);
    assert.equal(preset('match', income).lines.length, 5);
  }
});

test('buildPresets returns the three presets, in order', () => {
  assert.deepEqual(buildPresets(typical, 5000, byId).map((p) => p.id), ['match', '50_30_20', '70_20_10']);
});

test('with nothing spent, every preset is empty', () => {
  for (const p of buildPresets(new Map(), 5000, byId)) assert.deepEqual(p.lines, []);
});
