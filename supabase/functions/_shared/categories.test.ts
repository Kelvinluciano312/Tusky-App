import { assertEquals } from 'jsr:@std/assert';

import { planCategoryDelete, readCategoryId } from './categories.ts';

const ID = '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f';
const GROUP = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const ME = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THEM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

Deno.test('readCategoryId accepts a UUID', () => {
  assertEquals(readCategoryId({ category_id: ID }), ID);
});

Deno.test('readCategoryId rejects a missing, non-string or malformed id', () => {
  // A non-UUID would reach PostgREST as 22P02, a 500, instead of a 400.
  for (const body of [null, 'x', {}, { category_id: 42 }, { category_id: 'abc' }, { category_id: `${ID}x` }]) {
    assertEquals(readCategoryId(body), null);
  }
});

Deno.test("planCategoryDelete moves the caller's custom category to its group", () => {
  assertEquals(planCategoryDelete({ id: ID, parent_id: GROUP, user_id: ME }, ME), { moveTo: GROUP });
});

Deno.test('planCategoryDelete refuses a built-in', () => {
  assertEquals(planCategoryDelete({ id: ID, parent_id: GROUP, user_id: null }, ME), null);
  assertEquals(planCategoryDelete({ id: GROUP, parent_id: null, user_id: null }, ME), null);
});

Deno.test("planCategoryDelete refuses another user's category", () => {
  assertEquals(planCategoryDelete({ id: ID, parent_id: GROUP, user_id: THEM }, ME), null);
});

Deno.test('planCategoryDelete refuses a missing row', () => {
  assertEquals(planCategoryDelete(null, ME), null);
});
