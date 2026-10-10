import { assertEquals } from 'jsr:@std/assert';

import type { JevAsk } from './jev.ts';
import {
  type DetectInput,
  detectCandidates,
  detectStreams,
  ignoredCategoryIds,
  jevRecurringDecide,
  normalizeMerchant,
  RECURRING_ASK_MAX,
  recurringState,
  settleNearMisses,
  staleStreamIds,
  streamKey,
} from './recurring.ts';

const TRANSFER = 'cat-transfer';

function tx(date: string, amount: number, name = 'Netflix', extra: Partial<DetectInput> = {}): DetectInput {
  return { account_id: 'acct-1', date, amount, name, merchant_name: null, category_id: 'cat-ent', ...extra };
}

const detect = (rows: DetectInput[]) => detectStreams(rows, { transferCategoryIds: [TRANSFER] });

Deno.test('a fixed monthly charge becomes one monthly stream', () => {
  const streams = detect([tx('2026-06-15', -15.49), tx('2026-07-15', -15.49), tx('2026-08-15', -15.49)]);
  assertEquals(streams.length, 1);
  const s = streams[0];
  assertEquals(s.merchant_key, 'netflix');
  assertEquals(s.direction, 'outflow');
  assertEquals(s.frequency, 'monthly');
  assertEquals(s.occurrences, 3);
  assertEquals(s.average_amount, -15.49);
  assertEquals(s.last_amount, -15.49);
  assertEquals(s.previous_amount, -15.49);
  assertEquals(s.amount_change, null);
  assertEquals(s.first_date, '2026-06-15');
  assertEquals(s.last_date, '2026-08-15');
  assertEquals(s.next_date, '2026-09-15');
});

Deno.test('weekend jitter still reads as monthly and predicts the anchor day', () => {
  const [s] = detect([tx('2026-06-15', -50), tx('2026-07-17', -50), tx('2026-08-14', -50)]);
  assertEquals(s.frequency, 'monthly');
  assertEquals(s.next_date, '2026-09-15');
});

Deno.test('a month-end anchor clamps to a short month', () => {
  const [s] = detect([tx('2026-11-30', -20), tx('2026-12-31', -20), tx('2027-01-31', -20)]);
  assertEquals(s.next_date, '2027-02-28');
});

Deno.test('a bill paid early across a month boundary predicts the following month', () => {
  const [s] = detect([tx('2026-07-01', -1850, 'Rent'), tx('2026-08-01', -1850, 'Rent'), tx('2026-08-30', -1850, 'Rent')]);
  assertEquals(s.next_date, '2026-10-01');
});

Deno.test('two occurrences are not enough', () => {
  assertEquals(detect([tx('2026-07-15', -15.49), tx('2026-08-15', -15.49)]), []);
});

Deno.test('weekly groceries with swinging amounts are rejected', () => {
  const rows = [
    tx('2026-07-01', -32.1, 'Whole Foods'),
    tx('2026-07-08', -88.4, 'Whole Foods'),
    tx('2026-07-15', -51, 'Whole Foods'),
    tx('2026-07-22', -120.75, 'Whole Foods'),
    tx('2026-07-29', -45, 'Whole Foods'),
  ];
  assertEquals(detect(rows), []);
});

Deno.test('a fixed weekly charge becomes a weekly stream', () => {
  const [s] = detect(['2026-07-01', '2026-07-08', '2026-07-15', '2026-07-22'].map((d) => tx(d, -9.99, 'Gym')));
  assertEquals(s.frequency, 'weekly');
  assertEquals(s.occurrences, 4);
  assertEquals(s.next_date, '2026-07-29');
});

Deno.test('a biweekly paycheck is an inflow stream', () => {
  const rows = ['2026-07-03', '2026-07-17', '2026-07-31'].map((d) =>
    tx(d, 2400, 'ACME PAYROLL', { category_id: 'cat-income' })
  );
  const [s] = detect(rows);
  assertEquals(s.direction, 'inflow');
  assertEquals(s.frequency, 'biweekly');
  assertEquals(s.merchant_key, 'acme payroll');
  assertEquals(s.next_date, '2026-08-14');
});

