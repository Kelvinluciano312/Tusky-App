/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Budget, Category } from './queries';
import {
  budgetsReplacedBy,
  buildTree,
  changedFields,
  deleteCategoryMessage,
  groupIdOf,
  pickerSections,
  rollupByGroup,
  sectionsByKind,
  validateCategoryName,
  withoutHidden,
} from './categories.ts';

const cat = (id: string, parent_id: string | null, kind: Category['kind'] = 'expense', sort_order = 1): Category => ({
  id, parent_id, kind, sort_order, slug: id, name: id, icon: 'Tag', color: '#000000', hidden: false, is_custom: false, overridden: false,
});

const food = cat('food', null, 'expense', 3);
const coffee = cat('coffee', 'food', 'expense', 2);
const groceries = cat('groceries', 'food', 'expense', 1);
const income = cat('income', null, 'income', 1);
const transfer = cat('transfer', null, 'transfer', 2);
const card = cat('card', 'transfer', 'transfer', 1);
const all = [coffee, food, groceries, income, card, transfer];
const byId = new Map(all.map((c) => [c.id, c]));
const budget = (id: string, category_id: string): Budget => ({ id, category_id, amount: 100 });

test('buildTree nests children under groups, both in sort_order', () => {
  const tree = buildTree(all);
  assert.deepEqual(tree.map((g) => g.id), ['income', 'transfer', 'food']);
  assert.deepEqual(tree[2].children.map((c) => c.id), ['groceries', 'coffee']);
});

test('buildTree drops a child whose group is missing', () => {
  assert.deepEqual(buildTree([coffee]), []);
});

test('groupIdOf maps a child to its group and a group to itself', () => {
  assert.equal(groupIdOf('coffee', byId), 'food');
  assert.equal(groupIdOf('food', byId), 'food');
});

test('groupIdOf keeps an unknown id as itself', () => {
  // A stale category cache must never crash a rollup or move money.
  assert.equal(groupIdOf('not-loaded-yet', byId), 'not-loaded-yet');
});

test('rollupByGroup sums a group\'s own rows with its children\'s, negatives included', () => {
  const out = rollupByGroup(new Map([['food', 10], ['coffee', 5], ['groceries', -2], ['unknown', 7]]), byId);
  assert.equal(out.get('food'), 13);
  assert.equal(out.get('unknown'), 7);
  assert.equal(out.has('coffee'), false);
});

test('budgetsReplacedBy: a group budget replaces its children\'s', () => {
  const budgets = [budget('b1', 'coffee'), budget('b2', 'groceries'), budget('b3', 'income')];
  assert.deepEqual(budgetsReplacedBy('food', budgets, byId).map((b) => b.id), ['b1', 'b2']);
});

test('budgetsReplacedBy: a child budget replaces its group\'s, never a sibling\'s', () => {
  const budgets = [budget('b1', 'food'), budget('b2', 'groceries')];
  assert.deepEqual(budgetsReplacedBy('coffee', budgets, byId).map((b) => b.id), ['b1']);
});

test('budgetsReplacedBy: changing an existing budget replaces nothing', () => {
  assert.deepEqual(budgetsReplacedBy('coffee', [budget('b1', 'coffee')], byId), []);
  assert.deepEqual(budgetsReplacedBy('unknown', [budget('b1', 'food')], byId), []);
});

test('sectionsByKind orders expense, income, transfer and drops empty kinds', () => {
  const sections = sectionsByKind(buildTree([food, coffee, transfer, card]));
  assert.deepEqual(sections.map((s) => s.kind), ['expense', 'transfer']);
});

test('withoutHidden drops a hidden category, and a hidden group with its children', () => {
  const tree = buildTree([food, { ...coffee, hidden: true }, groceries, { ...transfer, hidden: true }, card, income]);
  const out = withoutHidden(tree, null);
  assert.deepEqual(out.map((g) => g.id), ['income', 'food']);
  assert.deepEqual(out[1].children.map((c) => c.id), ['groceries']);
});

test('withoutHidden keeps the selection and its group, even when both are hidden', () => {
  const tree = buildTree([{ ...food, hidden: true }, coffee, groceries]);
  const shape = (keepId: string | null) => withoutHidden(tree, keepId).map((g) => [g.id, g.children.map((c) => c.id)]);
  assert.deepEqual(shape('coffee'), [['food', ['coffee']]]);
  assert.deepEqual(shape('food'), [['food', []]]);
  assert.deepEqual(shape(null), []);
});

test('pickerSections drops hidden categories but keeps the selected one', () => {
  const tree = buildTree([food, { ...coffee, hidden: true }, groceries]);
  assert.deepEqual(pickerSections(tree, { selectedId: null })[0].groups[0].children.map((c) => c.id), ['groceries']);
  assert.deepEqual(
    pickerSections(tree, { selectedId: 'coffee' })[0].groups[0].children.map((c) => c.id),
    ['groceries', 'coffee'],
  );
});

test('validateCategoryName trims and allows 1–40 characters', () => {
  assert.equal(validateCategoryName('  Date night  '), 'Date night');
  assert.equal(validateCategoryName('   '), null);
  assert.equal(validateCategoryName(''), null);
  assert.equal(validateCategoryName('x'.repeat(40)), 'x'.repeat(40));
  assert.equal(validateCategoryName('x'.repeat(41)), null);
});

test('changedFields sends only what changed', () => {
  assert.deepEqual(changedFields(food, { name: 'food', color: '#000000' }), {});
  assert.deepEqual(changedFields(food, { name: 'Eating out', color: '#000000' }), { name: 'Eating out' });
  assert.deepEqual(changedFields(food, { name: 'food', color: '#E07856' }), { color: '#E07856' });
});

test('deleteCategoryMessage says where the transactions go, and about the budget', () => {
  assert.equal(deleteCategoryMessage(1, 'Food & Dining', false), 'Moves its 1 transaction to Food & Dining.');
  assert.equal(
    deleteCategoryMessage(3, 'Food & Dining', true),
    'Moves its 3 transactions to Food & Dining, and removes its budget.',
  );
  assert.equal(deleteCategoryMessage(0, 'Food & Dining', false), 'It has no transactions.');
});
