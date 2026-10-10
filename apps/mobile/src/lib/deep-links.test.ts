/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isPlaidOAuthReturn } from './deep-links.ts';

test('a Plaid OAuth return universal link is recognised, with its query', () => {
  assert.equal(
    isPlaidOAuthReturn('https://studiosouroboros.com/tusky/plaid/oauth?oauth_state_id=3f6a-91'),
    true,
  );
});

test('the same link arriving as a bare path is recognised', () => {
  assert.equal(isPlaidOAuthReturn('/tusky/plaid/oauth?oauth_state_id=3f6a-91'), true);
});

test('an invite link and an app route are not Plaid returns', () => {
  assert.equal(isPlaidOAuthReturn('tusky:///join/ABCD2345'), false);
  assert.equal(isPlaidOAuthReturn('/transactions'), false);
});