Deno.test('only the latest regular run counts', () => {
  const rows = ['2026-03-02', '2026-04-20', '2026-06-15', '2026-07-15', '2026-08-15'].map((d) => tx(d, -15.49));
  const [s] = detect(rows);
  assertEquals(s.first_date, '2026-06-15');
  assertEquals(s.occurrences, 3);
});

Deno.test('a prorated first charge is trimmed from the run', () => {
  const [s] = detect([tx('2026-06-01', -5.16), tx('2026-07-01', -15.49), tx('2026-08-01', -15.49), tx('2026-09-01', -15.49)]);
  assertEquals(s.first_date, '2026-07-01');
  assertEquals(s.occurrences, 3);
  assertEquals(s.average_amount, -15.49);
});

Deno.test('a fixed price that moves is flagged', () => {
  const [s] = detect([tx('2026-06-15', -15.49), tx('2026-07-15', -15.49), tx('2026-08-15', -17.99)]);
  assertEquals(s.amount_change, 2.5);
  assertEquals(s.last_amount, -17.99);
  assertEquals(s.previous_amount, -15.49);
});

Deno.test('a variable utility is detected but never flagged', () => {
  const [s] = detect([tx('2026-06-20', -82.1, 'City Power'), tx('2026-07-20', -96.4, 'City Power'), tx('2026-08-20', -110, 'City Power')]);
  assertEquals(s.frequency, 'monthly');
  assertEquals(s.amount_change, null);
});

Deno.test('transfer-kind categories are excluded', () => {
  const rows = ['2026-06-15', '2026-07-15', '2026-08-15'].map((d) => tx(d, -500, 'To Savings', { category_id: TRANSFER }));
  assertEquals(detect(rows), []);
});

Deno.test('merchant strings normalize so store numbers do not split a stream', () => {
  const [s, ...rest] = detect([
    tx('2026-06-15', -15.49, 'NETFLIX.COM 1234'),
    tx('2026-07-15', -15.49, 'Netflix.com 5678'),
    tx('2026-08-15', -15.49, 'NETFLIX.COM 9012'),
  ]);
  assertEquals(rest, []);
  assertEquals(s.merchant_key, 'netflix com');
});

Deno.test('merchant_name wins over the raw name, and names the stream', () => {
  const [s] = detect(['2026-06-15', '2026-07-15', '2026-08-15'].map((d) =>
    tx(d, -6.5, 'SQ *BLUE BOTTLE 88', { merchant_name: 'Blue Bottle' })
  ));
  assertEquals(s.merchant_key, 'blue bottle');
  assertEquals(s.name, 'Blue Bottle');
});

Deno.test('a merchant that normalizes to nothing is skipped', () => {
  assertEquals(normalizeMerchant('#1234 *'), '');
  assertEquals(detect(['2026-06-15', '2026-07-15', '2026-08-15'].map((d) => tx(d, -10, '#1234 *'))), []);
});

Deno.test('same-day charges merge into one occurrence', () => {
  const [s] = detect([tx('2026-06-15', -10), tx('2026-06-15', -5.49), tx('2026-07-15', -15.49), tx('2026-08-15', -15.49)]);
  assertEquals(s.occurrences, 3);
  assertEquals(s.average_amount, -15.49);
});

Deno.test('zero amounts are ignored', () => {
  assertEquals(detect(['2026-06-15', '2026-07-15', '2026-08-15'].map((d) => tx(d, 0))), []);
});

Deno.test('the same merchant on two accounts is two streams, sorted deterministically', () => {
  const dates = ['2026-06-15', '2026-07-15', '2026-08-15'];
  const streams = detect([
    ...dates.map((d) => tx(d, -15.49, 'Netflix', { account_id: 'acct-2' })),
    ...dates.map((d) => tx(d, -15.49, 'Netflix', { account_id: 'acct-1' })),
  ]);
  assertEquals(streams.map((s) => s.account_id), ['acct-1', 'acct-2']);
});

