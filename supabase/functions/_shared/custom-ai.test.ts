import { assertEquals, assertThrows } from 'jsr:@std/assert';

import { JEV_CONFIDENCE } from './ai.ts';
import {
  applyCustom,
  askCustom,
  type CatRow,
  customQuestion,
  type CustomRow,
  CUSTOM_MAX_PER_SYNC,
  pickCustom,
  planCustom,
} from './custom-ai.ts';
import type { JevAsk, JevResponse } from './jev.ts';

const H = 'herd-1';
const CATS: CatRow[] = [
  { id: 'g-food', name: 'Food & Dining', parent_id: null, herd_id: null },
  { id: 'c-restaurants', name: 'Restaurants', parent_id: 'g-food', herd_id: null },
  { id: 'g-shop', name: 'Shopping', parent_id: null, herd_id: null },
  { id: 'x-date', name: 'Date night', parent_id: 'g-food', herd_id: H },
  { id: 'x-work', name: 'Work lunches', parent_id: 'g-food', herd_id: H },
  { id: 'x-other-herd', name: 'Not ours', parent_id: 'g-shop', herd_id: 'herd-2' },
];

const row = (over: Partial<CustomRow> = {}): CustomRow => ({
  id: 't1',
  merchant_key: 'olive garden',
  name: 'OLIVE GARDEN 123',
  merchant_name: 'Olive Garden',
  amount: -64,
  pfc_primary: null,
  pfc_detailed: null,
  is_private: false,
  category_id: 'c-restaurants',
  ...over,
});

const choice = (answer: string, confidence = 0.95): JevResponse => ({
  model: 'jev',
  answers: { custom: { type: 'choice', choice: answer, confidence } },
});

Deno.test('planCustom offers the herd\'s own categories under the row\'s group, children or group alike', () => {
  const plans = planCustom([row(), row({ id: 't2', category_id: 'g-food' })], CATS, H);
  assertEquals(plans.map((p) => p.options.map((o) => o.id)), [['x-date', 'x-work'], ['x-date', 'x-work']]);
  assertEquals(plans[0].group.id, 'g-food');
});

Deno.test('planCustom skips groups without custom children, other herds\' categories, and rows already custom', () => {
  assertEquals(planCustom([row({ category_id: 'g-shop' })], CATS, H), []);
  assertEquals(planCustom([row({ category_id: 'x-date' })], CATS, H), []);
});

Deno.test('the cache key changes when the custom set does', () => {
  const [a] = planCustom([row()], CATS, H);
  const [b] = planCustom([row()], [...CATS, { id: 'x-new', name: 'Brunch', parent_id: 'g-food', herd_id: H }], H);
  assertEquals(a.key === b.key, false);
});

Deno.test('customQuestion names each option and the way to keep, with no database ids', () => {
  const [plan] = planCustom([row()], CATS, H);
  const q = customQuestion(plan).custom;
  assertEquals(q.type, 'choice');
  if (q.type !== 'choice') return;
  assertEquals(q.criteria, { c0: 'Date night', c1: 'Work lunches', keep: 'Restaurants (none of the others fits better)' });
});

Deno.test('pickCustom: a sure option, keep, an unsure option, and a reply it cannot read', () => {
  const [plan] = planCustom([row()], CATS, H);
  assertEquals(pickCustom(choice('c1'), plan.options), { category_id: 'x-work', confidence: 0.95 });
  assertEquals(pickCustom(choice('keep'), plan.options), null);
  assertEquals(pickCustom(choice('c0', JEV_CONFIDENCE - 0.01), plan.options), null);
  assertThrows(() => pickCustom({ model: 'jev', answers: {} }, plan.options));
  assertThrows(() => pickCustom(choice('c9'), plan.options));
});

Deno.test('askCustom asks once per key, caps the batch, and leaves failed calls out', async () => {
  const rows = Array.from({ length: CUSTOM_MAX_PER_SYNC + 5 }, (_, i) =>
    row({ id: `t${i}`, merchant_key: `m${i}`, merchant_name: `M${i}` })
  );
  const plans = planCustom([...rows, row({ id: 'dup', merchant_key: 'm0', merchant_name: 'M0' })], CATS, H);
  let calls = 0;
  const ask: JevAsk = (state) => {
    calls++;
    if ((state as { merchant: string }).merchant === 'M1') return Promise.reject(new Error('timeout'));
    return Promise.resolve(choice('c0'));
  };
  const answers = await askCustom(plans, ask);
  assertEquals(calls, CUSTOM_MAX_PER_SYNC);
  assertEquals(answers.size, CUSTOM_MAX_PER_SYNC - 1);
  assertEquals(answers.get(plans[0].key), { category_id: 'x-date', confidence: 0.95 });
});

Deno.test('applyCustom writes custom answers, caches fresh ones, and never caches a private row', () => {
  const plans = planCustom([row(), row({ id: 'p', merchant_key: 'secret', is_private: true })], CATS, H);
  const fresh = new Map([
    [plans[0].key, { category_id: 'x-date', confidence: 0.97 }],
    [plans[1].key, { category_id: 'x-work', confidence: 0.92 }],
  ]);
  const { updates, cacheable } = applyCustom(plans, new Map(), fresh);
  assertEquals(updates.map((u) => [u.id, u.category_id]), [['t1', 'x-date'], ['p', 'x-work']]);
  assertEquals(cacheable.map((c) => c.key), [plans[0].key]);
});

Deno.test('applyCustom: a cached decline keeps the row, and cache hits are not re-cached', () => {
  const [plan] = planCustom([row()], CATS, H);
  const { updates, cacheable } = applyCustom([plan], new Map([[plan.key, { category_id: null, confidence: null }]]), new Map());
  assertEquals(updates, []);
  assertEquals(cacheable, []);
});
