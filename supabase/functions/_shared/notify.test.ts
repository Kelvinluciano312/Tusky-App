import { assertEquals, assertAlmostEquals } from 'jsr:@std/assert';

import { balances, nudgeUserIds, type SettleMember, type SharedLine } from './open-balance.ts';
import {
  addDays,
  askCollapseKey,
  budgetCopy,
  budgetLevel,
  budgetLevelToSend,
  canSeeAccount,
  changedPrices,
  daysRemaining,
  DEFAULT_PREFS,
  digestBody,
  digestDue,
  formatMoney,
  inQuietHours,
  isLargeOutflow,
  localParts,
  overLimitCopy,
  planDelivery,
  prefsFrom,
  priceCopy,
  questionAskedCopy,
  questionAnsweredCopy,
  budgetsOnTrack,
  recapCopy,
  recapFromSpend,
  redactAmounts,
  spentAgainstBudget,
  visibleSpend,
  settleCopy,
  tokensToDrop,
  trialCopy,
  trialPushDay,
  typeEnabled,
} from './notify.ts';

const NOW = new Date('2026-10-23T23:30:00Z'); // 7:30 PM in New York, Friday
const NY: typeof DEFAULT_PREFS = { ...DEFAULT_PREFS, timezone: 'America/New_York' };

Deno.test('local time uses the user zone, including a Friday evening', () => {
  const parts = localParts(NOW, 'America/New_York');
  assertEquals(parts.hour, 19);
  assertEquals(parts.weekday, 5);
  assertEquals(parts.ymd, '2026-10-23');
});

Deno.test('quiet hours wrap past midnight and turn off when the ends match', () => {
  assertEquals(inQuietHours(22, 22, 8), true);
  assertEquals(inQuietHours(3, 22, 8), true);
  assertEquals(inQuietHours(8, 22, 8), false);
  assertEquals(inQuietHours(19, 22, 8), false);
  assertEquals(inQuietHours(12, 10, 10), false);
  assertEquals(inQuietHours(14, 10, 17), true);
});

Deno.test('a disabled type is skipped, and an urgent one still sends during quiet hours without a sound', () => {
  const off = planDelivery({
    type: 'large_transaction',
    prefs: NY,
    now: NOW,
    duplicate: false,
    urgent: false,
    sound: true,
    title: 'Large purchase',
    body: 'Cafe · $600.00',
  });
  assertEquals(off, { action: 'skip', reason: 'disabled' });

  const night = new Date('2026-10-24T03:30:00Z'); // 11:30 PM New York
  const deferred = planDelivery({
    type: 'question_asked',
    prefs: NY,
    now: night,
    duplicate: false,
    urgent: false,
    sound: true,
    title: 'Asked',
    body: 'Cafe ($6.00)',
  });
  assertEquals(deferred.action, 'defer');

  const reconnect = planDelivery({
    type: 'reconnect',
    prefs: { ...NY, question_asked: false },
    now: night,
    duplicate: false,
    urgent: true,
    sound: true,
    title: 'Reconnect Bank',
    body: 'Sign in again',
  });
  assertEquals(reconnect.action, 'send');
  if (reconnect.action === 'send') assertEquals(reconnect.sound, false);
});

Deno.test('a duplicate dedupe key is skipped, and hide-amounts strips dollars but not the merchant', () => {
  const dup = planDelivery({
    type: 'review_digest',
    prefs: NY,
    now: NOW,
    duplicate: true,
    urgent: false,
    sound: true,
    title: 'Review',
    body: '10 waiting',
  });
  assertEquals(dup, { action: 'skip', reason: 'duplicate' });

  const hidden = planDelivery({
    type: 'weekly_recap',
    prefs: { ...NY, hide_amounts: true },
    now: NOW,
    duplicate: false,
    urgent: false,
    sound: true,
    title: 'Your week',
    body: 'You spent $1,234.56 this week. Most went to Groceries.',
  });
  assertEquals(hidden.action, 'send');
  if (hidden.action === 'send') {
    assertEquals(hidden.body.includes('$'), false);
    assertEquals(hidden.body.includes('Groceries'), true);
    assertEquals(hidden.body.includes('…'), true);
  }
});

Deno.test('asks from the same person inside 10 minutes share a key', () => {
  const first = askCollapseKey('asker', NOW);
  const later = askCollapseKey('asker', new Date(NOW.getTime() + 9 * 60 * 1000));
  const after = askCollapseKey('asker', new Date(NOW.getTime() + 11 * 60 * 1000));
  assertEquals(first, later);
  assertEquals(first === after, false);
  assertEquals(askCollapseKey('other', NOW) === first, false);
});