Deno.test('staleStreamIds drops vanished streams but never dismissed ones', () => {
  const existing = [
    { id: 'keep', account_id: 'a', direction: 'outflow' as const, merchant_key: 'netflix', dismissed: false },
    { id: 'gone', account_id: 'a', direction: 'outflow' as const, merchant_key: 'hulu', dismissed: false },
    { id: 'dismissed', account_id: 'a', direction: 'outflow' as const, merchant_key: 'gym', dismissed: true },
  ];
  const fresh = [{ account_id: 'a', direction: 'outflow' as const, merchant_key: 'netflix' }];
  assertEquals(staleStreamIds(existing, fresh), ['gone']);
});

Deno.test('a bill due on the 1st, sometimes paid a few days early, keeps its anchor', () => {
  const [s] = detect([
    tx('2026-05-30', -1850, 'Rent'),
    tx('2026-07-01', -1850, 'Rent'),
    tx('2026-07-31', -1850, 'Rent'),
    tx('2026-09-01', -1850, 'Rent'),
  ]);
  assertEquals(s.frequency, 'monthly');
  assertEquals(s.next_date, '2026-10-01');
});

Deno.test('early payments split evenly across a month boundary still predict the 1st', () => {
  const [s] = detect([
    tx('2026-05-28', -1850, 'Rent'),
    tx('2026-07-01', -1850, 'Rent'),
    tx('2026-07-29', -1850, 'Rent'),
    tx('2026-09-02', -1850, 'Rent'),
  ]);
  assertEquals(s.next_date, '2026-10-01');
});

Deno.test('ignoredCategoryIds is every transfer except card payments', () => {
  const ids = ignoredCategoryIds([
    { id: 'g-transfer', kind: 'transfer', slug: 'transfer' },
    { id: 'c-accounts', kind: 'transfer', slug: 'account_transfers' },
    { id: 'c-card', kind: 'transfer', slug: 'credit_card_payment' },
    { id: 'c-coffee', kind: 'expense', slug: 'coffee_shops' },
    { id: 'c-pay', kind: 'income', slug: 'paychecks' },
  ]);
  // A card payment is a transfer for spending, but still a bill with a due date.
  assertEquals(ids.sort(), ['c-accounts', 'g-transfer']);
});

Deno.test('ignoredCategoryIds includes a custom transfer category', () => {
  // Custom rows have no slug; sync now passes the owner's transfer children in.
  assertEquals(ignoredCategoryIds([{ id: 'u-venmo', kind: 'transfer', slug: null }]), ['u-venmo']);
});

// --- 12d: near misses and Jev's tiebreak ---------------------------------------

const pay = (date: string, amount: number, account_id = 'acc-1'): DetectInput => ({
  account_id,
  date,
  amount,
  name: 'CITY POWER',
  merchant_name: 'City Power',
  category_id: 'c-utilities',
});
const DATES = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];
// Median 55; 80 strays 25, past monthly's 35% (19.25) but within twice it (38.5).
const VARIABLE = [-50, -80, -45, -60].map((a, i) => pay(DATES[i], a));
// 200 strays 145: past twice the tolerance too.
const WILD = [-50, -200, -45, -60].map((a, i) => pay(DATES[i], a));
const STEADY = DATES.map((d) => pay(d, -15.99));
const OPTS = { transferCategoryIds: [] };

Deno.test('a regular bill whose amount swings past the tolerance is a near miss, not a stream', () => {
  const { streams, nearMisses } = detectCandidates(VARIABLE, OPTS);
  assertEquals(streams, []);
  assertEquals(nearMisses.length, 1);
  assertEquals(nearMisses[0].merchant_key, 'city power');
  // What was stored before 12d is unchanged.
  assertEquals(detectStreams(VARIABLE, OPTS), []);
});

Deno.test('a swing past twice the tolerance is neither', () => {
  assertEquals(detectCandidates(WILD, OPTS), { streams: [], nearMisses: [] });
});

Deno.test('a steady subscription is sure, never a near miss', () => {
  const { streams, nearMisses } = detectCandidates(STEADY, OPTS);
  assertEquals(streams.length, 1);
  assertEquals(nearMisses, []);
  assertEquals(detectStreams(STEADY, OPTS), streams);
});

