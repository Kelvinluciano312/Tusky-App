/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { guessHint, setBy } from './category-source.ts';

test('guessHint names where a guess came from, and is null for everything else', () => {
  assert.equal(guessHint('learned'), 'from your past choices');
  assert.equal(guessHint('community'), 'from other Tusky users');
  assert.equal(guessHint('ai'), 'with AI');
  for (const source of ['manual', 'rule', 'plaid', 'fallback', 'something-new']) assert.equal(guessHint(source), null);
});

test('setBy has words for every source, and a safe default', () => {
  assert.equal(setBy('manual'), 'You');
  assert.equal(setBy('rule'), 'Your rule');
  assert.equal(setBy('learned'), 'Your past choices');
  assert.equal(setBy('community'), 'Other Tusky users');
  assert.equal(setBy('ai'), 'AI');
  assert.equal(setBy('plaid'), 'Your bank (via Plaid)');
  assert.equal(setBy('fallback'), 'No match yet');
  assert.equal(setBy('something-new'), 'Tusky');
});
