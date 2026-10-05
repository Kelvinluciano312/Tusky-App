/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { amrOfAccessToken, hasOtpProof, needsSecondStep } from './two-factor.ts';

const OTP = [{ method: 'otp', timestamp: 1 }];
const PASSWORD = [{ method: 'password', timestamp: 1 }];

function tokenWith(claims: unknown): string {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
}

test('only an otp entry is proof of a code', () => {
  assert.equal(hasOtpProof(OTP), true);
  assert.equal(hasOtpProof([...PASSWORD, ...OTP]), true);
  assert.equal(hasOtpProof(PASSWORD), false);
  assert.equal(hasOtpProof([]), false);
});

test('anything unreadable is no proof', () => {
  for (const junk of [null, undefined, 'otp', 7, {}, { method: 'otp' }, [null], ['otp'], [{ method: 5 }]]) {
    assert.equal(hasOtpProof(junk), false);
  }
});

test('the second step is for opted-in users on a password-only session', () => {
  assert.equal(needsSecondStep({ two_factor: true }, PASSWORD), true);
  assert.equal(needsSecondStep({ two_factor: true }, null), true);
  assert.equal(needsSecondStep({ two_factor: true }, OTP), false);
  assert.equal(needsSecondStep({ two_factor: false }, PASSWORD), false);
  assert.equal(needsSecondStep({ two_factor: null }, PASSWORD), false);
  assert.equal(needsSecondStep(null, PASSWORD), false);
});

test('amrOfAccessToken reads the claim from a JWT', () => {
  assert.deepEqual(amrOfAccessToken(tokenWith({ sub: 'u', amr: OTP })), OTP);
  assert.deepEqual(amrOfAccessToken(tokenWith({ sub: 'u', amr: PASSWORD, note: '??>>' })), PASSWORD);
  assert.equal(amrOfAccessToken(tokenWith({ sub: 'u' })), null);
});

test('amrOfAccessToken survives a malformed token', () => {
  for (const bad of [null, undefined, '', 'abc', 'a.b.c', 'a..c', 'a.%%%.c']) {
    assert.equal(amrOfAccessToken(bad), null);
  }
});
