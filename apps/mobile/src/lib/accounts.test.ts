/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { accountGroup, groupAccounts, netWorth, signedBalance } from './accounts.ts';

const acct = (type: string, balance: number, over: { hidden?: boolean; in_totals?: boolean } = {}) => ({
  type,
  current_balance: balance,
  hidden: over.hidden ?? false,
  in_totals: over.in_totals ?? true,
});

test('accountGroup follows Plaid types', () => {
  assert.equal(accountGroup('depository'), 'cash');
  assert.equal(accountGroup('credit'), 'credit');
  assert.equal(accountGroup('investment'), 'investment');
  assert.equal(accountGroup('brokerage'), 'investment');
  assert.equal(accountGroup('loan'), 'loan');
  assert.equal(accountGroup('other'), 'other');
  assert.equal(accountGroup('something new'), 'other');
});

test('signedBalance counts credit and loans against you', () => {
  assert.equal(signedBalance(acct('credit', 400)), -400);
  assert.equal(signedBalance(acct('loan', 1000)), -1000);
  assert.equal(signedBalance(acct('depository', 250)), 250);
  assert.equal(signedBalance({ type: 'depository', current_balance: null }), 0);
});

test('netWorth leaves out hidden accounts and ones not in totals', () => {
  const accounts = [
    acct('depository', 1000),
    acct('credit', 300),
    acct('investment', 50_000, { in_totals: false }),
    acct('depository', 999, { hidden: true }),
  ];
  assert.equal(netWorth(accounts), 700);
});

test('groupAccounts orders groups, skips empty ones and hidden accounts, and totals only in-totals accounts', () => {
  const k401 = acct('investment', 50_000, { in_totals: false });
  const ira = acct('investment', 2_000);
  const checking = acct('depository', 1000);
  const card = acct('credit', 300);
  const groups = groupAccounts([k401, card, checking, ira, acct('loan', 5, { hidden: true })]);
  assert.deepEqual(groups.map((g) => g.group), ['cash', 'credit', 'investment']);
  assert.deepEqual(groups[2].accounts, [k401, ira]);
  assert.equal(groups[2].total, 2_000);
  assert.equal(groups[1].total, -300);
});
