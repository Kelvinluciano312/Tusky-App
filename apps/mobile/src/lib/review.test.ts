/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { deckReducer, newDeck, NOTE_MAX, normalizeNote, topCard } from './review.ts';

test('normalizeNote trims, and blank means no memo', () => {
  assert.equal(normalizeNote('  Dinner with Ana \n'), 'Dinner with Ana');
  assert.equal(normalizeNote(''), null);
  assert.equal(normalizeNote('   \n '), null);
});

test('normalizeNote caps the memo at NOTE_MAX, never ending on whitespace', () => {
  assert.equal(normalizeNote('x'.repeat(NOTE_MAX + 20))?.length, NOTE_MAX);
  assert.equal(normalizeNote(`${'x'.repeat(NOTE_MAX - 1)} tail`), 'x'.repeat(NOTE_MAX - 1));
});

test('accept removes the top card; skip sends it to the back', () => {
  let d = newDeck(['a', 'b', 'c']);
  d = deckReducer(d, { type: 'accept' });
  assert.deepEqual(d.queue, ['b', 'c']);
  assert.equal(d.accepted, 1);
  d = deckReducer(d, { type: 'skip' });
  assert.deepEqual(d.queue, ['c', 'b']);
  assert.equal(topCard(d), 'c');
});

test('the deck is done when empty, or when only skipped cards remain', () => {
  let d = newDeck(['a', 'b']);
  d = deckReducer(d, { type: 'skip' });
  assert.equal(topCard(d), 'b');
  d = deckReducer(d, { type: 'skip' });
  assert.equal(topCard(d), null);
  assert.equal(topCard(deckReducer(newDeck(['a']), { type: 'accept' })), null);
});

test('undo reverses an accept and a skip', () => {
  let d = newDeck(['a', 'b', 'c']);
  d = deckReducer(d, { type: 'accept' });
  d = deckReducer(d, { type: 'undo' });
  assert.deepEqual(d.queue, ['a', 'b', 'c']);
  assert.equal(d.accepted, 0);

  d = deckReducer(d, { type: 'skip' });
  d = deckReducer(d, { type: 'undo' });
  assert.deepEqual(d.queue, ['a', 'b', 'c']);
  assert.deepEqual(d.skipped, []);
});

test('accepting a card skipped earlier clears its skip; undo with no history does nothing', () => {
  let d = newDeck(['a', 'b']);
  d = deckReducer(d, { type: 'skip' });
  d = deckReducer(d, { type: 'skip' });
  d = deckReducer(d, { type: 'undo' });
  assert.equal(topCard(d), 'b');
  d = deckReducer(newDeck(['a', 'b']), { type: 'skip' });
  d = deckReducer(d, { type: 'accept' });
  d = deckReducer(d, { type: 'accept' });
  assert.deepEqual(d.skipped, []);
  assert.equal(d.accepted, 2);
  const empty = newDeck([]);
  assert.equal(deckReducer(empty, { type: 'undo' }), empty);
});
