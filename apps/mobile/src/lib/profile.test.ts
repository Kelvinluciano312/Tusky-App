/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { firstName, NAME_MAX, validatePersonName } from './profile.ts';

test('validatePersonName trims, and refuses blank or too long', () => {
  assert.equal(validatePersonName('  Pedro Leão '), 'Pedro Leão');
  assert.equal(validatePersonName('   '), null);
  assert.equal(validatePersonName('x'.repeat(NAME_MAX)), 'x'.repeat(NAME_MAX));
  assert.equal(validatePersonName('x'.repeat(NAME_MAX + 1)), null);
});

test('firstName greets by the first word', () => {
  assert.equal(firstName('Pedro Leão'), 'Pedro');
  assert.equal(firstName('  Kelvyn  '), 'Kelvyn');
  assert.equal(firstName('ph.leao2099'), 'ph.leao2099');
});
