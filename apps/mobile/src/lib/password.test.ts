/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { passwordOk, passwordRules } from './password.ts';

const failing = (pw: string, email?: string) =>
  passwordRules(pw, email)
    .filter((r) => !r.ok)
    .map((r) => r.id);

test('a long password with letters and digits passes', () => {
  assert.equal(passwordOk('elephant42trunk', 'pedro@example.com'), true);
});

test('each rule fails on its own', () => {
  assert.deepEqual(failing('short1a'), ['length']);
  assert.deepEqual(failing('1234567890'), ['letter']);
  assert.deepEqual(failing('onlyletterss'), ['digit']);
  assert.deepEqual(failing('ph.leao2099x', 'ph.leao2099@gmail.com'), ['email']);
});

test('an empty password fails every rule', () => {
  assert.deepEqual(failing(''), ['length', 'letter', 'digit', 'email']);
});

test('short email names are not treated as contained', () => {
  assert.equal(passwordOk('annie1234567', 'ann@example.com'), true);
});

test('accented letters count as letters', () => {
  assert.equal(passwordRules('éééééééé12')[1].ok, true);
});
