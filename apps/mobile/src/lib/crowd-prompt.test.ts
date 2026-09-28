/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { afterFix, parsePromptState } from './crowd-prompt.ts';

test('the prompt comes on the third fix, once', () => {
  let state = parsePromptState(null);
  let r = afterFix(state, false);
  assert.equal(r.ask, false);
  r = afterFix(r.state, false);
  assert.equal(r.ask, false);
  r = afterFix(r.state, false);
  assert.equal(r.ask, true);
  state = r.state;
  // Asked once: never again, whatever they answered.
  assert.equal(afterFix(state, false).ask, false);
});

test('someone already sharing is never asked', () => {
  let r = afterFix(parsePromptState(null), true);
  r = afterFix(r.state, true);
  r = afterFix(r.state, true);
  assert.equal(r.ask, false);
});

test('a stored state that is missing or garbled starts over', () => {
  assert.deepEqual(parsePromptState(null), { fixes: 0, asked: false });
  assert.deepEqual(parsePromptState('not json'), { fixes: 0, asked: false });
  assert.deepEqual(parsePromptState('{"fixes":2,"asked":false}'), { fixes: 2, asked: false });
});
