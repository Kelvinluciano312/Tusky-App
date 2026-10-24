/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createModalGate } from './modal-gate.ts';

/** Timers run by hand, so the settle is deterministic. */
function fakeTimers() {
  let next = 1;
  const jobs = new Map<number, () => void>();
  return {
    timers: {
      schedule: (run: () => void) => {
        const id = next++;
        jobs.set(id, run);
        return id;
      },
      cancel: (handle: unknown) => {
        jobs.delete(handle as number);
      },
    },
    flush() {
      const due = [...jobs.values()];
      jobs.clear();
      due.forEach((run) => run());
    },
    pending: () => jobs.size,
  };
}

test('the gate starts clear', () => {
  const gate = createModalGate(250, fakeTimers().timers);
  assert.equal(gate.isClear(), true);
});

test('a hold closes the gate, and it clears only after the settle', () => {
  const t = fakeTimers();
  const gate = createModalGate(250, t.timers);
  const release = gate.hold();
  assert.equal(gate.isClear(), false);
  release();
  assert.equal(gate.isClear(), false);
  t.flush();
  assert.equal(gate.isClear(), true);
});

test('the gate waits for every holder', () => {
  const t = fakeTimers();
  const gate = createModalGate(250, t.timers);
  const a = gate.hold();
  const b = gate.hold();
  a();
  t.flush();
  assert.equal(gate.isClear(), false);
  b();
  t.flush();
  assert.equal(gate.isClear(), true);
});

test('a new hold during the settle cancels it', () => {
  const t = fakeTimers();
  const gate = createModalGate(250, t.timers);
  gate.hold()();
  const again = gate.hold();
  assert.equal(t.pending(), 0);
  t.flush();
  assert.equal(gate.isClear(), false);
  again();
  t.flush();
  assert.equal(gate.isClear(), true);
});

test('releasing twice counts once', () => {
  const t = fakeTimers();
  const gate = createModalGate(250, t.timers);
  const a = gate.hold();
  const b = gate.hold();
  a();
  a();
  t.flush();
  assert.equal(gate.isClear(), false);
  b();
  t.flush();
  assert.equal(gate.isClear(), true);
});

test('listeners hear each change once, and stop after unsubscribing', () => {
  const t = fakeTimers();
  const gate = createModalGate(250, t.timers);
  let calls = 0;
  const off = gate.subscribe(() => {
    calls += 1;
  });
  const a = gate.hold();
  gate.hold()(); // a second holder while closed: no new change
  assert.equal(calls, 1);
  a();
  t.flush();
  assert.equal(calls, 2);
  off();
  gate.hold();
  assert.equal(calls, 2);
});
