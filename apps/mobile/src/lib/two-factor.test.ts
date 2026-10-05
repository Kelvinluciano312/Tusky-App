/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  codeComplete,
  codeFailureMessage,
  codeFull,
  needsSecondStep,
  notifyTwoFactorRequired,
  onTwoFactorRequired,
  resendLabel,
  resendSecondsLeft,
  sanitizeCode,
  WRONG_CODE_MESSAGE,
} from './two-factor.ts';

test('the second step is for opted-in users whose session the server has not verified', () => {
  assert.equal(needsSecondStep({ two_factor: true }, false), true);
  assert.equal(needsSecondStep({ two_factor: true }, null), true);
  assert.equal(needsSecondStep({ two_factor: true }, undefined), true);
  assert.equal(needsSecondStep({ two_factor: true }, true), false);
  assert.equal(needsSecondStep({ two_factor: false }, false), false);
  assert.equal(needsSecondStep({ two_factor: null }, false), false);
  assert.equal(needsSecondStep(null, false), false);
});

test('each refusal of the two-factor function has words a person can read', () => {
  assert.equal(codeFailureMessage('wrong_code'), WRONG_CODE_MESSAGE);
  assert.match(codeFailureMessage('too_many_attempts'), /Too many/);
  assert.match(codeFailureMessage('password_session_required'), /password first/);
  assert.match(codeFailureMessage(undefined), /could not check/);
  assert.match(codeFailureMessage('verify_unavailable'), /could not check/);
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
