/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gateFor, nextStep, previousStep, stepLabel } from './first-run.ts';

const V = '2026-10-01';

test('terms come first, then onboarding, then the app', () => {
  assert.equal(gateFor({ termsVersion: null, onboarded: false }, V), 'terms');
  assert.equal(gateFor({ termsVersion: V, onboarded: false }, V), 'onboarding');
  assert.equal(gateFor({ termsVersion: V, onboarded: true }, V), 'app');
});

test('a newer terms version asks again, even after onboarding', () => {
  assert.equal(gateFor({ termsVersion: '2026-09-01', onboarded: true }, V), 'terms');
});

test('two-step on and no code proven asks for the code first', () => {
  const password = [{ method: 'password', timestamp: 1 }];
  const otp = [{ method: 'otp', timestamp: 1 }];
  const fresh = { termsVersion: null, onboarded: false, twoFactor: true };
  assert.equal(gateFor(fresh, V, password), 'verify');
  assert.equal(gateFor({ termsVersion: V, onboarded: true, twoFactor: true }, V, null), 'verify');
  assert.equal(gateFor(fresh, V, otp), 'terms');
  assert.equal(gateFor({ termsVersion: V, onboarded: true, twoFactor: true }, V, otp), 'app');
});

test('two-step off, or an older caller, never asks', () => {
  const password = [{ method: 'password', timestamp: 1 }];
  assert.equal(gateFor({ termsVersion: V, onboarded: true, twoFactor: false }, V, password), 'app');
  assert.equal(gateFor({ termsVersion: V, onboarded: true }, V, password), 'app');
  assert.equal(gateFor({ termsVersion: V, onboarded: true, twoFactor: true }, V), 'verify');
});

test('an unknown state opens the app', () => {
  assert.equal(gateFor(null, V), 'app');
});

test('steps walk forward and back, and say where you are', () => {
  assert.equal(nextStep('welcome'), 'name');
  assert.equal(nextStep('plans'), null);
  assert.equal(previousStep('welcome'), null);
  assert.equal(previousStep('name'), 'welcome');
  assert.equal(stepLabel('welcome'), 'Step 1 of 6');
  assert.equal(stepLabel('plans'), 'Step 6 of 6');
});
