import { assertEquals } from 'jsr:@std/assert';

import { pickCategoryId, resolveCategoryId, toSignedAmount } from './categorize.ts';

const MAPS = {
  detailed: { FOOD_AND_DRINK_COFFEE: 'cat-coffee' },
  primary: { FOOD_AND_DRINK: 'cat-food', INCOME: 'cat-income' },
};
const FALLBACK = 'cat-uncategorized';

Deno.test('resolveCategoryId prefers the detailed code', () => {
  assertEquals(
    resolveCategoryId({ detailed: 'FOOD_AND_DRINK_COFFEE', primary: 'FOOD_AND_DRINK' }, MAPS, FALLBACK),
    'cat-coffee',
  );
});

Deno.test('resolveCategoryId falls to the primary for an unmapped detailed code', () => {
  // e.g. FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK lands on the group itself
  assertEquals(
    resolveCategoryId({ detailed: 'FOOD_AND_DRINK_VENDING_MACHINES', primary: 'FOOD_AND_DRINK' }, MAPS, FALLBACK),
    'cat-food',
  );
});

Deno.test('resolveCategoryId falls to the primary when there is no detailed code', () => {
  // Older rows can have pfc_detailed null.
  assertEquals(resolveCategoryId({ detailed: null, primary: 'INCOME' }, MAPS, FALLBACK), 'cat-income');
});

Deno.test('resolveCategoryId falls back when nothing maps', () => {
  assertEquals(resolveCategoryId({ primary: 'CRYPTO_MOONSHOTS' }, MAPS, FALLBACK), FALLBACK);
  assertEquals(resolveCategoryId({}, MAPS, FALLBACK), FALLBACK);
  assertEquals(resolveCategoryId({ detailed: undefined, primary: undefined }, MAPS, FALLBACK), FALLBACK);
});

Deno.test('resolveCategoryId puts a merchant rule above Plaid', () => {
  assertEquals(
    resolveCategoryId({ rule: 'cat-rule', detailed: 'FOOD_AND_DRINK_COFFEE', primary: 'FOOD_AND_DRINK' }, MAPS, FALLBACK),
    'cat-rule',
  );
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
