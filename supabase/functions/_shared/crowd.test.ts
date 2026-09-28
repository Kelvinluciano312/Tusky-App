import { assertEquals } from 'jsr:@std/assert';

import {
  amountBand,
  communityAnswers,
  communityCategory,
  crowdKey,
  crowdMerchants,
  directionOf,
  type Tally,
} from './crowd.ts';

Deno.test('amountBand puts each edge in the band above it, by magnitude', () => {
  assertEquals(amountBand(0), 0);
  assertEquals(amountBand(-4.99), 0);
  assertEquals(amountBand(-5), 1);
  assertEquals(amountBand(14.99), 1);
  assertEquals(amountBand(15), 2);
  assertEquals(amountBand(-50), 3);
  assertEquals(amountBand(150), 4);
  assertEquals(amountBand(-499.99), 4);
  assertEquals(amountBand(500), 5);
  assertEquals(amountBand(-12000), 5);
});

Deno.test('directionOf: only a positive amount is money in', () => {
  assertEquals(directionOf(12), 'in');
  assertEquals(directionOf(-12), 'out');
  assertEquals(directionOf(0), 'out');
});

Deno.test('crowdMerchants tries the entity id first, then the normalized name', () => {
  assertEquals(crowdMerchants('ent_1', 'shell'), ['ent_1', 'k:shell']);
  assertEquals(crowdMerchants(null, 'shell'), ['k:shell']);
  assertEquals(crowdMerchants('', 'shell'), ['k:shell']);
  // A name with no letters has an empty key and matches nobody else's.
  assertEquals(crowdMerchants(null, ''), []);
  assertEquals(crowdMerchants('ent_1', ''), ['ent_1']);
});

const t = (category_id: string, votes: number, over: Partial<Tally> = {}): Tally => ({
  merchant: 'k:shell', direction: 'out', amount_band: 2, category_id, votes, ...over,
});

Deno.test('communityAnswers serves a band only at 3 contributors and 70% agreement', () => {
  const key = crowdKey('k:shell', 'out', 2);
  // 3 of 3: served.
  assertEquals(communityAnswers([t('gas', 3)]).get(key), 'gas');
  // 2 contributors, even unanimous: never served — one person's label must not show through.
  assertEquals(communityAnswers([t('gas', 2)]).has(key), false);
  // 2 of 3 is 67%: below the bar.
  assertEquals(communityAnswers([t('gas', 2), t('snacks', 1)]).has(key), false);
  // 7 of 10 is exactly 70%: served.
  assertEquals(communityAnswers([t('gas', 7), t('snacks', 3)]).get(key), 'gas');
  // A tie never wins.
  assertEquals(communityAnswers([t('gas', 3), t('snacks', 3)]).has(key), false);
});

Deno.test('communityAnswers keeps bands and directions apart', () => {
  const answers = communityAnswers([
    t('snacks', 3, { amount_band: 0 }),
    t('gas', 3, { amount_band: 2 }),
    t('refund', 3, { direction: 'in', amount_band: 2 }),
  ]);
  assertEquals(answers.get(crowdKey('k:shell', 'out', 0)), 'snacks');
  assertEquals(answers.get(crowdKey('k:shell', 'out', 2)), 'gas');
  assertEquals(answers.get(crowdKey('k:shell', 'in', 2)), 'refund');
});

Deno.test('communityCategory falls back to the name when the entity id has no answer', () => {
  const answers = communityAnswers([t('gas', 3)]);
  assertEquals(communityCategory(answers, 'ent_unknown', 'shell', -22), 'gas');
  // The entity's own answer wins when it has one.
  const both = communityAnswers([t('gas', 3), t('fuel', 3, { merchant: 'ent_1' })]);
  assertEquals(communityCategory(both, 'ent_1', 'shell', -22), 'fuel');
  // Wrong band, wrong direction, blank merchant: nothing.
  assertEquals(communityCategory(answers, null, 'shell', -3), null);
  assertEquals(communityCategory(answers, null, 'shell', 22), null);
  assertEquals(communityCategory(answers, null, '', -22), null);
});
