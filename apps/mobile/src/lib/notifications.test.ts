/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_NOTIFICATION_PREFS,
  formatHour,
  formatThreshold,
  routeForNotification,
  showNotificationPrompt,
} from './notifications.ts';

const TX = '11111111-1111-1111-1111-111111111111';

test('a notification opens only known screens', () => {
  assert.equal(routeForNotification({ url: '/review' }), '/review');
  assert.equal(routeForNotification({ url: `/transaction/${TX}` }), `/transaction/${TX}`);
  assert.equal(routeForNotification({ url: `/bank/${TX}` }), `/bank/${TX}`);
  assert.equal(routeForNotification({ url: '/paywall' }), '/paywall');
  assert.equal(routeForNotification({ url: '/plan' }), '/plan');
  assert.equal(routeForNotification({ url: '/herd' }), '/herd');
  assert.equal(routeForNotification({ url: '/budgets' }), '/budgets');
  assert.equal(routeForNotification({ url: '/recurring' }), '/recurring');
  assert.equal(routeForNotification({ url: '/settle' }), '/settle');
  assert.equal(routeForNotification({ url: '/review?x=1' }), '/review');
});

test('a notification cannot open an arbitrary path', () => {
  assert.equal(routeForNotification({ url: '/account' }), null);
  assert.equal(routeForNotification({ url: 'https://example.com' }), null);
  assert.equal(routeForNotification({ url: '/transaction/not-an-id' }), null);
  assert.equal(routeForNotification(null), null);
  assert.equal(routeForNotification({ url: 12 }), null);
});

test('the Home card asks once, and not after a token or a dismissal', () => {
  assert.equal(showNotificationPrompt({ promptedAt: null, hasToken: false }), true);
  assert.equal(showNotificationPrompt({ hasToken: false }), true);
  assert.equal(showNotificationPrompt({ promptedAt: '2026-10-23T00:00:00Z', hasToken: false }), false);
  assert.equal(showNotificationPrompt({ promptedAt: null, hasToken: true }), false);
});

test('hours and amounts read the way the settings show them', () => {
  assert.equal(formatHour(0), '12 AM');
  assert.equal(formatHour(7), '7 AM');
  assert.equal(formatHour(12), '12 PM');
  assert.equal(formatHour(19), '7 PM');
  assert.equal(formatThreshold(50_000), '$500');
  assert.equal(formatThreshold(100_000), '$1,000');
});

test('defaults match the product: digest on at 7 PM, large purchases and settle-up off', () => {
  assert.equal(DEFAULT_NOTIFICATION_PREFS.review_digest, true);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.review_hour, 19);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.review_threshold, 10);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.large_transaction, false);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.large_cents, 50_000);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.settle_nudge, false);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.budget_80, false);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.budget_100, true);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.upcoming_bill, false);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.quiet_start, 22);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.quiet_end, 8);
  assert.equal(DEFAULT_NOTIFICATION_PREFS.hide_amounts, false);
});
