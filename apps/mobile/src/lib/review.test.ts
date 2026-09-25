/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { leftBehind, NOTE_MAX, normalizeNote } from './review.ts';

test('normalizeNote trims, and blank means no memo', () => {
  assert.equal(normalizeNote('  Dinner with Ana \n'), 'Dinner with Ana');
  assert.equal(normalizeNote(''), null);
  assert.equal(normalizeNote('   \n '), null);
});

test('normalizeNote caps the memo at NOTE_MAX, never ending on whitespace', () => {
  assert.equal(normalizeNote('x'.repeat(NOTE_MAX + 20))?.length, NOTE_MAX);
  assert.equal(normalizeNote(`${'x'.repeat(NOTE_MAX - 1)} tail`), 'x'.repeat(NOTE_MAX - 1));
});

test('leftBehind marks every card passed going forward, even on a fling', () => {
  assert.deepEqual(leftBehind(0, 1), [0]);
  assert.deepEqual(leftBehind(3, 5), [3, 4]);
  assert.deepEqual(leftBehind(2, 1), []);
  assert.deepEqual(leftBehind(2, 2), []);
});
