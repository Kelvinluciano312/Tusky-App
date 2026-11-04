import { assertEquals } from 'jsr:@std/assert';

import {
  alertCopy,
  alertDedupeKey,
  atFreeAlertLimit,
  FREE_ALERT_LIMIT,
  matchesForUser,
  ruleMatchesTx,
  type AlertRule,
  type AlertTx,
} from './transaction-alerts.ts';

const baseRule = (over: Partial<AlertRule> = {}): AlertRule => ({
  id: 'rule-1',
  userId: 'user-a',
  merchantEntityId: null,
  merchantKey: null,
  categoryId: null,
  minCents: null,
  enabled: true,
  ...over,
});

const baseTx = (over: Partial<AlertTx> = {}): AlertTx => ({
  id: 'tx-1',
  pending: false,
  amount: -42.5,
  merchantEntityId: 'ent-starbucks',
  merchantKey: 'starbucks',
  categoryId: 'cat-coffee',
  merchantLabel: 'Starbucks',
  categoryLabel: 'Coffee',
  ...over,
});

Deno.test('pending never matches', () => {
  const rule = baseRule({ merchantKey: 'starbucks' });
  assertEquals(ruleMatchesTx(rule, baseTx({ pending: true })), false);
});

Deno.test('disabled rule never matches', () => {
  assertEquals(ruleMatchesTx(baseRule({ enabled: false, merchantKey: 'starbucks' }), baseTx()), false);
});

Deno.test('merchant matches by entity id when both have it', () => {
  const rule = baseRule({ merchantEntityId: 'ent-starbucks', merchantKey: 'other' });
  assertEquals(ruleMatchesTx(rule, baseTx()), true);
  assertEquals(ruleMatchesTx(rule, baseTx({ merchantEntityId: 'ent-other' })), false);
});

Deno.test('merchant falls back to key when the transaction has no entity id', () => {
  const rule = baseRule({ merchantEntityId: 'ent-starbucks', merchantKey: 'starbucks' });
  assertEquals(ruleMatchesTx(rule, baseTx({ merchantEntityId: null })), true);
  assertEquals(ruleMatchesTx(rule, baseTx({ merchantEntityId: null, merchantKey: 'dunkin' })), false);
});

Deno.test('merchant key-only rule', () => {
  const rule = baseRule({ merchantKey: 'starbucks' });
  assertEquals(ruleMatchesTx(rule, baseTx()), true);
  assertEquals(ruleMatchesTx(rule, baseTx({ merchantKey: 'dunkin' })), false);
});

Deno.test('category-only rule', () => {
  const rule = baseRule({ categoryId: 'cat-coffee' });
  assertEquals(ruleMatchesTx(rule, baseTx()), true);
  assertEquals(ruleMatchesTx(rule, baseTx({ categoryId: 'cat-food' })), false);
});

Deno.test('amount-only rule uses absolute cents', () => {
  const rule = baseRule({ minCents: 4000 });
  assertEquals(ruleMatchesTx(rule, baseTx({ amount: -42.5 })), true);
  assertEquals(ruleMatchesTx(rule, baseTx({ amount: -39.99 })), false);
  assertEquals(ruleMatchesTx(rule, baseTx({ amount: 50 })), true);
});

Deno.test('merchant + amount both required', () => {
  const rule = baseRule({ merchantKey: 'starbucks', minCents: 5000 });
  assertEquals(ruleMatchesTx(rule, baseTx({ amount: -42.5 })), false);
  assertEquals(ruleMatchesTx(rule, baseTx({ amount: -55 })), true);
  assertEquals(ruleMatchesTx(rule, baseTx({ amount: -55, merchantKey: 'dunkin' })), false);
});

Deno.test('category + amount both required', () => {
  const rule = baseRule({ categoryId: 'cat-coffee', minCents: 1000 });
  assertEquals(ruleMatchesTx(rule, baseTx({ amount: -5 })), false);
  assertEquals(ruleMatchesTx(rule, baseTx({ amount: -12 })), true);
});

Deno.test('empty rule (no dimensions) does not match', () => {
  assertEquals(ruleMatchesTx(baseRule(), baseTx()), false);
});

Deno.test('dedupe key is stable per rule and transaction', () => {
  assertEquals(alertDedupeKey('r1', 't1'), 'tx_alert:r1:t1');
  assertEquals(alertDedupeKey('r1', 't1'), alertDedupeKey('r1', 't1'));
  assertEquals(alertDedupeKey('r1', 't1') === alertDedupeKey('r2', 't1'), false);
});

Deno.test('matchesForUser only returns that user\'s matching rules', () => {
  const rules = [
    baseRule({ id: 'a', userId: 'user-a', merchantKey: 'starbucks' }),
    baseRule({ id: 'b', userId: 'user-b', merchantKey: 'starbucks' }),
    baseRule({ id: 'c', userId: 'user-a', categoryId: 'cat-food' }),
  ];
  const hits = matchesForUser(rules, baseTx(), 'user-a');
  assertEquals(hits.map((r) => r.id), ['a']);
});

Deno.test('alert copy names the matching dimensions', () => {
  const copy = alertCopy(
    baseRule({ merchantKey: 'starbucks', categoryId: 'cat-coffee', minCents: 1000 }),
    baseTx(),
  );
  assertEquals(copy.title, 'Transaction alert');
  assertEquals(copy.body.includes('Starbucks'), true);
  assertEquals(copy.body.includes('Coffee'), true);
  assertEquals(copy.body.includes('$10.00'), true);
});

Deno.test('free tier limit is 3 active; premium unlimited', () => {
  assertEquals(FREE_ALERT_LIMIT, 3);
  assertEquals(atFreeAlertLimit(3, 'free'), true);
  assertEquals(atFreeAlertLimit(2, 'free'), false);
  assertEquals(atFreeAlertLimit(99, 'trial'), false);
  assertEquals(atFreeAlertLimit(99, 'tusk'), false);
  assertEquals(atFreeAlertLimit(99, null), true);
});
