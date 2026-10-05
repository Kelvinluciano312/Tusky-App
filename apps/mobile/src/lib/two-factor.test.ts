/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  amrOfAccessToken,
  codeComplete,
  codeFull,
  hasOtpProof,
  needsSecondStep,
  notifyTwoFactorRequired,
  onTwoFactorRequired,
  resendLabel,
  resendSecondsLeft,
  sanitizeCode,
} from './two-factor.ts';

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

test('a code is its digits, whatever was typed or pasted', () => {
  assert.equal(sanitizeCode('123456'), '123456');
  assert.equal(sanitizeCode(' 1234 5678 '), '12345678');
  assert.equal(sanitizeCode('12-34-56-78-90'), '12345678');
  assert.equal(sanitizeCode('abc'), '');
});

test('Verify accepts 6 to 8 digits; only a full code submits by itself', () => {
  assert.equal(codeComplete('12345'), false);
  assert.equal(codeComplete('123456'), true);
  assert.equal(codeFull('123456'), false);
  assert.equal(codeFull('12345678'), true);
});

test('resend waits 60 seconds, counted down', () => {
  assert.equal(resendSecondsLeft(0, 0), 60);
  assert.equal(resendSecondsLeft(0, 1), 60);
  assert.equal(resendSecondsLeft(0, 1_000), 59);
  assert.equal(resendSecondsLeft(0, 59_001), 1);
  assert.equal(resendSecondsLeft(0, 60_000), 0);
  assert.equal(resendSecondsLeft(0, 90_000), 0);
  assert.equal(resendSecondsLeft(5_000, 0), 60);
});

test('the resend label counts down in m:ss', () => {
  assert.equal(resendLabel(60), 'Resend code in 1:00');
  assert.equal(resendLabel(42), 'Resend code in 0:42');
  assert.equal(resendLabel(5), 'Resend code in 0:05');
  assert.equal(resendLabel(0), 'Resend code');
});

test('a function asking for the second step reaches every listener until it unsubscribes', () => {
  let a = 0;
  let b = 0;
  const offA = onTwoFactorRequired(() => a++);
  const offB = onTwoFactorRequired(() => b++);
  notifyTwoFactorRequired();
  offA();
  notifyTwoFactorRequired();
  offB();
  notifyTwoFactorRequired();
  assert.deepEqual([a, b], [1, 2]);
});
