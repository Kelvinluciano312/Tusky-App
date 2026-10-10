import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert';

import {
  AI_MAX_PER_SYNC,
  type AiCategory,
  type AiLevel,
  type AiRow,
  applyAnswers,
  buildAskList,
  cacheKeyFor,
  categoryQuestions,
  categoryState,
  FALLBACK_SLUG,
  groupUpdates,
  JEV_CONFIDENCE,
  jevCategorizer,
  pickCategorization,
} from './ai.ts';
import { JEV_PASS_BUDGET_MS, type JevAsk, type JevResponse } from './jev.ts';

const CATS: AiCategory[] = [
  { id: 'g-food', slug: 'food_and_dining', name: 'Food & Dining', parent_slug: null },
  { id: 'c-groceries', slug: 'groceries', name: 'Groceries', parent_slug: 'food_and_dining' },
  { id: 'c-restaurants', slug: 'restaurants', name: 'Restaurants', parent_slug: 'food_and_dining' },
  { id: 'g-transport', slug: 'transportation', name: 'Transportation', parent_slug: null },
  { id: 'c-fuel', slug: 'gas', name: 'Gas', parent_slug: 'transportation' },
  { id: 'c-parking', slug: 'parking', name: 'Parking', parent_slug: 'transportation' },
  { id: 'g-none', slug: 'uncategorized', name: 'Uncategorized', parent_slug: null },
];

const row = (over: Partial<AiRow> = {}): AiRow => ({
  id: 't1',
  merchant_key: 'shell',
  name: 'SHELL OIL 4412',
  merchant_name: 'Shell',
  amount: -48.2,
  pfc_primary: 'TRANSPORTATION',
  pfc_detailed: null,
  is_private: false,
  ...over,
});

/** A verdict as the cache and the row writes carry it. */
const v = (category_id: string, confidence: number | null = 0.95, level: AiLevel | null = 'child') => ({
  category_id,
  confidence,
  level,
});

/** One merchant's answer from the categorizer; a null slug is a decline. */
const ans = (key: string, slug: string | null, confidence = 0.95, level: AiLevel = 'child') =>
  slug === null ? { key, slug } : { key, slug, confidence, level };

const choice = (c: string, confidence: number) => ({ type: 'choice', choice: c, confidence, probabilities: {} });
const reply = (answers: Record<string, unknown>): JevResponse => ({ model: 'jev-1.13.0', answers });
const SURE_GAS = reply({ group: choice('transportation', 0.97), child__transportation: choice('gas', 0.96) });

// --- The 12b scaffolding, now carrying confidence ---------------------------

Deno.test('the per-sync cap is 50', () => {
  assertEquals(AI_MAX_PER_SYNC, 50);
});

Deno.test('cacheKeyFor groups a merchant by direction and amount band, not by exact amount', () => {
  assertEquals(cacheKeyFor(row({ amount: -48.2 })), cacheKeyFor(row({ amount: -22 })));
  assertEquals(cacheKeyFor(row({ amount: 48.2 })) === cacheKeyFor(row({ amount: -48.2 })), false);
  assertEquals(cacheKeyFor(row({ amount: -4 })) === cacheKeyFor(row({ amount: -48 })), false);
});

Deno.test('a blank merchant keys on its own description, not on every other blank one', () => {
  const a = row({ id: 'a', merchant_key: '', merchant_name: null, name: 'SQ *BLUE BOTTLE' });
  const b = row({ id: 'b', merchant_key: '', merchant_name: null, name: 'POS DEBIT 88213' });
  assertEquals(cacheKeyFor(a) === cacheKeyFor(b), false);
});

Deno.test('buildAskList answers from the cache, confidence included, and only asks about the rest', () => {
  const cached = new Map([[cacheKeyFor(row()), v('c-fuel')]]);
  const other = row({ id: 't2', merchant_key: 'lidl', merchant_name: 'Lidl', name: 'LIDL 220', amount: -31 });
  const { ask, resolved } = buildAskList([row(), other], cached);
  assertEquals(ask.map((r) => r.id), ['t2']);
  assertEquals(resolved.get('t1'), v('c-fuel'));
});

Deno.test('the same merchant twice in one batch is asked about once, and both rows get the answer', () => {
  const a = row({ id: 'a' });
  const b = row({ id: 'b', amount: -49 });
  const { ask } = buildAskList([a, b], new Map());
  assertEquals(ask.length, 1);

  const { updates } = applyAnswers([a, b], [ans(cacheKeyFor(a), 'gas')], CATS);
  assertEquals(updates.sort((x, y) => x.id.localeCompare(y.id)), [
    { id: 'a', ...v('c-fuel') },
    { id: 'b', ...v('c-fuel') },
  ]);
});

Deno.test('a slug we never offered is ignored, and the row keeps what it had', () => {
  const { updates, cacheable } = applyAnswers([row()], [ans(cacheKeyFor(row()), 'crypto-moonshots')], CATS);
  assertEquals(updates, []);
  assertEquals(cacheable, []);
});

