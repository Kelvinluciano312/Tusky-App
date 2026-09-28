/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Category, MonthlyPersonTotal, MonthlyTotal } from './queries';
import { buildCashFlow, buildCategorySlices, buildGroupBreakdown, buildPersonSpending } from './reports.ts';

const cat = (id: string, parent_id: string | null, kind: Category['kind'] = 'expense'): Category => ({
  id, parent_id, kind, sort_order: 1, slug: id, name: id, icon: 'Tag', color: '#000000', hidden: false, is_custom: false, overridden: false,
});
const byId = new Map(
  [cat('food', null), cat('coffee', 'food'), cat('groceries', 'food'), cat('fun', null),
    cat('transfer', null, 'transfer'), cat('card', 'transfer', 'transfer'), cat('income', null, 'income')]
    .map((c) => [c.id, c]),
);
const row = (category_id: string, total: number, month = '2026-09-01'): MonthlyTotal => ({
  month, category_id, iso_currency_code: 'USD', total, transaction_count: 1,
});

test('buildCategorySlices rolls children up into one slice per group', () => {
  const slices = buildCategorySlices([row('coffee', -20), row('groceries', -60), row('food', -20), row('fun', -50)], byId);
  assert.deepEqual(slices.map((s) => [s.id, s.spent]), [['food', 100], ['fun', 50]]);
  assert.equal(slices[0].name, 'food');
});

test('buildCategorySlices leaves out transfer children, card payments included', () => {
  const slices = buildCategorySlices([row('card', -500), row('coffee', -5)], byId);
  assert.deepEqual(slices.map((s) => s.id), ['food']);
});

test('buildGroupBreakdown splits one group, labels its own rows "(general)", and drops refunds', () => {
  const parts = buildGroupBreakdown(
    [row('coffee', -30), row('groceries', 10), row('food', -10), row('fun', -99)],
    'food',
    byId,
  );
  assert.deepEqual(parts.map((p) => [p.id, p.spent, p.name]), [['coffee', 30, 'coffee'], ['food', 10, 'food (general)']]);
  assert.equal(parts.reduce((sum, p) => sum + p.share, 0), 1);
});

test('buildCashFlow keeps a transfer child out of expenses', () => {
  const [month] = buildCashFlow([row('card', -500), row('coffee', -5), row('income', 1000)], ['2026-09-01'], byId);
  assert.deepEqual([month.income, month.expense, month.net], [1000, 5, 995]);
});

const members = [
  { user_id: 'u-pedro', display_name: 'Pedro Leao' },
  { user_id: 'u-kel', display_name: 'Kelvyn' },
];
const personRow = (paid_by: string | null, category_id: string, total: number): MonthlyPersonTotal => ({
  ...row(category_id, total), paid_by,
});

test('buildPersonSpending totals expense per person, with Joint and Former member as their own rows', () => {
  const people = buildPersonSpending(
    [personRow('u-pedro', 'coffee', -30), personRow('u-pedro', 'fun', -10), personRow(null, 'groceries', -40),
      personRow('u-gone', 'fun', -20), personRow('u-other-gone', 'fun', -5)],
    byId,
    members,
  );
  assert.deepEqual(people.map((p) => [p.key, p.label, p.spent]), [
    ['u-pedro', 'Pedro', 40], ['joint', 'Joint', 40], ['former', 'Former member', 25], ['u-kel', 'Kelvyn', 0],
  ]);
  assert.ok(Math.abs(people.reduce((sum, p) => sum + p.share, 0) - 1) < 1e-9);
});

test('buildPersonSpending leaves out income and transfers, and lists every member even at zero', () => {
  const people = buildPersonSpending(
    [personRow('u-kel', 'income', 1000), personRow('u-kel', 'card', -500), personRow(null, 'transfer', -50)],
    byId,
    members,
  );
  assert.deepEqual(people.map((p) => [p.key, p.spent, p.share]), [['u-pedro', 0, 0], ['u-kel', 0, 0]]);
});

test('buildPersonSpending keeps a net refund as a negative that takes no share', () => {
  const people = buildPersonSpending([personRow('u-pedro', 'fun', -60), personRow('u-kel', 'fun', 15)], byId, members);
  assert.deepEqual(people.map((p) => [p.key, p.spent, p.share]), [['u-pedro', 60, 1], ['u-kel', -15, 0]]);
});