Deno.test('a private account never contributes its merchant or amount', () => {
  assertEquals(canSeeAccount('mate', { isPrivate: true, connectorId: 'owner' }), false);
  assertEquals(canSeeAccount('owner', { isPrivate: true, connectorId: 'owner' }), true);
  assertEquals(canSeeAccount('mate', { isPrivate: false, connectorId: 'owner' }), true);

  const hidden = questionAskedCopy({
    askerName: 'Alex',
    askerId: 'asker',
    merchant: 'Secret Cafe',
    amount: -40,
    body: 'what was this?',
    transactionId: 'tx',
    now: NOW,
    canSee: false,
  });
  assertEquals(hidden, null);

  const shown = questionAskedCopy({
    askerName: 'Alex',
    askerId: 'asker',
    merchant: 'Cafe',
    amount: -6.5,
    body: 'split this?',
    transactionId: 'tx-1',
    now: NOW,
    canSee: true,
  });
  assertEquals(shown?.body.includes('Cafe'), true);
  assertEquals(shown?.body.includes('$6.50'), true);
  assertEquals(shown?.body.includes('split this?'), true);
  assertEquals(shown?.url, '/transaction/tx-1');

  const answered = questionAnsweredCopy({
    answererName: 'Alex',
    merchant: 'Secret Cafe',
    transactionId: 'tx',
    questionId: 'q1',
    canSee: false,
  });
  assertEquals(answered, null);
});

Deno.test('the review digest waits for the chosen hour, the threshold, and something new', () => {
  const base = {
    enabled: true, localHour: 19, reviewHour: 19, count: 10, threshold: 10, newSinceLast: 2, sentToday: false,
  };
  assertEquals(digestDue(base), true);
  assertEquals(digestDue({ ...base, localHour: 18 }), false);
  assertEquals(digestDue({ ...base, count: 9 }), false);
  assertEquals(digestDue({ ...base, newSinceLast: 0 }), false);
  assertEquals(digestDue({ ...base, sentToday: true }), false);
  assertEquals(digestDue({ ...base, enabled: false }), false);
  assertEquals(digestBody(12, { priority: true, split: false }).includes('second look'), true);
  assertEquals(digestBody(4, { priority: false, split: true }).includes('split'), true);
  assertEquals(digestBody(1, { priority: false, split: false }), '1 transaction is waiting for review.');
});

Deno.test('budget levels fire once, and 100 does not also send 80', () => {
  assertEquals(budgetLevel(79, 100), null);
  assertEquals(budgetLevel(80, 100), 80);
  assertEquals(budgetLevel(100, 100), 100);
  assertEquals(budgetLevel(10, 0), null);

  const both = { budget_80: true, budget_100: true };
  assertEquals(budgetLevelToSend(80, both, new Set()), 80);
  assertEquals(budgetLevelToSend(100, both, new Set()), 100);
  assertEquals(budgetLevelToSend(100, both, new Set([80])), 100);
  assertEquals(budgetLevelToSend(100, both, new Set([100])), null);
  assertEquals(budgetLevelToSend(80, { budget_80: false, budget_100: true }, new Set()), null);
  assertEquals(budgetLevelToSend(100, { budget_80: true, budget_100: false }, new Set()), 80);
  assertEquals(budgetCopy('Groceries', 100, 120, 100).title, 'Groceries is at its budget');
});

Deno.test('a group budget includes its children, and a private account stays out of the shared total', () => {
  const rows = [
    { categoryId: 'food', parentId: null, name: 'Food', connectorId: 'a', isPrivate: false, spent: 10 },
    { categoryId: 'coffee', parentId: 'food', name: 'Coffee', connectorId: 'a', isPrivate: false, spent: 30 },
    { categoryId: 'coffee', parentId: 'food', name: 'Coffee', connectorId: 'b', isPrivate: true, spent: 80 },
    { categoryId: 'shop', parentId: null, name: 'Shopping', connectorId: 'a', isPrivate: false, spent: 5 },
  ];
  const shared = visibleSpend(rows, null);
  assertEquals(shared.length, 3);
  assertEquals(spentAgainstBudget({ categoryId: 'food', parentId: null }, shared), 40);
  assertEquals(spentAgainstBudget({ categoryId: 'coffee', parentId: 'food' }, shared), 30);
  assertEquals(spentAgainstBudget({ categoryId: 'food', parentId: null }, visibleSpend(rows, 'b')), 120);
  assertEquals(budgetsOnTrack([
    { categoryId: 'food', parentId: null, amount: 50, kind: 'expense' },
    { categoryId: 'shop', parentId: null, amount: 4, kind: 'expense' },
    { categoryId: 'move', parentId: null, amount: 10, kind: 'transfer' },
  ], shared), { onTrack: 1, total: 2 });
  assertEquals(recapFromSpend(shared), { spent: 45, top: ['Coffee', 'Food', 'Shopping'] });
});

Deno.test('large purchases skip transfers, card payments, income, pending, and small amounts', () => {
  const base = { amount: -600, pending: false, kind: 'expense', slug: 'restaurants', thresholdCents: 50_000 };
  assertEquals(isLargeOutflow(base), true);
  assertEquals(isLargeOutflow({ ...base, amount: -499.99 }), false);
  assertEquals(isLargeOutflow({ ...base, amount: 600 }), false);
  assertEquals(isLargeOutflow({ ...base, pending: true }), false);
  assertEquals(isLargeOutflow({ ...base, kind: 'transfer', slug: 'transfer_out' }), false);
  assertEquals(isLargeOutflow({ ...base, kind: 'transfer', slug: 'credit_card_payment' }), false);
  assertEquals(isLargeOutflow({ ...base, kind: 'expense', slug: 'credit_card_payment' }), false);
});