Deno.test('an answer for a key we did not ask about is ignored', () => {
  const { updates } = applyAnswers([row()], [ans('some-other-key', 'gas')], CATS);
  assertEquals(updates, []);
});

Deno.test('a duplicated key takes the first answer and ignores the rest', () => {
  const key = cacheKeyFor(row());
  const { updates } = applyAnswers([row()], [ans(key, 'gas'), ans(key, 'groceries')], CATS);
  assertEquals(updates, [{ id: 't1', ...v('c-fuel') }]);
});

Deno.test('a private row takes the answer but never reaches the global cache', () => {
  const secret = row({ id: 'p1', is_private: true });
  const { updates, cacheable } = applyAnswers([secret], [ans(cacheKeyFor(secret), 'gas')], CATS);
  assertEquals(updates, [{ id: 'p1', ...v('c-fuel') }]);
  assertEquals(cacheable, []);
});

Deno.test('a shared row is cacheable, with its confidence and level', () => {
  const { cacheable } = applyAnswers([row()], [ans(cacheKeyFor(row()), 'gas')], CATS);
  assertEquals(cacheable, [{ key: cacheKeyFor(row()), ...v('c-fuel') }]);
});

Deno.test('a group-level answer lands on the group', () => {
  const { updates } = applyAnswers([row()], [ans(cacheKeyFor(row()), 'transportation', 0.92, 'group')], CATS);
  assertEquals(updates, [{ id: 't1', ...v('g-transport', 0.92, 'group') }]);
});

Deno.test('an explicit decline is remembered, so the merchant is asked about once', () => {
  const key = cacheKeyFor(row());
  const { updates, unanswered } = applyAnswers([row()], [ans(key, null)], CATS, [key]);
  assertEquals(updates, []);
  assertEquals(unanswered, [key]);
});

Deno.test('an asked key with no usable answer is remembered as declined', () => {
  const asked = [cacheKeyFor(row())];
  const { updates, unanswered } = applyAnswers([row()], [], CATS, asked);
  assertEquals(updates, []);
  assertEquals(unanswered, asked);
});

Deno.test('a private row the model declined is not remembered either', () => {
  const secret = row({ is_private: true });
  const { unanswered } = applyAnswers([secret], [], CATS, [cacheKeyFor(secret)]);
  assertEquals(unanswered, []);
});

Deno.test('a remembered "no answer" resolves the row without asking again', () => {
  const cached = new Map([[cacheKeyFor(row()), null]]);
  const { ask, resolved } = buildAskList([row()], cached);
  assertEquals(ask, []);
  assertEquals(resolved.size, 0);
});

Deno.test('an answer for a key outside the ask list is ignored', () => {
  const { updates } = applyAnswers([row()], [ans(cacheKeyFor(row()), 'gas')], CATS, []);
  assertEquals(updates, []);
});

Deno.test('updates are grouped by what they write and chunked, not written one row at a time', () => {
  const updates = [
    { id: 'a', ...v('c-fuel') },
    { id: 'b', ...v('c-fuel') },
    { id: 'c', ...v('c-fuel') },
    { id: 'd', ...v('c-fuel', 0.91) },
    { id: 'e', ...v('c-groceries') },
  ];
  assertEquals(groupUpdates(updates, 2), [
    { verdict: v('c-fuel'), ids: ['a', 'b'] },
    { verdict: v('c-fuel'), ids: ['c'] },
    { verdict: v('c-fuel', 0.91), ids: ['d'] },
    { verdict: v('c-groceries'), ids: ['e'] },
  ]);
});

// --- The Jev fan-out -------------------------------------------------------

Deno.test('the group question offers every group, with "none fits" for the fallback', () => {
  const q = categoryQuestions(CATS);
  assertEquals(q.group.type, 'choice');
  const criteria = (q.group as { criteria: Record<string, string> }).criteria;
  assertEquals(Object.keys(criteria).sort(), ['food_and_dining', 'transportation', 'uncategorized']);
  // The children's names tell Jev what each group means.
  assertEquals(criteria.food_and_dining, 'Food & Dining (Groceries, Restaurants)');
  assertEquals(criteria[FALLBACK_SLUG], 'None of these clearly fits');
});

Deno.test('one child question per group with at least two children, all in the same request', () => {
  const q = categoryQuestions(CATS);
  assertEquals(Object.keys(q).sort(), ['child__food_and_dining', 'child__transportation', 'group']);
  assertEquals((q.child__transportation as { criteria: Record<string, string> }).criteria, {
    gas: 'Gas',
    parking: 'Parking',
  });
});

Deno.test('a group with one child gets no child question: one option is not a choice', () => {
  const q = categoryQuestions([
    ...CATS,
    { id: 'g-gifts', slug: 'gifts', name: 'Gifts', parent_slug: null },
    { id: 'c-donations', slug: 'donations', name: 'Donations', parent_slug: 'gifts' },
  ]);
  assertEquals('child__gifts' in q, false);
  assertEquals('gifts' in (q.group as { criteria: Record<string, string> }).criteria, true);
});

