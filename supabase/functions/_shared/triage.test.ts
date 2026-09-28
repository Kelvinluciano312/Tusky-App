import { assertEquals } from 'jsr:@std/assert';

import type { JevResponse } from './jev.ts';
import {
  asksSplit,
  groupTriage,
  PRIORITY_LEVELS,
  readTriage,
  SPLIT_SUGGEST_AT,
  triageQuestions,
  type TriageRow,
  triageState,
} from './triage.ts';

const row = (over: Partial<TriageRow> = {}): TriageRow => ({
  id: 'r1',
  name: 'TRADER JOES 552',
  merchant_name: "Trader Joe's",
  amount: -84.1,
  category_name: 'Groceries',
  category_source: 'plaid',
  is_private: false,
  split: null,
  ...over,
});

const score = (s: number) => ({ type: 'score', score: s, confidence: 0.8, probabilities: {} });
const noul = (n: number) => ({ type: 'noul', noul: n });
const reply = (answers: Record<string, unknown>): JevResponse => ({ model: 'jev-1.13.0', answers });

Deno.test('three levels, and they read as a scale from routine to wrong', () => {
  assertEquals(PRIORITY_LEVELS.length, 3);
  assertEquals(PRIORITY_LEVELS[0].startsWith('Routine'), true);
  assertEquals(PRIORITY_LEVELS[2].startsWith('Likely needs a fix'), true);
});

Deno.test('asksSplit: only money out, on a shared account, in a shared herd, not already split', () => {
  assertEquals(asksSplit(row(), true), true);
  assertEquals(asksSplit(row(), false), false); // a herd of one has nobody to split with
  assertEquals(asksSplit(row({ is_private: true }), true), false); // private rows never count toward settle-up
  assertEquals(asksSplit(row({ amount: 2500 }), true), false); // income is not an expense
  assertEquals(asksSplit(row({ split: { a: 50, b: 50 } }), true), false); // the user already decided
});

Deno.test('a solo herd is never asked about splitting', () => {
  assertEquals(Object.keys(triageQuestions(row(), false)), ['review_priority']);
  assertEquals(Object.keys(triageQuestions(row(), true)).sort(), ['is_shared_expense', 'review_priority']);
});

Deno.test('the priority question is a three-level Score', () => {
  const q = triageQuestions(row(), false).review_priority;
  assertEquals(q.type, 'score');
  assertEquals((q as { criteria: string[] }).criteria, PRIORITY_LEVELS);
});

Deno.test('the state is the row and the herd size: no ids, balances or names of people', () => {
  assertEquals(triageState(row(), 2), {
    merchant: "Trader Joe's",
    description: 'TRADER JOES 552',
    amount: '84.10',
    direction: 'money out',
    category: 'Groceries',
    category_set_by: 'plaid',
    household_size: 2,
  });
  assertEquals(triageState(row({ category_name: null }), 1).category, 'Uncategorized');
});

Deno.test('the Score position rounds to its nearest level and stays on the scale', () => {
  const at = (s: number) => readTriage(row(), reply({ review_priority: score(s) }), false)?.review_priority;
  assertEquals(at(0.2), 0);
  assertEquals(at(1.43), 1);
  assertEquals(at(1.6), 2);
  assertEquals(at(2), 2);
  assertEquals(at(-0.4), 0);
  assertEquals(at(2.7), 2);
});

Deno.test('an unreadable priority leaves the whole row for the next sync', () => {
  assertEquals(readTriage(row(), reply({ is_shared_expense: noul(0.9) }), true), null);
});

Deno.test('the split hint needs a Noul at or over the bar', () => {
  const split = (n: number) =>
    readTriage(row(), reply({ review_priority: score(0), is_shared_expense: noul(n) }), true)?.split_suggested;
  assertEquals(split(SPLIT_SUGGEST_AT), true);
  assertEquals(split(0.95), true);
  assertEquals(split(0.69), false);
});

Deno.test('no split question means no split hint, not a "no"', () => {
  assertEquals(readTriage(row(), reply({ review_priority: score(0) }), false), {
    id: 'r1',
    review_priority: 0,
    split_suggested: null,
  });
  // Asked, but the answer was unreadable: still no hint either way.
  assertEquals(
    readTriage(row(), reply({ review_priority: score(0), is_shared_expense: { type: 'noul' } }), true)
      ?.split_suggested,
    null,
  );
});

Deno.test('results are grouped by what they write', () => {
  assertEquals(
    groupTriage([
      { id: 'a', review_priority: 2, split_suggested: true },
      { id: 'b', review_priority: 0, split_suggested: null },
      { id: 'c', review_priority: 2, split_suggested: true },
    ]),
    [
      { review_priority: 2, split_suggested: true, ids: ['a', 'c'] },
      { review_priority: 0, split_suggested: null, ids: ['b'] },
    ],
  );
});
