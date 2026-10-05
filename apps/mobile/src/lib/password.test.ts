/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PASSWORD_MIN, passwordOk, passwordRules, passwordsMatch } from './password.ts';

const failing = (pw: string, email?: string) =>
  passwordRules(pw, email)
    .filter((r) => !r.ok)
    .map((r) => r.id);

test('the minimum is 12', () => {
  assert.equal(PASSWORD_MIN, 12);
});

test('a long mixed password passes', () => {
  assert.equal(passwordOk('Elephant-42-Trunk', 'pedro@example.com'), true);
});

test('each rule fails on its own', () => {
  assert.deepEqual(failing('Short1!aB'), ['length']);
  assert.deepEqual(failing('ABCDEFGH12345!'), ['lower']);
  assert.deepEqual(failing('abcdefgh12345!'), ['upper']);
  assert.deepEqual(failing('Abcdefghijkl!!'), ['digit']);
  assert.deepEqual(failing('Abcdefghij1234'), ['symbol']);
  assert.deepEqual(failing('Ph.leao2099!!x', 'ph.leao2099@gmail.com'), ['email']);
});

test('an empty password fails every rule', () => {
  assert.deepEqual(failing(''), ['length', 'lower', 'upper', 'digit', 'symbol', 'email']);
});

test('a space is not a symbol', () => {
  assert.deepEqual(failing('Abcdefgh 1234'), ['symbol']);
});

test('underscore and other punctuation count as symbols', () => {
  assert.equal(passwordOk('Abcdefgh_1234'), true);
  assert.equal(passwordOk('Abcdefgh~1234'), true);
});

test('short email names are not treated as contained', () => {
  assert.equal(passwordOk('Annie1234567!', 'ann@example.com'), true);
});

test('accented letters count as letters', () => {
  const pw = 'Éééééééééé1!a';
  assert.equal(passwordRules(pw).find((r) => r.id === 'lower')?.ok, true);
  assert.equal(passwordRules(pw).find((r) => r.id === 'upper')?.ok, true);
});

test('passwordsMatch needs equal, non-empty values', () => {
  assert.equal(passwordsMatch('Abc-12345678', 'Abc-12345678'), true);
  assert.equal(passwordsMatch('Abc-12345678', 'Abc-12345679'), false);
  assert.equal(passwordsMatch('', ''), false);
});