Deno.test('the state is merchant-level text only', () => {
  assertEquals(categoryState(row()), {
    merchant: 'Shell',
    description: 'SHELL OIL 4412',
    amount: '48.20',
    direction: 'money out',
    bank_guess: 'TRANSPORTATION',
  });
});

Deno.test('a sure group and a sure child write the child', () => {
  assertEquals(pickCategorization(SURE_GAS, CATS), { slug: 'gas', confidence: 0.96, level: 'child' });
});

Deno.test('the threshold is inclusive', () => {
  const res = reply({
    group: choice('transportation', JEV_CONFIDENCE),
    child__transportation: choice('gas', JEV_CONFIDENCE),
  });
  assertEquals(pickCategorization(res, CATS), { slug: 'gas', confidence: JEV_CONFIDENCE, level: 'child' });
});

Deno.test('a sure group with an unsure child writes the group', () => {
  const res = reply({ group: choice('transportation', 0.97), child__transportation: choice('gas', 0.6) });
  assertEquals(pickCategorization(res, CATS), { slug: 'transportation', confidence: 0.97, level: 'group' });
});

Deno.test('an unsure group declines even when its child question is sure', () => {
  // The child question asked "within Transportation…". If the group itself is
  // doubtful, a confident child is a confident answer to the wrong question.
  const res = reply({ group: choice('transportation', 0.7), child__transportation: choice('gas', 0.99) });
  assertEquals(pickCategorization(res, CATS), null);
});

Deno.test('"none of these fits" is a decline', () => {
  assertEquals(pickCategorization(reply({ group: choice(FALLBACK_SLUG, 0.99) }), CATS), null);
});

Deno.test('a child from another group falls back to the group', () => {
  const res = reply({ group: choice('transportation', 0.97), child__transportation: choice('groceries', 0.99) });
  assertEquals(pickCategorization(res, CATS), { slug: 'transportation', confidence: 0.97, level: 'group' });
});

Deno.test('a group with no child question is answered at the group', () => {
  assertEquals(pickCategorization(reply({ group: choice('transportation', 0.95) }), CATS), {
    slug: 'transportation',
    confidence: 0.95,
    level: 'group',
  });
});

Deno.test('an unreadable reply throws: it is a failed call, not a decline', () => {
  assertThrows(() => pickCategorization(reply({}), CATS));
  assertThrows(() => pickCategorization(reply({ group: choice('crypto', 0.99) }), CATS));
});

Deno.test('jevCategorizer asks once per merchant, with the whole fan-out and the pass deadline', async () => {
  const seen: { state: unknown; keys: string[]; deadline?: number }[] = [];
  const ask: JevAsk = (state, questions, opts) => {
    seen.push({ state, keys: Object.keys(questions).sort(), deadline: opts?.deadline });
    return Promise.resolve(SURE_GAS);
  };
  const before = Date.now();
  const answers = await jevCategorizer(ask)([row()], CATS);
  assertEquals(answers, [{ key: cacheKeyFor(row()), slug: 'gas', confidence: 0.96, level: 'child' }]);
  assertEquals(seen.length, 1);
  assertEquals(seen[0].state, categoryState(row()));
  assertEquals(seen[0].keys, ['child__food_and_dining', 'child__transportation', 'group']);
  assertEquals(seen[0].deadline !== undefined && seen[0].deadline <= before + JEV_PASS_BUDGET_MS + 50, true);
});

Deno.test('jevCategorizer returns a decline as a null slug', async () => {
  const answers = await jevCategorizer(() => Promise.resolve(reply({ group: choice(FALLBACK_SLUG, 0.99) })))(
    [row()],
    CATS,
  );
  assertEquals(answers, [{ key: cacheKeyFor(row()), slug: null }]);
});

Deno.test('a failed call is left out, not declined', async () => {
  const lidl = row({ id: 't2', merchant_key: 'lidl', merchant_name: 'Lidl', name: 'LIDL 220', amount: -31 });
  const ask: JevAsk = (state) =>
    (state as { merchant: string }).merchant === 'Lidl'
      ? Promise.reject(new Error('jev: HTTP 503'))
      : Promise.resolve(SURE_GAS);
  const answers = await jevCategorizer(ask)([row(), lidl], CATS);
  assertEquals(answers.map((a) => a.key), [cacheKeyFor(row())]);
});

Deno.test('every call failing throws, so the pass logs why', async () => {
  await assertRejects(
    () => jevCategorizer(() => Promise.reject(new Error('jev: HTTP 402')))([row()], CATS),
    Error,
    '402',
  );
});

Deno.test('an unreadable reply for every merchant throws too', async () => {
  await assertRejects(() => jevCategorizer(() => Promise.resolve(reply({})))([row()], CATS));
});

Deno.test('no rows, no calls', async () => {
  let calls = 0;
  const answers = await jevCategorizer(() => {
    calls++;
    return Promise.resolve(SURE_GAS);
  })([], CATS);
  assertEquals(answers, []);
  assertEquals(calls, 0);
});
