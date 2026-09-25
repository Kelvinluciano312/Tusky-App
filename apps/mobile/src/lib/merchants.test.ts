/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type MerchantRules, streamName, transactionName } from './merchants.ts';

const rules: MerchantRules = new Map([
  ['uber', { merchant_key: 'uber', category_id: null, display_name: 'Uber Rides' }],
  ['kfc', { merchant_key: 'kfc', category_id: 'cat-food', display_name: null }],
]);

test('transactionName prefers the rename, then the merchant, then the raw name', () => {
  assert.equal(transactionName({ merchant_key: 'uber', merchant_name: 'Uber', name: 'UBER *TRIP' }, rules), 'Uber Rides');
  // A rule with only a category renames nothing.
  assert.equal(transactionName({ merchant_key: 'kfc', merchant_name: 'KFC', name: 'KFC #123' }, rules), 'KFC');
  assert.equal(transactionName({ merchant_key: 'acme', merchant_name: null, name: 'ACME 42' }, rules), 'ACME 42');
});

test('transactionName tolerates a row with no key (older cache)', () => {
  assert.equal(transactionName({ merchant_key: null, merchant_name: 'Uber', name: 'x' }, rules), 'Uber');
});

test('streamName prefers the rename, then the stream name', () => {
  assert.equal(streamName({ merchant_key: 'uber', name: 'Uber' }, rules), 'Uber Rides');
  assert.equal(streamName({ merchant_key: 'lyft', name: 'Lyft' }, rules), 'Lyft');
});
