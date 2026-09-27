import { assertEquals } from 'jsr:@std/assert';

import type { Label } from './learn.ts';
import { mergeRule, planReresolve, validateRuleInput } from './rules.ts';

const CAT = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';

Deno.test('validateRuleInput accepts a category, a rename, or both, and trims the name', () => {
  assertEquals(validateRuleInput({ merchant_key: 'uber', category_id: CAT }), { merchant_key: 'uber', category_id: CAT });
  assertEquals(validateRuleInput({ merchant_key: 'uber eats', display_name: '  Uber Eats ' }), {
    merchant_key: 'uber eats',
    display_name: 'Uber Eats',
  });
  assertEquals(validateRuleInput({ merchant_key: 'uber', category_id: null, display_name: null }), {
    merchant_key: 'uber',
    category_id: null,
    display_name: null,
  });
});

Deno.test('validateRuleInput refuses a key that is empty or not normalized', () => {
  // A merchant name with no letters normalizes to '' and can take no rule.
  for (const merchant_key of ['', 'Uber', ' uber', 'uber  eats', 'uber1', 42]) {
    assertEquals('error' in validateRuleInput({ merchant_key, display_name: 'x' }), true);
  }
});

Deno.test('validateRuleInput refuses a blank or too-long name, a bad id, and an empty change', () => {
  assertEquals('error' in validateRuleInput({ merchant_key: 'uber', display_name: '   ' }), true);
  assertEquals('error' in validateRuleInput({ merchant_key: 'uber', display_name: 'x'.repeat(61) }), true);
  assertEquals('error' in validateRuleInput({ merchant_key: 'uber', category_id: 'nope' }), true);
  assertEquals('error' in validateRuleInput({ merchant_key: 'uber' }), true);
  assertEquals('error' in validateRuleInput(null), true);
});

Deno.test('mergeRule keeps omitted fields and clears null ones', () => {
  const existing = { category_id: CAT, display_name: 'Uber' };
  assertEquals(mergeRule(existing, { merchant_key: 'uber', display_name: 'Rides' }), { category_id: CAT, display_name: 'Rides' });
  // Removing the category part keeps the rename: Plaid's category comes back.
  assertEquals(mergeRule(existing, { merchant_key: 'uber', category_id: null }), { category_id: null, display_name: 'Uber' });
  assertEquals(mergeRule(null, { merchant_key: 'uber', category_id: CAT }), { category_id: CAT, display_name: null });
});

Deno.test('mergeRule returns null when nothing is left, meaning delete the rule', () => {
  assertEquals(mergeRule({ category_id: CAT, display_name: null }, { merchant_key: 'uber', category_id: null }), null);
});

const MAPS = { detailed: { TRANSPORTATION_TAXIS_AND_RIDE_SHARES: 'cat-rideshare' }, primary: { TRANSPORTATION: 'cat-transport' } };

const row = (id: string, pfc_detailed: string | null, pfc_primary: string | null, category_id: string, category_source = 'plaid') =>
  ({ id, pfc_detailed, pfc_primary, category_id, category_source, amount: -20, user_id: 'u1', is_private: false });
const learnedLabels: Label[] = [
  { amount: -20, category_id: 'cat-learned', date: '2026-09-01', user_id: 'u1', is_private: false },
  { amount: -22, category_id: 'cat-learned', date: '2026-09-02', user_id: 'u1', is_private: false },
];

Deno.test('planReresolve groups only the rows whose category or source changes', () => {
  const rows = [
    row('t1', 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', 'TRANSPORTATION', 'cat-rideshare'),
    row('t2', null, 'TRANSPORTATION', 'cat-transport'),
    row('t3', null, null, 'cat-food', 'rule'),
  ];
  assertEquals(planReresolve(rows, 'cat-food', [], MAPS, 'cat-none'), [
    { category_id: 'cat-food', category_source: 'rule', ids: ['t1', 't2'] },
  ]);
});

Deno.test('planReresolve without a rule restores Plaid, by the same resolver sync uses', () => {
  const rows = [
    row('t1', 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', 'TRANSPORTATION', 'cat-food', 'rule'),
    row('t2', null, 'TRANSPORTATION', 'cat-food', 'rule'),
    row('t3', null, null, 'cat-food', 'rule'),
  ];
  assertEquals(planReresolve(rows, null, [], MAPS, 'cat-none'), [
    { category_id: 'cat-rideshare', category_source: 'plaid', ids: ['t1'] },
    { category_id: 'cat-transport', category_source: 'plaid', ids: ['t2'] },
    { category_id: 'cat-none', category_source: 'fallback', ids: ['t3'] },
  ]);
});

Deno.test('planReresolve: a rule beats learning, and removing it falls back to learning', () => {
  const rows = [row('t1', null, 'TRANSPORTATION', 'cat-transport')];
  assertEquals(planReresolve(rows, 'cat-rule', learnedLabels, MAPS, 'cat-none'), [
    { category_id: 'cat-rule', category_source: 'rule', ids: ['t1'] },
  ]);
  assertEquals(planReresolve(rows, null, learnedLabels, MAPS, 'cat-none'), [
    { category_id: 'cat-learned', category_source: 'learned', ids: ['t1'] },
  ]);
});

Deno.test('planReresolve: private labels never teach a shared row, even its connector\'s', () => {
  const privateLabels = learnedLabels.map((l) => ({ ...l, is_private: true }));
  const shared = row('t1', null, 'TRANSPORTATION', 'cat-transport');
  assertEquals(planReresolve([shared], null, privateLabels, MAPS, 'cat-none'), []);
  assertEquals(planReresolve([{ ...shared, is_private: true }], null, privateLabels, MAPS, 'cat-none'), [
    { category_id: 'cat-learned', category_source: 'learned', ids: ['t1'] },
  ]);
});

Deno.test('a re-resolve leaves an AI-categorized row where the AI put it', () => {
  // Without this, fixing one transaction of a merchant reverted every row the
  // AI pass had placed back to Plaid's guess or to Uncategorized.
  const row = {
    id: 't1',
    pfc_detailed: null,
    pfc_primary: null,
    category_id: 'c-ai',
    category_source: 'ai',
    amount: -12,
    user_id: 'me',
    is_private: false,
  };
  assertEquals(planReresolve([row], null, [], { detailed: {}, primary: {} }, 'c-uncat'), []);
});
