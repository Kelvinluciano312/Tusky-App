/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldClearCache } from './session-cache.ts';

test('signing out clears the cache', () => {
  assert.equal(shouldClearCache('a', null), true);
  assert.equal(shouldClearCache('a', undefined), true);
});

test('switching user clears the cache', () => {
  assert.equal(shouldClearCache('a', 'b'), true);
});

test('a token refresh or a first sign-in keeps the cache', () => {
  assert.equal(shouldClearCache('a', 'a'), false);
  assert.equal(shouldClearCache(null, 'a'), false);
  assert.equal(shouldClearCache(undefined, 'a'), false);
  assert.equal(shouldClearCache(null, null), false);
});
