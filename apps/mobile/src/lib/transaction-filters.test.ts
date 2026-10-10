/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  activeChips,
  type Filters,
  isFiltered,
  matchesFilters,
  matchesSearch,
  merchantOptions,
  NO_FILTERS,
  parseAmount,
  withoutChip,
} from './transaction-filters.ts';

const row = (over: Partial<Parameters<typeof matchesFilters>[0]> = {}) => ({
  name: 'STARBUCKS #123',
  merchant_name: 'Starbucks',
  merchant_key: 'starbucks',
  amount: -6.5,
  account_id: 'chk',
  category_id: 'coffee',
  paid_by: 'pedro',
  ...over,
});
// coffee and groceries sit under food; food is a group.
const groupOf = (id: string) => ({ coffee: 'food', groceries: 'food' })[id as 'coffee'] ?? id;
const f = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over });

test('no filters match everything', () => {
  assert.equal(isFiltered(NO_FILTERS), false);
  assert.equal(matchesFilters(row(), NO_FILTERS, groupOf), true);
});

test('a group matches its children; a category matches only itself', () => {
  assert.equal(matchesFilters(row(), f({ category: 'food' }), groupOf), true);
  assert.equal(matchesFilters(row(), f({ category: 'coffee' }), groupOf), true);
  assert.equal(matchesFilters(row(), f({ category: 'groceries' }), groupOf), false);
  assert.equal(matchesFilters(row({ category_id: null }), f({ category: 'food' }), groupOf), false);
});

test('direction, amount range on the absolute amount, account, merchant and who spent it', () => {
  assert.equal(matchesFilters(row(), f({ direction: 'out' }), groupOf), true);
  assert.equal(matchesFilters(row(), f({ direction: 'in' }), groupOf), false);
  assert.equal(matchesFilters(row(), f({ min: 5, max: 10 }), groupOf), true);
  assert.equal(matchesFilters(row(), f({ min: 7 }), groupOf), false);
  assert.equal(matchesFilters(row({ amount: 2000 }), f({ max: 100 }), groupOf), false);
  assert.equal(matchesFilters(row(), f({ account: 'card' }), groupOf), false);
  assert.equal(matchesFilters(row(), f({ merchant: 'starbucks' }), groupOf), true);
  assert.equal(matchesFilters(row({ merchant_key: '' }), f({ merchant: '' }), groupOf), true);
  assert.equal(matchesFilters(row(), f({ spentBy: null }), groupOf), false);
  assert.equal(matchesFilters(row({ paid_by: null }), f({ spentBy: null }), groupOf), true);
});

test('search looks at the merchant and the bank description', () => {
  assert.equal(matchesSearch(row(), 'star'), true);
  assert.equal(matchesSearch(row(), '#123'), true);
  assert.equal(matchesSearch(row(), 'target'), false);
  assert.equal(matchesSearch(row(), '  '), true);
});

test('parseAmount reads dollars, commas and blanks', () => {
  assert.equal(parseAmount('25'), 25);
  assert.equal(parseAmount('$1 200'), 1200);
  assert.equal(parseAmount('12,50'), 12.5);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('-5'), null);
});

test('active chips name each filter, and removing one clears only it', () => {
  const names = {
    category: (id: string) => ({ food: 'Food & Drink' })[id as 'food'] ?? id,
    merchant: () => 'Starbucks',
    account: () => 'Checking',
    person: (id: string | null) => (id === null ? 'Joint' : 'Annie'),
  };
  const full = f({ direction: 'out', category: 'food', merchant: 'starbucks', min: 5, account: 'chk', spentBy: null });
  assert.deepEqual(
    activeChips(full, names).map((c) => c.label),
    ['Money out', 'Food & Drink', 'Starbucks', 'Over $5', 'Checking', 'Spent by Joint'],
  );
  assert.deepEqual(activeChips(f({ min: 5, max: 12.5 }), names)[0].label, '$5–$12.50');
  assert.deepEqual(activeChips(f({ max: 100 }), names)[0].label, 'Under $100');
  const cleared = withoutChip(full, 'amount');
  assert.equal(cleared.min, null);
  assert.equal(cleared.category, 'food');
  assert.equal(withoutChip(full, 'spentBy').spentBy, 'all');
});

test('merchantOptions lists each merchant once, most frequent first, skipping blank keys', () => {
  const rows = [row(), row(), row({ merchant_key: 'target', merchant_name: 'Target' }), row({ merchant_key: '' })];
  assert.deepEqual(
    merchantOptions(rows, (r) => r.merchant_name ?? r.name).map((m) => [m.name, m.count]),
    [['Starbucks', 2], ['Target', 1]],
  );
});
