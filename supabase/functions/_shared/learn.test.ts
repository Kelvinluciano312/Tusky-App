import { assertEquals } from 'jsr:@std/assert';

import { type Label, learnedCategory, usableLabels } from './learn.ts';

let day = 0;
/** A label; later calls are more recent. Amounts are signed: negative = money out. */
function label(amount: number, category_id: string, extra: Partial<Label> = {}): Label {
  day++;
  return { amount, category_id, date: `2026-09-${String(day).padStart(2, '0')}`, user_id: 'u1', is_private: false, ...extra };
}

Deno.test('learnedCategory needs at least two labels', () => {
  assertEquals(learnedCategory([], -5), null);
  assertEquals(learnedCategory([label(-5, 'coffee')], -5), null);
});

Deno.test('learnedCategory: two labels that agree win', () => {
  assertEquals(learnedCategory([label(-5, 'coffee'), label(-6, 'coffee')], -5.5), 'coffee');
});

Deno.test('learnedCategory separates one merchant by amount (gas station: snacks vs fuel)', () => {
  const labels = [label(-4, 'food'), label(-6, 'food'), label(-45, 'fuel'), label(-50, 'fuel')];
  assertEquals(learnedCategory(labels, -5), 'food');
  assertEquals(learnedCategory(labels, -48), 'fuel');
});

Deno.test('learnedCategory keeps money in and money out apart (a refund is not a purchase)', () => {
  const labels = [label(-5, 'coffee'), label(-6, 'coffee')];
  assertEquals(learnedCategory(labels, 5), null);
});

Deno.test('learnedCategory gives no guess for an amount far from every label', () => {
  // A $300 gift card at the coffee shop is not a $5 coffee.
  assertEquals(learnedCategory([label(-5, 'coffee'), label(-6, 'coffee')], -300), null);
});

Deno.test('learnedCategory gives no guess without a clear majority', () => {
  // 2 of 4 neighbours is under two thirds.
  assertEquals(learnedCategory([label(-5, 'coffee'), label(-5, 'food'), label(-6, 'coffee'), label(-6, 'food')], -5), null);
  // A tie of one each is also under the vote floor.
  assertEquals(learnedCategory([label(-5, 'coffee'), label(-5, 'food')], -5), null);
});

Deno.test('learnedCategory uses only the 10 most recent labels', () => {
  const old = Array.from({ length: 10 }, () => label(-5, 'coffee'));
  const recent = Array.from({ length: 10 }, () => label(-5, 'food'));
  assertEquals(learnedCategory([...old, ...recent], -5), 'food');
});

Deno.test('usableLabels: a private label teaches only its connector\'s private rows', () => {
  const shared = label(-5, 'a', { user_id: 'mate' });
  const matePrivate = label(-5, 'b', { user_id: 'mate', is_private: true });
  const minePrivate = label(-5, 'c', { user_id: 'me', is_private: true });
  const all = [shared, matePrivate, minePrivate];
  // A private row learns from shared labels and its own connector's private ones.
  assertEquals(usableLabels(all, 'me', true), [shared, minePrivate]);
  assertEquals(usableLabels(all, 'mate', true), [shared, matePrivate]);
  // A shared row is visible to the herd: a guess there must not reveal anyone's private fixes,
  // not even its own connector's.
  assertEquals(usableLabels(all, 'mate', false), [shared]);
  assertEquals(usableLabels(all, 'me', false), [shared]);
});