Deno.test('a price change notifies only when the change figure moves', () => {
  const after = [
    { id: 'a', amount_change: 2.5, name: 'Netflix', last_amount: -12.5, dismissed: false },
    { id: 'b', amount_change: 1, name: 'Same', last_amount: -10, dismissed: false },
    { id: 'c', amount_change: null, name: 'None', last_amount: -10, dismissed: false },
    { id: 'd', amount_change: 3, name: 'Gone', last_amount: -9, dismissed: true },
  ];
  const changed = changedPrices(
    [{ id: 'a', amount_change: null }, { id: 'b', amount_change: 1 }],
    after,
  );
  assertEquals(changed.map((row) => row.id), ['a']);
  assertEquals(priceCopy('Netflix', 2.5, -12.5).body.includes('$12.50'), true);
});

Deno.test('trial pushes on day 3 and day 1, in the plan banner words', () => {
  const expires = '2026-10-26T15:00:00Z';
  assertEquals(trialPushDay(expires, new Date('2026-10-23T16:00:00Z')), 3);
  assertEquals(trialPushDay(expires, new Date('2026-10-24T16:00:00Z')), null);
  assertEquals(trialPushDay(expires, new Date('2026-10-25T16:00:00Z')), 1);
  assertEquals(trialCopy(3).title, 'Your trial ends in 3 days');
  assertEquals(trialCopy(1).body.includes('disconnects your banks'), true);
});

Deno.test('over-limit copy counts the days left in the 7-day window', () => {
  const since = '2026-10-20T00:00:00Z';
  assertEquals(daysRemaining(since, new Date('2026-10-23T00:00:00Z')), 4);
  const copy = overLimitCopy(1, 3, 4);
  assertEquals(copy.title, 'Your plan connects up to 1 bank');
  assertEquals(copy.body.includes('within 4 days'), true);
  assertEquals(copy.body.includes('Disconnect 2'), true);
});

Deno.test('prefs fill defaults and ignore a threshold that is not 5, 10, or 20', () => {
  assertEquals(typeEnabled(DEFAULT_PREFS, 'settle_nudge'), false);
  assertEquals(typeEnabled(DEFAULT_PREFS, 'reconnect'), true);
  assertEquals(typeEnabled(DEFAULT_PREFS, 'budget_alert'), true);
  const prefs = prefsFrom({ review_threshold: 7, large_transaction: true });
  assertEquals(prefs.review_threshold, 10);
  assertEquals(prefs.large_transaction, true);
  assertEquals(prefs.review_hour, 19);
});

Deno.test('redaction and money formatting', () => {
  assertEquals(formatMoney(1234.5), '$1,234.50');
  assertEquals(formatMoney(-6), '-$6.00');
  assertEquals(redactAmounts('Spent $40.00 at Cafe, was -$5.00'), 'Spent … at Cafe, was …');
});

Deno.test('dead Expo tokens are the only ones dropped', () => {
  assertEquals(
    tokensToDrop(['a', 'b', 'c'], [
      { status: 'ok' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ]),
    ['b'],
  );
});

Deno.test('a week of dates and a recap skip a week with no spending', () => {
  assertEquals(addDays('2026-10-31', 1), '2026-11-01');
  assertEquals(recapCopy({ spent: 0, top: [], onTrack: 0, budgets: 0 }), null);
  const recap = recapCopy({ spent: 80, top: ['Groceries', 'Transport'], onTrack: 2, budgets: 3 });
  assertEquals(recap?.body.includes('Groceries and Transport'), true);
  assertEquals(recap?.body.includes('2 of 3'), true);
});

Deno.test('settle copy names the direction, and a 50/50 split leaves one person owing half', () => {
  assertEquals(settleCopy(-40).body.includes('You owe $40.00'), true);
  assertEquals(settleCopy(40).body.includes("You're owed $40.00"), true);
  const members: SettleMember[] = [
    { user_id: 'a', joined_at: '2026-01-01' },
    { user_id: 'b', joined_at: '2026-01-01' },
  ];
  const line: SharedLine = {
    id: 'l', date: '2026-10-01', amount: -100, funded_by: 'a', split: { a: 50, b: 50 },
  };
  const net = balances([line], [], members);
  assertAlmostEquals(net.get('a') ?? 0, 50, 0.001);
  assertAlmostEquals(net.get('b') ?? 0, -50, 0.001);
  assertEquals(nudgeUserIds(net).sort(), ['a', 'b']);
  const square = balances([line], [{ from_user: 'b', to_user: 'a', amount: 50 }], members);
  assertEquals(nudgeUserIds(square), []);
});
