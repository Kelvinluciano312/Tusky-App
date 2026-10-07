import { assertEquals } from 'jsr:@std/assert';

import { autoReviewIds, carryForward, type ExistingRow, partitionAutoReview, REVIEW_WINDOW_DAYS, reviewCutoff } from './review.ts';

const row = (id: string, over: Partial<ExistingRow> = {}): ExistingRow => ({
  plaid_transaction_id: id,
  category_id: 'cat-plaid',
  category_is_manual: false,
  notes: null,
  paid_by: 'owner',
  paid_by_is_manual: false,
  split: null,
  corrected_from: null,
  category_source: 'plaid',
  ...over,
});

Deno.test('carryForward: a hand-picked payer, Joint included, moves to the posted row', () => {
  const { payers } = carryForward(
    [
      { transaction_id: 'posted1', pending_transaction_id: 'p1' },
      { transaction_id: 'posted2', pending_transaction_id: 'p2' },
    ],
    new Map([
      ['p1', row('p1', { paid_by: 'kelvyn', paid_by_is_manual: true })],
      ['p2', row('p2', { paid_by: null, paid_by_is_manual: true })],
    ]),
  );
  assertEquals(payers, [
    { plaid_transaction_id: 'posted1', paid_by: 'kelvyn', split: null },
    { plaid_transaction_id: 'posted2', paid_by: null, split: null },
  ]);
});

Deno.test('carryForward: a custom split moves to the posted row', () => {
  const { payers } = carryForward(
    [{ transaction_id: 'posted1', pending_transaction_id: 'p1' }],
    new Map([['p1', row('p1', { paid_by: null, paid_by_is_manual: true, split: { pedro: 70, kelvyn: 30 } })]]),
  );
  assertEquals(payers, [{ plaid_transaction_id: 'posted1', paid_by: null, split: { pedro: 70, kelvyn: 30 } }]);
});

Deno.test("carryForward: a payer from the account's owner is not carried; the database sets it", () => {
  const { payers } = carryForward(
    [{ transaction_id: 'posted1', pending_transaction_id: 'p1' }],
    new Map([['p1', row('p1')]]),
  );
  assertEquals(payers, []);
});

Deno.test('carryForward: an existing row keeps its own payer', () => {
  const { payers } = carryForward(
    [{ transaction_id: 'posted1', pending_transaction_id: 'p1' }],
    new Map([
      ['posted1', row('posted1')],
      ['p1', row('p1', { paid_by: 'kelvyn', paid_by_is_manual: true })],
    ]),
  );
  assertEquals(payers, []);
});

Deno.test('carryForward: a new posted row inherits its pending predecessor and its memo', () => {
  const pending = row('p1', { category_id: 'cat-manual', category_is_manual: true, notes: 'Dinner with Ana' });
  const { existingFor, notes } = carryForward(
    [{ transaction_id: 'posted1', pending_transaction_id: 'p1' }],
    new Map([['p1', pending]]),
  );
  assertEquals(existingFor.get('posted1'), pending);
  assertEquals(notes, [{ plaid_transaction_id: 'posted1', notes: 'Dinner with Ana' }]);
});

Deno.test('carryForward: a predecessor with no memo carries its category but writes no memo', () => {
  const pending = row('p1', { category_is_manual: true });
  const { existingFor, notes } = carryForward(
    [{ transaction_id: 'posted1', pending_transaction_id: 'p1' }],
    new Map([['p1', pending]]),
  );
  assertEquals(existingFor.get('posted1'), pending);
  assertEquals(notes, []);
});

Deno.test('carryForward: a row that already exists keeps its own data', () => {
  const own = row('posted1', { notes: 'mine' });
  const pending = row('p1', { notes: 'old' });
  const { existingFor, notes } = carryForward(
    [{ transaction_id: 'posted1', pending_transaction_id: 'p1' }],
    new Map([['posted1', own], ['p1', pending]]),
  );
  assertEquals(existingFor.get('posted1'), own);
  assertEquals(notes, []);
});

Deno.test('carryForward: no predecessor, or one already gone, means nothing to keep', () => {
  const { existingFor, notes } = carryForward(
    [
      { transaction_id: 'a' },
      { transaction_id: 'b', pending_transaction_id: null },
      { transaction_id: 'c', pending_transaction_id: 'gone' },
    ],
    new Map(),
  );
  assertEquals([...existingFor.values()], [null, null, null]);
  assertEquals(notes, []);
});

Deno.test('carryForward: a fixed pending row hands the posted row which source it corrected', () => {
  const { existingFor } = carryForward(
    [{ transaction_id: 'posted1', pending_transaction_id: 'p1' }],
    new Map([['p1', row('p1', { category_id: 'cat-mine', category_is_manual: true, corrected_from: 'plaid' })]]),
  );
  assertEquals(existingFor.get('posted1')?.corrected_from, 'plaid');
});

Deno.test('reviewCutoff: 14 days before the day the Item was linked, in UTC', () => {
  assertEquals(REVIEW_WINDOW_DAYS, 14);
  assertEquals(reviewCutoff('2026-10-15T12:00:00Z'), '2026-10-01');
  assertEquals(reviewCutoff(new Date('2026-10-15T23:59:59Z')), '2026-10-01');
  assertEquals(reviewCutoff('2026-10-15T00:00:00Z'), '2026-10-01');
});

Deno.test('reviewCutoff: crosses month and year boundaries and leap days', () => {
  assertEquals(reviewCutoff('2027-01-05T08:00:00Z'), '2026-12-22');
  assertEquals(reviewCutoff('2028-03-10T08:00:00Z'), '2028-02-25');
  assertEquals(reviewCutoff('2026-10-15T12:00:00+02:00'), '2026-10-01');
});

Deno.test('reviewCutoff: refuses a date it cannot read', () => {
  let threw = false;
  try {
    reviewCutoff('not a date');
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test('autoReviewIds: only new, posted rows dated before the cutoff', () => {
  const rows = [
    { plaid_transaction_id: 'old-new', date: '2026-09-01', pending: false },
    { plaid_transaction_id: 'on-cutoff', date: '2026-10-01', pending: false },
    { plaid_transaction_id: 'recent', date: '2026-10-10', pending: false },
    { plaid_transaction_id: 'old-existing', date: '2026-09-01', pending: false },
    { plaid_transaction_id: 'old-posted-from-pending', date: '2026-09-02', pending: false },
    { plaid_transaction_id: 'old-pending', date: '2026-09-03', pending: true },
  ];
  const existingFor = new Map<string, ExistingRow | null>([
    ['old-new', null],
    ['on-cutoff', null],
    ['recent', null],
    ['old-existing', row('old-existing')],
    ['old-posted-from-pending', row('p')],
    ['old-pending', null],
  ]);
  assertEquals(autoReviewIds(rows, existingFor, '2026-10-01'), ['old-new']);

  const { auto, rest } = partitionAutoReview(rows, existingFor, '2026-10-01');
  assertEquals(auto.map((r) => r.plaid_transaction_id), ['old-new']);
  assertEquals(
    rest.map((r) => r.plaid_transaction_id),
    ['on-cutoff', 'recent', 'old-existing', 'old-posted-from-pending', 'old-pending'],
  );
});
