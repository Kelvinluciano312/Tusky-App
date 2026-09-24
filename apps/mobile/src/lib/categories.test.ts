/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Budget, Category } from './queries';
import { budgetsReplacedBy, buildTree, groupIdOf, rollupByGroup, sectionsByKind } from './categories.ts';

const cat = (id: string, parent_id: string | null, kind: Category['kind'] = 'expense', sort_order = 1): Category => ({
  id, parent_id, kind, sort_order, slug: id, name: id, icon: 'Tag', color: '#000000',
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