Deno.test('without Jev, near misses are dropped exactly as before 12d', async () => {
  const { streams, nearMisses } = detectCandidates([...STEADY.map((p) => ({ ...p, account_id: 'acc-2' })), ...VARIABLE], OPTS);
  assertEquals(await settleNearMisses(streams, nearMisses), { streams, keep: [] });
});

Deno.test('a near miss Jev calls recurring joins the streams', async () => {
  const { nearMisses } = detectCandidates(VARIABLE, OPTS);
  const out = await settleNearMisses([], nearMisses, (c) => Promise.resolve(new Map([[streamKey(c[0]), true]])));
  assertEquals(out, { streams: nearMisses, keep: [] });
});

Deno.test('a near miss Jev rejects is left out, and may be deleted', async () => {
  const { nearMisses } = detectCandidates(VARIABLE, OPTS);
  const out = await settleNearMisses([], nearMisses, (c) => Promise.resolve(new Map([[streamKey(c[0]), false]])));
  assertEquals(out, { streams: [], keep: [] });
});

Deno.test('a near miss Jev could not judge is kept, never deleted', async () => {
  const { nearMisses } = detectCandidates(VARIABLE, OPTS);
  // Tipped in on Monday, the call fails on Tuesday: the stream must survive Tuesday.
  assertEquals(await settleNearMisses([], nearMisses, () => Promise.reject(new Error('jev: HTTP 503'))), {
    streams: [],
    keep: nearMisses,
  });
  assertEquals(await settleNearMisses([], nearMisses, () => Promise.resolve(new Map())), {
    streams: [],
    keep: nearMisses,
  });
});

Deno.test('near misses past the cap are not asked about, and are kept', async () => {
  const many = Array.from({ length: RECURRING_ASK_MAX + 1 }, (_, i) =>
    VARIABLE.map((p) => ({ ...p, account_id: `acc-${String(i).padStart(2, '0')}` }))).flat();
  const { nearMisses } = detectCandidates(many, OPTS);
  let asked = 0;
  const out = await settleNearMisses([], nearMisses, (c) => {
    asked = c.length;
    return Promise.resolve(new Map(c.map((s) => [streamKey(s), true])));
  });
  assertEquals(asked, RECURRING_ASK_MAX);
  assertEquals(out.streams.length, RECURRING_ASK_MAX);
  assertEquals(out.keep.length, 1);
});

Deno.test('jevRecurringDecide: a yes at 0.5 or more tips it in, and a failed call has no verdict', async () => {
  const { nearMisses } = detectCandidates(
    [...VARIABLE, ...VARIABLE.map((p) => ({ ...p, account_id: 'acc-2' })), ...VARIABLE.map((p) => ({ ...p, account_id: 'acc-3' }))],
    OPTS,
  );
  const byAccount: Record<string, number | 'fail'> = { 'acc-1': 0.5, 'acc-2': 0.2, 'acc-3': 'fail' };
  let i = 0;
  const ask: JevAsk = () => {
    const answer = byAccount[nearMisses[i++].account_id];
    return answer === 'fail'
      ? Promise.reject(new Error('jev: HTTP 503'))
      : Promise.resolve({ model: 'jev-1.13.0', answers: { is_recurring: { type: 'noul', noul: answer } } });
  };
  const verdicts = await jevRecurringDecide(ask, new Map())(nearMisses);
  assertEquals(verdicts.get(streamKey(nearMisses[0])), true);
  assertEquals(verdicts.get(streamKey(nearMisses[1])), false);
  assertEquals(verdicts.has(streamKey(nearMisses[2])), false);
});

Deno.test('recurringState names the category and never an account', () => {
  const { nearMisses } = detectCandidates(VARIABLE, OPTS);
  const state = recurringState(nearMisses[0], 'Utilities');
  assertEquals(state.category, 'Utilities');
  assertEquals(state.cadence, 'monthly');
  assertEquals(state.occurrences, 4);
  assertEquals(JSON.stringify(state).includes('acc-1'), false);
});
