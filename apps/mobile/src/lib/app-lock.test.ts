/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LOCK_AFTER_MS, lockMethodLabel, shouldLockOnResume, unlockFailureMessage } from './app-lock.ts';

const T0 = 1_000_000;

test('the lock waits a full minute away from the app', () => {
  assert.equal(LOCK_AFTER_MS, 60_000);
  assert.equal(shouldLockOnResume(true, T0, T0 + LOCK_AFTER_MS - 1), false);
  assert.equal(shouldLockOnResume(true, T0, T0 + LOCK_AFTER_MS), true);
  assert.equal(shouldLockOnResume(true, T0, T0 + 10 * LOCK_AFTER_MS), true);
});

test('with the lock off, it never locks', () => {
  assert.equal(shouldLockOnResume(false, T0, T0 + 10 * LOCK_AFTER_MS), false);
});

test('no recorded time away means nothing to lock for', () => {
  assert.equal(shouldLockOnResume(true, null, T0), false);
});

test('a clock that moved backwards locks: it cannot be used to stay unlocked', () => {
  assert.equal(shouldLockOnResume(true, T0, T0 - 5_000), true);
});

test('the unlock button names the strongest method the phone has', () => {
  assert.equal(lockMethodLabel([2], 'ios'), 'Face ID');
  assert.equal(lockMethodLabel([2], 'android'), 'Face ID');
  assert.equal(lockMethodLabel([1], 'ios'), 'Touch ID');
  assert.equal(lockMethodLabel([1], 'android'), 'fingerprint');
  assert.equal(lockMethodLabel([3], 'ios'), 'Optic ID');
  assert.equal(lockMethodLabel([3], 'android'), 'iris');
});

test('face wins over fingerprint when a phone has both', () => {
  assert.equal(lockMethodLabel([1, 2], 'android'), 'Face ID');
  assert.equal(lockMethodLabel([2, 1], 'ios'), 'Face ID');
});

test('no biometrics means the passcode', () => {
  assert.equal(lockMethodLabel([], 'ios'), 'passcode');
  assert.equal(lockMethodLabel([], 'android'), 'passcode');
  assert.equal(lockMethodLabel([99], 'ios'), 'passcode');
});

test('cancelling the prompt is silent: the person just changed their mind', () => {
  for (const error of ['user_cancel', 'app_cancel', 'system_cancel', 'user_fallback']) {
    assert.equal(unlockFailureMessage(error), null, error);
  }
});

test('a wrong face or finger asks to try again', () => {
  assert.match(unlockFailureMessage('authentication_failed') ?? '', /try again/i);
});

test('too many tries says to wait', () => {
  assert.match(unlockFailureMessage('lockout') ?? '', /wait/i);
});

test('a phone with nothing set up points to the way out', () => {
  for (const error of ['not_enrolled', 'passcode_not_set', 'not_available']) {
    assert.match(unlockFailureMessage(error) ?? '', /sign out/i, error);
  }
});

test('anything unexpected still says something, never nothing', () => {
  assert.ok(unlockFailureMessage('unknown'));
  assert.ok(unlockFailureMessage('something_new'));
  assert.ok(unlockFailureMessage('timeout'));
});
