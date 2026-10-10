/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { contentWidth, isWide, twoColumns } from './layout.ts';

test('a phone fills its window', () => {
  assert.equal(contentWidth(360), 360);
  assert.equal(contentWidth(411), 411);
});

test('a tablet gets the capped column', () => {
  assert.equal(contentWidth(800), 640);
  assert.equal(contentWidth(1600), 640);
});

test('a custom cap and a degenerate window', () => {
  assert.equal(contentWidth(1000, 560), 560);
  assert.equal(contentWidth(-5), 0);
});

test('600dp is where a window counts as wide', () => {
  assert.equal(isWide(599), false);
  assert.equal(isWide(600), true);
});

test('only a landscape tablet gets two columns', () => {
  assert.equal(twoColumns(411), false);
  assert.equal(twoColumns(800), false);
  assert.equal(twoColumns(960), true);
});
