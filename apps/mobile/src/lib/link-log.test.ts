/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { linkEventBody, linkExitBody } from './link-log.ts';

test('an exit with an error carries every identifier', () => {
  assert.deepEqual(
    linkExitBody({
      error: { errorCode: 'INVALID_CREDENTIALS', errorType: 'ITEM_ERROR', errorMessage: 'wrong password' },
      metadata: { status: 'requires_credentials', institution: { id: 'ins_1', name: 'Bank' }, linkSessionId: 'ls1', requestId: 'rq1' },
    }),
    {
      link_session_id: 'ls1', request_id: 'rq1', institution_id: 'ins_1', status: 'requires_credentials',
      error_type: 'ITEM_ERROR', error_code: 'INVALID_CREDENTIALS', error_message: 'wrong password',
    },
  );
});

test('a plain cancel sends only what Link gave', () => {
  assert.deepEqual(linkExitBody({ metadata: { linkSessionId: 'ls1', requestId: '' } }), { link_session_id: 'ls1' });
});

test('update mode names the bank being repaired', () => {
  assert.deepEqual(linkExitBody({ metadata: { linkSessionId: 'ls1', requestId: 'rq1' } }, 'item-uuid'), {
    link_session_id: 'ls1', request_id: 'rq1', item_id: 'item-uuid',
  });
});

test('missing metadata or a null error never throws', () => {
  assert.deepEqual(linkExitBody({}), {});
  assert.deepEqual(linkExitBody({ error: null, metadata: null }), {});
});

test('an exit names the phone so the log can tell iOS from Android', () => {
  assert.equal(linkExitBody({ metadata: { linkSessionId: 'ls1' } }, undefined, 'ios').platform, 'ios');
  assert.equal(linkExitBody({}, undefined, 'web').platform, undefined);
});

test('OPEN, SELECT_INSTITUTION and ERROR are forwarded, and nothing else is', () => {
  assert.deepEqual(
    linkEventBody({
      eventName: 'SELECT_INSTITUTION',
      metadata: { linkSessionId: 'ls1', requestId: 'rq1', institutionId: 'ins_3' },
    }, 'item-1', 'android'),
    {
      event: 'SELECT_INSTITUTION',
      link_session_id: 'ls1',
      request_id: 'rq1',
      institution_id: 'ins_3',
      item_id: 'item-1',
      platform: 'android',
    },
  );
  assert.equal(linkEventBody({ eventName: 'OPEN', metadata: { linkSessionId: 'ls1' } }, undefined, 'ios')?.event, 'OPEN');
  assert.equal(
    linkEventBody({
      eventName: 'ERROR',
      metadata: { linkSessionId: 'ls1', errorCode: 'INSTITUTION_ERROR', errorType: 'INSTITUTION_ERROR', errorMessage: 'down' },
    })?.error_code,
    'INSTITUTION_ERROR',
  );
  assert.equal(linkEventBody({ eventName: 'SEARCH_INSTITUTION', metadata: { linkSessionId: 'ls1' } }), null);
  assert.equal(linkEventBody({ eventName: 'HANDOFF' }), null);
});
