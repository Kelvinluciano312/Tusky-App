/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planLimitMessage } from './plans.ts';

test('a finished trial says so', () => {
  assert.equal(
    planLimitMessage('free', 0),
    'Your free trial has ended, so Tusky can no longer connect banks. Your history is still here. Plans are coming soon.',
  );
});

test('a paid plan names its limit, singular and plural', () => {
  assert.equal(
    planLimitMessage('tusklet', 3),
    'Your plan connects up to 3 banks, and you have reached it. Disconnect one in Settings to add another.',
  );
  assert.equal(
    planLimitMessage('trial', 1),
    'Your plan connects up to 1 bank, and you have reached it. Disconnect one in Settings to add another.',
  );
});

test('an unreadable body still gives a sentence', () => {
  assert.equal(
    planLimitMessage(undefined, undefined),
    'Your plan has reached its bank limit. Disconnect one in Settings to add another.',
  );
});
