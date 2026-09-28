import { assertEquals } from 'jsr:@std/assert';

import { type MergeRow, pairAccounts, planMerge } from './merge.ts';

const row = (id: string, date: string, over: Partial<MergeRow> = {}): MergeRow => ({
  id, date, amount: -12.5, merchant_key: 'starbucks', category_id: 'c-plaid', category_is_manual: false,
  notes: null, paid_by: null, paid_by_is_manual: false, split: null, reviewed_at: null, ...over,
});
const MEMBERS = new Set(['me', 'kel']);

Deno.test('pairAccounts: same name and mask, ignoring case and spaces', () => {
  assertEquals(
    pairAccounts(
      [{ id: 'n1', name: 'Plaid Checking', mask: '0000' }, { id: 'n2', name: 'Plaid Saving', mask: '1111' }],
      [{ id: 'o1', name: ' plaid checking ', mask: '0000' }, { id: 'o3', name: 'Plaid CD', mask: '2222' }],
    ),
    [{ fresh: 'n1', archived: 'o1' }],
  );
});

Deno.test('planMerge: edits move to the twin; the overlap is deleted, older rows stay', () => {
  const old = [
    row('o-early', '2026-01-05'),
    row('o1', '2026-03-01', { category_id: 'c-coffee', category_is_manual: true, notes: 'with Kel', reviewed_at: '2026-03-02T00:00:00Z' }),
    row('o2', '2026-03-02', { amount: -40 }),
  ];
  const fresh = [row('n1', '2026-03-01'), row('n0', '2026-02-20', { merchant_key: 'uber' })];
  assertEquals(planMerge(old, fresh, MEMBERS), {
    updates: [{
      id: 'n1',
      patch: { category_id: 'c-coffee', category_is_manual: true, notes: 'with Kel', reviewed_at: '2026-03-02T00:00:00Z' },
    }],
    deleteIds: ['o1', 'o2'],
  });
});

Deno.test('planMerge: never overwrites what the new row already has', () => {
  const old = [row('o1', '2026-03-01', { notes: 'old memo', category_id: 'c-a', category_is_manual: true })];
  const fresh = [row('n1', '2026-03-01', { notes: 'new memo', category_id: 'c-b', category_is_manual: true })];
  assertEquals(planMerge(old, fresh, MEMBERS).updates, []);
});

Deno.test('planMerge: a payer and a split carry; a leaver does not', () => {
  const old = [
    row('o1', '2026-03-01', { paid_by: 'kel', paid_by_is_manual: true }),
    row('o2', '2026-03-02', { paid_by: null, paid_by_is_manual: true, split: { me: 50, kel: 50 } }),
    row('o3', '2026-03-03', { paid_by: 'gone', paid_by_is_manual: true }),
    row('o4', '2026-03-04', { paid_by: null, paid_by_is_manual: true, split: { me: 50, gone: 50 } }),
  ];
  const fresh = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04'].map((d, k) => row(`n${k + 1}`, d));
  assertEquals(planMerge(old, fresh, MEMBERS).updates, [
    { id: 'n1', patch: { paid_by: 'kel', paid_by_is_manual: true, split: null } },
    { id: 'n2', patch: { paid_by: null, paid_by_is_manual: true, split: { me: 50, kel: 50 } } },
  ]);
});

Deno.test('planMerge: two identical purchases pair one to one', () => {
  const old = [row('o1', '2026-03-01', { notes: 'first' }), row('o2', '2026-03-01', { notes: 'second' })];
  const fresh = [row('n1', '2026-03-01'), row('n2', '2026-03-01')];
  assertEquals(planMerge(old, fresh, MEMBERS).updates.map((u) => [u.id, u.patch.notes]), [['n1', 'first'], ['n2', 'second']]);
});

Deno.test('planMerge: history arriving in stages merges again without undoing the first pass', () => {
  const old = [row('o1', '2026-01-10', { notes: 'jan' }), row('o2', '2026-03-01', { notes: 'mar' })];
  // First sync: only March has arrived.
  const first = planMerge(old, [row('n2', '2026-03-01')], MEMBERS);
  assertEquals(first.deleteIds, ['o2']);
  // Next sync: January arrives; o2 is gone and n2 already carries its memo.
  const second = planMerge([old[0]], [row('n1', '2026-01-10'), row('n2', '2026-03-01', { notes: 'mar' })], MEMBERS);
  assertEquals(second, { updates: [{ id: 'n1', patch: { notes: 'jan' } }], deleteIds: ['o1'] });
});

Deno.test('planMerge: no new rows yet means nothing changes', () => {
  assertEquals(planMerge([row('o1', '2026-03-01')], [], MEMBERS), { updates: [], deleteIds: [] });
});
