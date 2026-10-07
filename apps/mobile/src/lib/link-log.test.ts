/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { linkExitBody } from './link-log.ts';

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
