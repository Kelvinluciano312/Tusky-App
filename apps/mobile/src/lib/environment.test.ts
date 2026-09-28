/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { backendLabel, pickBackend } from './environment.ts';

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
