/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  alertSummary,
  atFreeAlertLimit,
  dollarsToMinCents,
  findMatchingAlert,
  FREE_ALERT_LIMIT,
  hasAlertForTransaction,
  isPlanLimitError,
  type TransactionAlert,
} from './transaction-alerts.ts';

const alert = (over: Partial<TransactionAlert> = {}): TransactionAlert => ({
  id: '1',
  user_id: 'u',
  merchant_entity_id: null,
  merchant_key: 'starbucks',
  category_id: null,
  min_cents: null,
  enabled: true,
  merchant_label: 'Starbucks',
  category_label: null,
  created_at: '',
  updated_at: '',
  ...over,
});

test('free limit is 3; premium unlimited', () => {
  assert.equal(FREE_ALERT_LIMIT, 3);
  assert.equal(atFreeAlertLimit(3, 'free'), true);
  assert.equal(atFreeAlertLimit(2, 'free'), false);
  assert.equal(atFreeAlertLimit(10, 'tusk'), false);
  assert.equal(atFreeAlertLimit(10, 'trial'), false);
});

test('dollarsToMinCents rounds and rejects non-positive', () => {
  assert.equal(dollarsToMinCents(12.345), 1235);
  assert.equal(dollarsToMinCents(0), null);
  assert.equal(dollarsToMinCents(null), null);
});

test('alertSummary lists the active dimensions', () => {
  assert.equal(alertSummary(alert()), 'Starbucks');
  assert.equal(
    alertSummary(alert({ category_label: 'Coffee', min_cents: 1500 })),
    'Starbucks · Coffee · ≥ $15.00',
  );
  assert.equal(alertSummary(alert({ merchant_label: null, merchant_key: null, min_cents: 5000 })), '≥ $50.00');
});

test('hasAlertForTransaction matches merchant entity, key, or category', () => {
  const list = [
    alert({ merchant_entity_id: 'ent-1', merchant_key: 'starbucks' }),
    alert({ id: '2', merchant_key: null, merchant_label: null, category_id: 'cat-1', category_label: 'Food' }),
  ];
  assert.equal(hasAlertForTransaction(list, { merchantEntityId: 'ent-1', merchantKey: 'x', categoryId: null }), true);
  assert.equal(hasAlertForTransaction(list, { merchantEntityId: null, merchantKey: 'starbucks', categoryId: null }), true);
  assert.equal(hasAlertForTransaction(list, { merchantEntityId: null, merchantKey: null, categoryId: 'cat-1' }), true);
  assert.equal(hasAlertForTransaction(list, { merchantEntityId: null, merchantKey: 'other', categoryId: 'other' }), false);
});

test('findMatchingAlert aligns on merchant, category, and amount', () => {
  const list = [alert({ min_cents: 1000, category_id: 'cat-1', category_label: 'Coffee' })];
  assert.equal(
    findMatchingAlert(list, {
      merchantEntityId: null,
      merchantKey: 'starbucks',
      categoryId: 'cat-1',
      minDollars: 10,
    })?.id,
    '1',
  );
  assert.equal(
    findMatchingAlert(list, {
      merchantEntityId: null,
      merchantKey: 'starbucks',
      categoryId: 'cat-1',
      minDollars: 20,
    }),
    undefined,
  );
});

test('isPlanLimitError detects the free-tier trigger', () => {
  assert.equal(isPlanLimitError({ code: 'P0001', message: 'plan_limit' }), true);
  assert.equal(isPlanLimitError({ message: 'plan_limit' }), true);
  assert.equal(isPlanLimitError({ message: 'other' }), false);
});
