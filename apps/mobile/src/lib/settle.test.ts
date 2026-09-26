/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  balances,
  benefitShares,
  cleanSplit,
  evenSplit,
  lineTransfers,
  settleTransfers,
  type SettleMember,
  type SharedLine,
  validateSplit,
} from './settle.ts';

const members: SettleMember[] = [
  { user_id: 'pedro', joined_at: '2026-01-01T00:00:00Z' },
  { user_id: 'kel', joined_at: '2026-01-01T00:00:00Z' },
];
const line = (over: Partial<SharedLine>): SharedLine => ({
  id: 'l', date: '2026-09-20', amount: -100, funded_by: 'pedro', paid_by: null, split: null, ...over,
});

test('Joint dinner on Pedro\'s card: Kel owes Pedro half', () => {
  assert.deepEqual(lineTransfers(line({}), members), [{ from: 'kel', to: 'pedro', amount: 50 }]);
});

test('an odd cent rounds the same way for both sides', () => {
  assert.deepEqual(lineTransfers(line({ amount: -6.33 }), members), [{ from: 'kel', to: 'pedro', amount: 3.17 }]);
  assert.deepEqual([...balances([line({ amount: -6.33 })], [], members)], [['pedro', 3.17], ['kel', -3.17]]);
});

test("Kel's purchase on Pedro's card: Kel owes all of it; on a Joint account, Kel owes the other half", () => {
  assert.deepEqual(lineTransfers(line({ paid_by: 'kel' }), members), [{ from: 'kel', to: 'pedro', amount: 100 }]);
  assert.deepEqual(lineTransfers(line({ funded_by: null, paid_by: 'kel' }), members), [
    { from: 'kel', to: 'pedro', amount: 50 },
  ]);
});

test('a line that squares itself makes no transfer', () => {
  assert.deepEqual(lineTransfers(line({ paid_by: 'pedro' }), members), []);
  assert.deepEqual(lineTransfers(line({ funded_by: null, paid_by: null }), members), []);
});

test('a custom split: 70/30 on Pedro\'s card means Kel owes 30%', () => {
  assert.deepEqual(lineTransfers(line({ split: { pedro: 70, kel: 30 } }), members), [
    { from: 'kel', to: 'pedro', amount: 30 },
  ]);
});

test('a refund reverses the debt', () => {
  const net = balances([line({ amount: -100 }), line({ id: 'r', amount: 40 })], [], members);
  assert.deepEqual([...net], [['pedro', 30], ['kel', -30]]);
});

test('recording the shown amount squares it exactly, odd cents included', () => {
  const lines = [line({ id: 'a', amount: -6.33 }), line({ id: 'b', amount: -58, split: { pedro: 70, kel: 30 } })];
  const [owed] = settleTransfers(balances(lines, [], members));
  assert.deepEqual(owed, { from: 'kel', to: 'pedro', amount: 20.57 });
  const after = balances(lines, [{ id: 's', from_user: 'kel', to_user: 'pedro', amount: 20.57 }], members);
  assert.deepEqual([...after], [['pedro', 0], ['kel', 0]]);
});

test('settlements square the balance', () => {
  const net = balances([line({})], [{ id: 's', from_user: 'kel', to_user: 'pedro', amount: 50 }], members);
  assert.deepEqual([...net], [['pedro', 0], ['kel', 0]]);
  assert.deepEqual(settleTransfers(net), []);
});

test('Joint is shared only by members who had joined by that date', () => {
  const three = [...members, { user_id: 'ana', joined_at: '2026-09-25T10:00:00Z' }];
  assert.deepEqual([...benefitShares(line({ date: '2026-09-20' }), three).keys()], ['pedro', 'kel']);
  assert.equal(benefitShares(line({ date: '2026-09-26' }), three).size, 3);
});

test('someone who left drops out: a split renormalizes, a line paid for them counts for nothing', () => {
  assert.deepEqual([...benefitShares(line({ split: { pedro: 50, kel: 25, gone: 25 } }), members)], [
    ['pedro', 50 / 75], ['kel', 25 / 75],
  ]);
  assert.deepEqual([...balances([line({ paid_by: 'gone' })], [], members)], [['pedro', 0], ['kel', 0]]);
});

test('settleTransfers finds the fewest payments for three people', () => {
  const net = new Map([['a', 60], ['b', -20], ['c', -40]]);
  assert.deepEqual(settleTransfers(net), [
    { from: 'c', to: 'a', amount: 40 },
    { from: 'b', to: 'a', amount: 20 },
  ]);
});

test('balances always sum to zero, to the cent', () => {
  const three = [...members, { user_id: 'ana', joined_at: '2026-01-01T00:00:00Z' }];
  const net = balances([line({ amount: -10 }), line({ id: 'x', amount: -33.33, funded_by: 'kel' })], [], three);
  assert.equal(Math.round([...net.values()].reduce((s, v) => s + v, 0) * 100), 0);
});

test('evenSplit sums to exactly 100', () => {
  assert.deepEqual(evenSplit(['a', 'b']), { a: 50, b: 50 });
  assert.deepEqual(evenSplit(['a', 'b', 'c']), { a: 33.34, b: 33.33, c: 33.33 });
});

test('validateSplit and cleanSplit', () => {
  assert.equal(validateSplit({ a: 70, b: 30 }), null);
  assert.equal(validateSplit({ a: 70, b: 30, c: 0 }), null);
  assert.match(validateSplit({ a: 100, b: 0 })!, /two people/);
  assert.match(validateSplit({ a: 60, b: 30 })!, /90%/);
  assert.deepEqual(cleanSplit({ a: 70, b: 30, c: 0 }), { a: 70, b: 30 });
});
