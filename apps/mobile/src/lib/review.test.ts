/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  askedLine,
  deckReducer,
  inMyReview,
  newDeck,
  NOTE_MAX,
  normalizeNote,
  orderQueue,
  reviewQueueFilter,
  topCard,
  waitingLine,
} from './review.ts';

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

test('askedLine names who is waiting, once each', () => {
  const name = (id: string) => ({ a: 'Annie', p: 'Pedro', k: 'Kel' })[id] ?? '?';
  assert.equal(askedLine([{ asked_by: 'a' }], name), 'Annie asked about one of them');
  assert.equal(askedLine([{ asked_by: 'a' }, { asked_by: 'a' }], name), 'Annie asked about 2 of them');
  assert.equal(askedLine([{ asked_by: 'a' }, { asked_by: 'p' }], name), 'Annie and Pedro asked about 2 of them');
  assert.equal(
    askedLine([{ asked_by: 'a' }, { asked_by: 'p' }, { asked_by: 'k' }], name),
    'Annie, Pedro and Kel asked about 3 of them',
  );
});

test('orderQueue puts questions for me first, even ones outside the batch, once each', () => {
  assert.deepEqual(
    orderQueue(
      [
        { id: 'a', review_priority: 2 },
        { id: 'b', review_priority: 0 },
      ],
      ['b', 'q', 'b'],
    ),
    ['b', 'q', 'a'],
  );
});

test('orderQueue puts likely fixes first, then glances, oldest first within each', () => {
  assert.deepEqual(
    orderQueue([
      { id: 'a', review_priority: 0 },
      { id: 'b', review_priority: 2 },
      { id: 'c', review_priority: null },
      { id: 'd', review_priority: 1 },
      { id: 'e', review_priority: 2 },
    ]),
    ['b', 'e', 'd', 'a', 'c'],
  );
});

test('handOff drops the asked card without counting it reviewed, and undo does not bring it back', () => {
  let d = newDeck(['a', 'b']);
  d = deckReducer(d, { type: 'handOff', id: 'a' });
  assert.deepEqual(d.queue, ['b']);
  assert.equal(d.accepted, 0);
  assert.equal(d.handed, 1);
  assert.equal(topCard(d), 'b');
  d = deckReducer(d, { type: 'undo' });
  assert.deepEqual(d.queue, ['b']);
  assert.equal(deckReducer(newDeck([]), { type: 'handOff', id: 'missing' }).handed, 0);
});

test('inMyReview keeps an ask with the person it was sent to', () => {
  const open = { reviewed_at: null, review_assignee: null };
  assert.equal(inMyReview(open, 'pedro'), true);
  assert.equal(inMyReview(open, null), true);
  assert.equal(inMyReview({ reviewed_at: '2026-10-01', review_assignee: null }, 'pedro'), false);
  assert.equal(inMyReview({ reviewed_at: null, review_assignee: 'annie' }, 'pedro'), false);
  assert.equal(inMyReview({ reviewed_at: null, review_assignee: 'annie' }, 'annie'), true);
  assert.equal(inMyReview({ reviewed_at: null, review_assignee: 'annie' }, null), false);
  // Already reviewed by someone else, but still waiting on Annie.
  assert.equal(inMyReview({ reviewed_at: '2026-10-01', review_assignee: 'annie' }, 'annie'), true);
  assert.equal(inMyReview({ reviewed_at: '2026-10-01', review_assignee: 'annie' }, 'pedro'), false);
});

test('reviewQueueFilter matches inMyReview for a user id', () => {
  assert.equal(
    reviewQueueFilter('706f7db5-1111-4111-8111-111111111111'),
    'and(reviewed_at.is.null,review_assignee.is.null),review_assignee.eq.706f7db5-1111-4111-8111-111111111111',
  );
  assert.throws(() => reviewQueueFilter('annie'), /user id/);
});

test('waitingLine names who I asked, once each', () => {
  const name = (id: string) => ({ a: 'Annie', p: 'Pedro', k: 'Kel' })[id] ?? '?';
  assert.equal(waitingLine([{ asked_to: 'a' }], name), 'Waiting on Annie');
  assert.equal(waitingLine([{ asked_to: 'a' }, { asked_to: 'a' }], name), 'Waiting on Annie · 2');
  assert.equal(waitingLine([{ asked_to: 'a' }, { asked_to: 'p' }], name), 'Waiting on Annie and Pedro · 2');
  assert.equal(
    waitingLine([{ asked_to: 'a' }, { asked_to: 'p' }, { asked_to: 'k' }], name),
    'Waiting on Annie, Pedro and Kel · 3',
  );
});

test('with Jev off every row is unjudged, and the order is exactly the old one', () => {
  assert.deepEqual(
    orderQueue([
      { id: 'x', review_priority: null },
      { id: 'y', review_priority: null },
      { id: 'z', review_priority: null },
    ]),
    ['x', 'y', 'z'],
  );
});
