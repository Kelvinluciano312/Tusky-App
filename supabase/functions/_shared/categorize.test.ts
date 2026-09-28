import { assertEquals } from 'jsr:@std/assert';

import { pickCategory, resolveCategory, toSignedAmount } from './categorize.ts';

const MAPS = {
  detailed: { FOOD_AND_DRINK_COFFEE: 'cat-coffee' },
  primary: { FOOD_AND_DRINK: 'cat-food', INCOME: 'cat-income' },
};
const FALLBACK = 'cat-uncategorized';

Deno.test('resolveCategory prefers the detailed code', () => {
  assertEquals(
    resolveCategory({ detailed: 'FOOD_AND_DRINK_COFFEE', primary: 'FOOD_AND_DRINK' }, MAPS, FALLBACK),
    { categoryId: 'cat-coffee', source: 'plaid' },
  );
});

Deno.test('resolveCategory falls to the primary for an unmapped detailed code', () => {
  // e.g. FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK lands on the group itself
  assertEquals(
    resolveCategory({ detailed: 'FOOD_AND_DRINK_VENDING_MACHINES', primary: 'FOOD_AND_DRINK' }, MAPS, FALLBACK),
    { categoryId: 'cat-food', source: 'plaid' },
  );
});

Deno.test('resolveCategory falls to the primary when there is no detailed code', () => {
  // Older rows can have pfc_detailed null.
  assertEquals(resolveCategory({ detailed: null, primary: 'INCOME' }, MAPS, FALLBACK), { categoryId: 'cat-income', source: 'plaid' });
});

Deno.test('resolveCategory falls back when nothing maps', () => {
  const fallback = { categoryId: FALLBACK, source: 'fallback' };
  assertEquals(resolveCategory({ primary: 'CRYPTO_MOONSHOTS' }, MAPS, FALLBACK), fallback);
  assertEquals(resolveCategory({}, MAPS, FALLBACK), fallback);
  assertEquals(resolveCategory({ detailed: undefined, primary: undefined }, MAPS, FALLBACK), fallback);
});

Deno.test('resolveCategory precedence: rule > learned > plaid > fallback', () => {
  const plaid = { detailed: 'FOOD_AND_DRINK_COFFEE', primary: 'FOOD_AND_DRINK' };
  assertEquals(resolveCategory({ rule: 'cat-rule', learned: 'cat-learned', ...plaid }, MAPS, FALLBACK), { categoryId: 'cat-rule', source: 'rule' });
  assertEquals(resolveCategory({ rule: 'cat-rule', primary: 'CRYPTO_MOONSHOTS' }, MAPS, FALLBACK), { categoryId: 'cat-rule', source: 'rule' });
  assertEquals(resolveCategory({ learned: 'cat-learned', ...plaid }, MAPS, FALLBACK), { categoryId: 'cat-learned', source: 'learned' });
  assertEquals(resolveCategory({ learned: 'cat-learned', primary: 'CRYPTO_MOONSHOTS' }, MAPS, FALLBACK), { categoryId: 'cat-learned', source: 'learned' });
  assertEquals(resolveCategory({ rule: null, learned: null, ...plaid }, MAPS, FALLBACK), { categoryId: 'cat-coffee', source: 'plaid' });
});

Deno.test('pickCategory keeps a manual override, as source manual', () => {
  assertEquals(
    pickCategory({ category_id: 'cat-user-chose', category_is_manual: true }, { categoryId: 'cat-food', source: 'learned' }),
    { categoryId: 'cat-user-chose', source: 'manual' },
  );
});

Deno.test('pickCategory takes the incoming category when not manual', () => {
  const incoming = { categoryId: 'cat-food', source: 'rule' } as const;
  assertEquals(pickCategory({ category_id: 'cat-old', category_is_manual: false }, incoming), incoming);
});

Deno.test('pickCategory takes the incoming category for a new transaction', () => {
  const incoming = { categoryId: 'cat-food', source: 'plaid' } as const;
  assertEquals(pickCategory(null, incoming), incoming);
});

Deno.test('pickCategory ignores a manual flag with no category set', () => {
  const incoming = { categoryId: 'cat-food', source: 'plaid' } as const;
  assertEquals(pickCategory({ category_id: null, category_is_manual: true }, incoming), incoming);
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

Deno.test('an AI answer outranks Plaid, and yields to a rule or what the herd taught', () => {
  const maps = { detailed: { COFFEE: 'c-coffee' }, primary: { FOOD_AND_DRINK: 'c-food' } };
  const sources = { ai: 'c-ai', detailed: 'COFFEE', primary: 'FOOD_AND_DRINK' };
  // Plaid was unsure about these rows in the first place: that is why AI saw them.
  assertEquals(resolveCategory(sources, maps, 'c-uncat'), { categoryId: 'c-ai', source: 'ai' });
  assertEquals(resolveCategory({ ...sources, rule: 'c-rule' }, maps, 'c-uncat'), {
    categoryId: 'c-rule',
    source: 'rule',
  });
  assertEquals(resolveCategory({ ...sources, learned: 'c-learned' }, maps, 'c-uncat'), {
    categoryId: 'c-learned',
    source: 'learned',
  });
});

Deno.test('resolveCategory precedence around community: learned > community > ai > plaid', () => {
  const plaid = { detailed: 'FOOD_AND_DRINK_COFFEE', primary: 'FOOD_AND_DRINK' };
  assertEquals(
    resolveCategory({ rule: 'cat-rule', community: 'cat-crowd', ...plaid }, MAPS, FALLBACK),
    { categoryId: 'cat-rule', source: 'rule' },
  );
  assertEquals(
    resolveCategory({ learned: 'cat-learned', community: 'cat-crowd', ...plaid }, MAPS, FALLBACK),
    { categoryId: 'cat-learned', source: 'learned' },
  );
  assertEquals(
    resolveCategory({ community: 'cat-crowd', ai: 'cat-ai', ...plaid }, MAPS, FALLBACK),
    { categoryId: 'cat-crowd', source: 'community' },
  );
  assertEquals(
    resolveCategory({ community: 'cat-crowd', ...plaid }, MAPS, FALLBACK),
    { categoryId: 'cat-crowd', source: 'community' },
  );
  assertEquals(resolveCategory({ community: 'cat-crowd' }, MAPS, FALLBACK), { categoryId: 'cat-crowd', source: 'community' });
  // A null community answer is no answer.
  assertEquals(resolveCategory({ community: null, ...plaid }, MAPS, FALLBACK), { categoryId: 'cat-coffee', source: 'plaid' });
});
