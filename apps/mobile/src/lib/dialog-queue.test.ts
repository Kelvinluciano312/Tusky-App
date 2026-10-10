/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  cancelButton,
  dismissAction,
  dismissHead,
  enqueue,
  layoutFor,
  lookFor,
  normalizeButtons,
  type DialogRequest,
} from './dialog-queue.ts';

const req = (id: number): DialogRequest => ({ id, title: `t${id}`, buttons: normalizeButtons() });

test('no buttons means a single OK', () => {
  assert.deepEqual(normalizeButtons(), [{ text: 'OK' }]);
  assert.deepEqual(normalizeButtons([]), [{ text: 'OK' }]);
});

test('a button with no text reads OK and keeps its other fields', () => {
  const onPress = () => {};
  const [b] = normalizeButtons([{ style: 'destructive', onPress }]);
  assert.equal(b.text, 'OK');
  assert.equal(b.style, 'destructive');
  assert.equal(b.onPress, onPress);
});

test('button order is kept', () => {
  const out = normalizeButtons([{ text: 'A' }, { text: 'B', style: 'cancel' }, { text: 'C' }]);
  assert.deepEqual(out.map((b) => b.text), ['A', 'B', 'C']);
});

test('the cancel button is what scrim and back stand for', () => {
  const buttons = normalizeButtons([{ text: 'Delete', style: 'destructive' }, { text: 'Keep', style: 'cancel' }]);
  assert.equal(cancelButton(buttons)?.text, 'Keep');
});

test('with no cancel button there is nothing to trigger', () => {
  assert.equal(cancelButton(normalizeButtons([{ text: 'Share' }])), undefined);
  assert.equal(cancelButton(normalizeButtons()), undefined);
});

test('dialogs queue in order and leave one at a time', () => {
  let q: DialogRequest[] = [];
  q = enqueue(q, req(1));
  q = enqueue(q, req(2));
  q = enqueue(q, req(3));
  assert.deepEqual(q.map((r) => r.id), [1, 2, 3]);
  q = dismissHead(q);
  assert.equal(q[0].id, 2);
  q = dismissHead(dismissHead(q));
  assert.deepEqual(q, []);
  assert.deepEqual(dismissHead(q), []);
});

test('enqueue does not mutate the queue it was given', () => {
  const q: DialogRequest[] = [req(1)];
  enqueue(q, req(2));
  assert.equal(q.length, 1);
});

test('two buttons share a row, any other count stacks', () => {
  assert.equal(layoutFor(normalizeButtons()), 'column');
  assert.equal(layoutFor([{ text: 'a' }, { text: 'b' }]), 'row');
  assert.equal(layoutFor([{ text: 'a' }, { text: 'b' }, { text: 'c' }]), 'column');
});

test('looks: destructive stays, cancel is quiet, a lone plain button is primary', () => {
  const buttons = normalizeButtons([{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive' }]);
  assert.equal(lookFor(buttons[0], buttons), 'secondary');
  assert.equal(lookFor(buttons[1], buttons), 'destructive');
  const ok = normalizeButtons();
  assert.equal(lookFor(ok[0], ok), 'primary');
  const two = normalizeButtons([{ text: 'Not now', style: 'cancel' }, { text: 'Share' }]);
  assert.equal(lookFor(two[1], two), 'primary');
  const many = normalizeButtons([{ text: 'Mon' }, { text: 'Tue' }]);
  assert.equal(lookFor(many[0], many), 'secondary');
});

test('scrim and back: cancel button, plain dismiss, or nothing when cancelable is false', () => {
  const withCancel = normalizeButtons([{ text: 'Keep', style: 'cancel' }, { text: 'Go' }]);
  assert.equal(dismissAction({ buttons: withCancel }), 'cancel');
  assert.equal(dismissAction({ buttons: normalizeButtons() }), 'dismiss');
  assert.equal(dismissAction({ buttons: withCancel, cancelable: true }), 'cancel');
  assert.equal(dismissAction({ buttons: withCancel, cancelable: false }), 'none');
});
