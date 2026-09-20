import { assertEquals } from 'jsr:@std/assert';

import { pickCategoryId, resolveCategoryId, toSignedAmount } from './categorize.ts';

const MAP = { FOOD_AND_DRINK: 'cat-food', INCOME: 'cat-income' };
const FALLBACK = 'cat-uncategorized';

Deno.test('resolveCategoryId maps a known PFC primary', () => {
  assertEquals(resolveCategoryId(MAP, 'FOOD_AND_DRINK', FALLBACK), 'cat-food');
});

Deno.test('resolveCategoryId falls back for an unknown primary', () => {
  assertEquals(resolveCategoryId(MAP, 'CRYPTO_MOONSHOTS', FALLBACK), FALLBACK);
});

Deno.test('resolveCategoryId falls back for null/undefined', () => {
  assertEquals(resolveCategoryId(MAP, null, FALLBACK), FALLBACK);
  assertEquals(resolveCategoryId(MAP, undefined, FALLBACK), FALLBACK);
});

Deno.test('pickCategoryId keeps a manual override', () => {
  assertEquals(pickCategoryId({ category_id: 'cat-user-chose', category_is_manual: true }, 'cat-food'), 'cat-user-chose');
});

Deno.test('pickCategoryId takes the incoming category when not manual', () => {
  assertEquals(pickCategoryId({ category_id: 'cat-old', category_is_manual: false }, 'cat-food'), 'cat-food');
});

Deno.test('pickCategoryId takes the incoming category for a new transaction', () => {
  assertEquals(pickCategoryId(null, 'cat-food'), 'cat-food');
});

Deno.test('pickCategoryId ignores a manual flag with no category set', () => {
  assertEquals(pickCategoryId({ category_id: null, category_is_manual: true }, 'cat-food'), 'cat-food');
});

Deno.test('toSignedAmount inverts Plaid outflow to negative', () => {
  assertEquals(toSignedAmount(28.34), -28.34);
});

Deno.test('toSignedAmount inverts Plaid inflow to positive', () => {
  assertEquals(toSignedAmount(-2400), 2400);
});

Deno.test('toSignedAmount leaves zero alone', () => {
  assertEquals(toSignedAmount(0), 0);
});
