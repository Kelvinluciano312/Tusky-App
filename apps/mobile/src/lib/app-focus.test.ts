/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFocusTracker, focusTransition } from './app-focus.ts';

describe('focusTransition', () => {
  it('an overlay (active, inactive, active) reports nothing either way', () => {
    assert.equal(focusTransition('active', 'inactive'), null);
    assert.equal(focusTransition('active', 'active'), null);
  });

  it('going to the background is leaving; coming back from it is returning', () => {
    assert.equal(focusTransition('active', 'background'), false);
    assert.equal(focusTransition('background', 'active'), true);
  });

  it('a transient inactive while in the background reports nothing, the following active returns', () => {
    assert.equal(focusTransition('background', 'inactive'), null);
    assert.equal(focusTransition('background', 'active'), true);
  });
});

describe('createFocusTracker', () => {
  const run = (initial: Parameters<typeof createFocusTracker>[0], steps: Parameters<ReturnType<typeof createFocusTracker>>[0][]) => {
    const track = createFocusTracker(initial);
    return steps.map(track);
  };

  it('Face ID, the Passwords bar and Control Center never refetch', () => {
    assert.deepEqual(run('active', ['inactive', 'active', 'inactive', 'active']), [null, null, null, null]);
  });

  it('leaving and returning (the iOS sequence) reports left, then returned, once each', () => {
    assert.deepEqual(run('active', ['inactive', 'background', 'inactive', 'active']), [null, false, null, true]);
  });

  it('Android sequence without inactive behaves the same', () => {
    assert.deepEqual(run('active', ['background', 'active']), [false, true]);
  });

  it('an overlay after returning is still quiet', () => {
    assert.deepEqual(run('active', ['background', 'active', 'inactive', 'active']), [false, true, null, null]);
  });

  it('starting in the background, the first active returns', () => {
    assert.deepEqual(run('background', ['inactive', 'active']), [null, true]);
  });
});
