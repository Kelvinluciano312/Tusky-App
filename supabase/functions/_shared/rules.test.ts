import { assertEquals } from 'jsr:@std/assert';

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

Deno.test('planReresolve groups only the rows whose category changes', () => {
  const rows = [
    { id: 't1', pfc_detailed: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', pfc_primary: 'TRANSPORTATION', category_id: 'cat-rideshare' },
    { id: 't2', pfc_detailed: null, pfc_primary: 'TRANSPORTATION', category_id: 'cat-transport' },
    { id: 't3', pfc_detailed: null, pfc_primary: null, category_id: 'cat-food' },
  ];
  assertEquals(planReresolve(rows, 'cat-food', MAPS, 'cat-none'), [{ category_id: 'cat-food', ids: ['t1', 't2'] }]);
});

Deno.test('planReresolve without a rule restores Plaid, by the same resolver sync uses', () => {
  const rows = [
    { id: 't1', pfc_detailed: 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', pfc_primary: 'TRANSPORTATION', category_id: 'cat-food' },
    { id: 't2', pfc_detailed: null, pfc_primary: 'TRANSPORTATION', category_id: 'cat-food' },
    { id: 't3', pfc_detailed: null, pfc_primary: null, category_id: 'cat-food' },
  ];
  assertEquals(planReresolve(rows, null, MAPS, 'cat-none'), [
    { category_id: 'cat-rideshare', ids: ['t1'] },
    { category_id: 'cat-transport', ids: ['t2'] },
    { category_id: 'cat-none', ids: ['t3'] },
  ]);
});
