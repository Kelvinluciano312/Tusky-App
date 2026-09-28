/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planBanner, type PlanInfo } from './plan-banner.ts';

const NOW = new Date('2026-10-10T12:00:00Z');
const info = (over: Partial<PlanInfo> = {}): PlanInfo => ({
  plan: 'tusk', source: 'own', expires_at: null, max_banks: 10, banks_used: 2, over_limit_since: null, ...over,
});

test('nothing to say on a healthy plan', () => {
  assert.equal(planBanner(info(), NOW), null);
});

test('a trial more than 3 days from its end says nothing yet', () => {
  assert.equal(planBanner(info({ plan: 'trial', source: 'trial', expires_at: '2026-10-14T13:00:00Z' }), NOW), null);
});

test('a trial ending within 3 days warns, counting whole days up', () => {
  assert.deepEqual(planBanner(info({ plan: 'trial', source: 'trial', expires_at: '2026-10-12T18:00:00Z' }), NOW), {
    title: 'Your trial ends in 3 days',
    body: 'After that, Tusky disconnects your banks. Everything you have tracked stays here.',
  });
  assert.equal(
    planBanner(info({ plan: 'trial', source: 'trial', expires_at: '2026-10-10T20:00:00Z' }), NOW)?.title,
    'Your trial ends in 1 day',
  );
});

test('over a smaller plan: how many to disconnect, and by when', () => {
  assert.deepEqual(
    planBanner(info({ plan: 'tusklet', max_banks: 3, banks_used: 5, over_limit_since: '2026-10-08T09:00:00Z' }), NOW),
    {
      title: 'Your plan connects up to 3 banks',
      body: 'You have 5. Disconnect 2 in Settings within 5 days, or Tusky disconnects the most recently added.',
    },
  );
});

test('over the limit before the daily check has run: the full window', () => {
  assert.equal(
    planBanner(info({ plan: 'tusklet', max_banks: 3, banks_used: 4 }), NOW)?.body,
    'You have 4. Disconnect 1 in Settings within 7 days, or Tusky disconnects the most recently added.',
  );
});

test('the last day of the window still counts as a day', () => {
  assert.match(
    planBanner(info({ plan: 'tusklet', max_banks: 3, banks_used: 4, over_limit_since: '2026-10-03T13:00:00Z' }), NOW)!.body,
    /within 1 day,/,
  );
});
