/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { backendLabel, pickBackend, pickRevenueCatKey } from './environment.ts';

test('dev builds use the stored choice, defaulting to sandbox', () => {
  assert.equal(pickBackend({ stored: null, isDev: true, realConfigured: true }), 'sandbox');
  assert.equal(pickBackend({ stored: 'real', isDev: true, realConfigured: true }), 'real');
  assert.equal(pickBackend({ stored: 'sandbox', isDev: true, realConfigured: true }), 'sandbox');
  assert.equal(pickBackend({ stored: 'junk', isDev: true, realConfigured: true }), 'sandbox');
});

test('release builds are always real data', () => {
  assert.equal(pickBackend({ stored: null, isDev: false, realConfigured: true }), 'real');
  assert.equal(pickBackend({ stored: 'sandbox', isDev: false, realConfigured: true }), 'real');
});

test('without a production project configured, everything is sandbox', () => {
  assert.equal(pickBackend({ stored: 'real', isDev: true, realConfigured: false }), 'sandbox');
  assert.equal(pickBackend({ stored: null, isDev: false, realConfigured: false }), 'sandbox');
});

test('backendLabel names each backend', () => {
  assert.equal(backendLabel('real'), 'Real data');
  assert.equal(backendLabel('sandbox'), 'Plaid Sandbox');
});

test('the RevenueCat key follows backend and platform, and an empty key means no purchases', () => {
  const keys = { android: 'goog_dev', ios: 'appl_dev', prodAndroid: '', prodIos: 'appl_prod' };
  assert.equal(pickRevenueCatKey({ backend: 'sandbox', platform: 'android', keys }), 'goog_dev');
  assert.equal(pickRevenueCatKey({ backend: 'sandbox', platform: 'ios', keys }), 'appl_dev');
  assert.equal(pickRevenueCatKey({ backend: 'real', platform: 'android', keys }), '');
  assert.equal(pickRevenueCatKey({ backend: 'real', platform: 'ios', keys }), 'appl_prod');
  assert.equal(pickRevenueCatKey({ backend: 'sandbox', platform: 'web', keys }), '');
});
