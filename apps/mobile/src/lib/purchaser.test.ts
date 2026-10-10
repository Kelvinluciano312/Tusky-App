/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ensurePurchaser } from './purchaser.ts';

/** A stand-in RevenueCat: `logIn` switches to the id unless `stuck`. */
function rc(start: string, stuck = false) {
  let id = start;
  const logins: string[] = [];
  return {
    logins,
    current: () => Promise.resolve(id),
    logIn: (next: string) => {
      logins.push(next);
      if (!stuck) id = next;
      return Promise.resolve();
    },
  };
}

test('the signed-in user goes ahead without logging in again', async () => {
  const deps = rc('u1');
  await ensurePurchaser('u1', deps);
  assert.deepEqual(deps.logins, []);
});

test('a stale RevenueCat user is switched before buying', async () => {
  const deps = rc('$RCAnonymousID:abc');
  await ensurePurchaser('u1', deps);
  assert.deepEqual(deps.logins, ['u1']);
});

test('a switch that does not take refuses the purchase', async () => {
  await assert.rejects(ensurePurchaser('u1', rc('u0', true)), /couldn't reach the store/);
});

test('nobody signed in refuses the purchase', async () => {
  await assert.rejects(ensurePurchaser(null, rc('u0')), /Sign in/);
});
