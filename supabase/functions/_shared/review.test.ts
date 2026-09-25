import { assertEquals } from 'jsr:@std/assert';

import { carryForward, type ExistingRow } from './review.ts';

const row = (id: string, over: Partial<ExistingRow> = {}): ExistingRow => ({
  plaid_transaction_id: id,
  category_id: 'cat-plaid',
  category_is_manual: false,
  notes: null,
  paid_by: 'owner',
  paid_by_is_manual: false,
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
    { plaid_transaction_id: 'posted1', paid_by: 'kelvyn' },
    { plaid_transaction_id: 'posted2', paid_by: null },
  ]);
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
