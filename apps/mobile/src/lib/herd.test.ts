/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { expiresIn, formatCode, initials, inviteMessage, isShared, normalizeCode, payerLabel } from './herd.ts';

test('payerLabel names a member by first name, null as Joint, anyone else as Former member', () => {
  const members = [
    { user_id: 'a', display_name: 'Pedro Leão' },
    { user_id: 'b', display_name: 'Kelvyn' },
  ];
  assert.equal(payerLabel('a', members), 'Pedro');
  assert.equal(payerLabel('b', members), 'Kelvyn');
  assert.equal(payerLabel(null, members), 'Joint');
  assert.equal(payerLabel('gone', members), 'Former member');
});

test('normalizeCode forgives case, dashes, spaces and look-alikes', () => {
  assert.equal(normalizeCode('abcd-efgh'), 'ABCDEFGH');
  assert.equal(normalizeCode(' ab cd ef gh '), 'ABCDEFGH');
  assert.equal(normalizeCode('O0IL-1234'), '00111234');
  assert.equal(normalizeCode('tusky:///join/ABCD-EFGH'), 'ABCDEFGH');
});

test('normalizeCode refuses the wrong length and letters outside the alphabet', () => {
  for (const input of ['ABCDEFG', 'ABCDEFGHJ', 'ABCDEFGU', 'ABCD_EFG', '']) {
    assert.equal(normalizeCode(input), null);
  }
});

test('formatCode and inviteMessage show the code as XXXX-XXXX, with the link', () => {
  assert.equal(formatCode('ABCDEFGH'), 'ABCD-EFGH');
  const message = inviteMessage("Pedro's herd", 'ABCDEFGH');
  assert.match(message, /ABCD-EFGH/);
  assert.match(message, /tusky:\/\/\/join\/ABCDEFGH/);
});

test('initials takes the first and last words', () => {
  assert.equal(initials('Pedro Leão'), 'PL');
  assert.equal(initials('Pedro Henrique Leão'), 'PL');
  assert.equal(initials('kelvyn'), 'K');
  assert.equal(initials('  '), '?');
});

test('expiresIn counts days left, rounding up', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  assert.equal(expiresIn('2026-10-04T11:59:58Z', now), 'in 7 days');
  assert.equal(expiresIn('2026-09-29T13:00:00Z', now), 'in 3 days');
  assert.equal(expiresIn('2026-09-28T11:00:00Z', now), 'within a day');
});

test('isShared: only a herd of two or more has anyone to share with', () => {
  assert.equal(isShared(undefined), false);
  assert.equal(isShared({ members: [{}] }), false);
  assert.equal(isShared({ members: [{}, {}] }), true);
});
