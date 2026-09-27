import { assertEquals } from 'jsr:@std/assert';

import {
  AI_MAX_PER_SYNC,
  type AiCategory,
  type AiRow,
  aiAllowed,
  applyAnswers,
  buildAskList,
  cacheKeyFor,
} from './ai.ts';

const CATS: AiCategory[] = [
  { id: 'c-groceries', slug: 'groceries', name: 'Groceries', parent_name: 'Food & Dining' },
  { id: 'c-fuel', slug: 'gas', name: 'Gas', parent_name: 'Transportation' },
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

Deno.test('aiAllowed lets every herd through for now — the seam a subscription check will fill', () => {
  assertEquals(aiAllowed('any-herd-id'), true);
});

Deno.test('the per-sync cap is 50', () => {
  assertEquals(AI_MAX_PER_SYNC, 50);
});

Deno.test('cacheKeyFor groups a merchant by direction and amount band, not by exact amount', () => {
  // Two fill-ups inside one band are the same question; the band is what makes
  // the cache pay. (Amounts either side of a band edge ask twice — the cost of
  // any fixed banding, and harmless: the second answer just isn't a cache hit.)
  assertEquals(cacheKeyFor(row({ amount: -48.2 })), cacheKeyFor(row({ amount: -22 })));
  // Money in is a different question from money out.
  assertEquals(cacheKeyFor(row({ amount: 48.2 })) === cacheKeyFor(row({ amount: -48.2 })), false);
  // A $5 snack is not a $50 fill-up.
  assertEquals(cacheKeyFor(row({ amount: -4 })) === cacheKeyFor(row({ amount: -48 })), false);
});

Deno.test('a blank merchant keys on its own description, not on every other blank one', () => {
  const a = row({ id: 'a', merchant_key: '', merchant_name: null, name: 'SQ *BLUE BOTTLE' });
  const b = row({ id: 'b', merchant_key: '', merchant_name: null, name: 'POS DEBIT 88213' });
  assertEquals(cacheKeyFor(a) === cacheKeyFor(b), false);
});

Deno.test('buildAskList answers from the cache and only asks about the rest', () => {
  const cached = new Map([[cacheKeyFor(row()), 'c-fuel']]);
  const other = row({ id: 't2', merchant_key: 'lidl', merchant_name: 'Lidl', name: 'LIDL 220', amount: -31 });
  const { ask, resolved } = buildAskList([row(), other], cached);
  assertEquals(ask.map((r) => r.id), ['t2']);
  assertEquals(resolved.get('t1'), 'c-fuel');
});

Deno.test('the same merchant twice in one batch is asked about once, and both rows get the answer', () => {
  const a = row({ id: 'a' });
  const b = row({ id: 'b', amount: -49 }); // same merchant, same band
  const { ask } = buildAskList([a, b], new Map());
  assertEquals(ask.length, 1);

  const { updates } = applyAnswers([a, b], [{ key: cacheKeyFor(a), slug: 'gas' }], CATS);
  assertEquals(updates.sort((x, y) => x.id.localeCompare(y.id)), [
    { id: 'a', category_id: 'c-fuel' },
    { id: 'b', category_id: 'c-fuel' },
  ]);
});

Deno.test('a slug we never offered is ignored, and the row keeps what it had', () => {
  const { updates, cacheable } = applyAnswers([row()], [{ key: cacheKeyFor(row()), slug: 'crypto-moonshots' }], CATS);
  assertEquals(updates, []);
  assertEquals(cacheable, []);
});

Deno.test('an answer for a key we did not ask about is ignored', () => {
  const { updates } = applyAnswers([row()], [{ key: 'some-other-key', slug: 'gas' }], CATS);
  assertEquals(updates, []);
});

Deno.test('a duplicated key takes the first answer and ignores the rest', () => {
  const key = cacheKeyFor(row());
  const { updates } = applyAnswers([row()], [{ key, slug: 'gas' }, { key, slug: 'groceries' }], CATS);
  assertEquals(updates, [{ id: 't1', category_id: 'c-fuel' }]);
});

Deno.test('a private row takes the answer but never reaches the global cache', () => {
  const secret = row({ id: 'p1', is_private: true });
  const { updates, cacheable } = applyAnswers([secret], [{ key: cacheKeyFor(secret), slug: 'gas' }], CATS);
  assertEquals(updates, [{ id: 'p1', category_id: 'c-fuel' }]);
  // Caching it would show another herd which merchants someone keeps private.
  assertEquals(cacheable, []);
});

Deno.test('a shared row is cacheable', () => {
  const { cacheable } = applyAnswers([row()], [{ key: cacheKeyFor(row()), slug: 'gas' }], CATS);
  assertEquals(cacheable, [{ key: cacheKeyFor(row()), category_id: 'c-fuel' }]);
});
