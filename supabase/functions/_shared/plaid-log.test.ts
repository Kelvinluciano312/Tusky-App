import { assertEquals } from 'jsr:@std/assert';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { clip, eventRow, linkExitEvent, plaidErrorFields, recordPlaidEvent } from './plaid-log.ts';

/** Shaped like what the Plaid SDK throws: the request rides along. */
function plaidError(data?: Record<string, unknown>) {
  return Object.assign(new Error('Request failed with status code 400'), {
    isAxiosError: true,
    config: {
      headers: { 'PLAID-CLIENT-ID': 'client-id', 'PLAID-SECRET': 'plaid-secret' },
      data: '{"access_token":"access-token"}',
    },
    response: data ? { data } : undefined,
  });
}

/** Just enough of the client: a plaid_items lookup and a plaid_events insert. */
function fakeAdmin(opts: { item?: { plaid_item_id: string; user_id: string }; insertError?: string; throws?: boolean } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const admin = {
    from(table: string) {
      if (opts.throws) throw new Error('db down');
      if (table === 'plaid_items') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: opts.item ?? null, error: null }) }) }) };
      }
      return {
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return Promise.resolve({ error: opts.insertError ? { message: opts.insertError } : null });
        },
      };
    },
  };
  return { admin: admin as unknown as SupabaseClient, inserted };
}

Deno.test('clip: a trimmed string cut to max; anything else is null', () => {
  assertEquals(clip('  abc  ', 10), 'abc');
  assertEquals(clip('abcdef', 3), 'abc');
  assertEquals(clip('   ', 10), null);
  assertEquals(clip(42, 10), null);
  assertEquals(clip({ a: 1 }, 10), null);
  assertEquals(clip(undefined, 10), null);
});

Deno.test('plaidErrorFields: reads Plaid error fields off response.data', () => {
  const out = plaidErrorFields(plaidError({
    error_type: 'ITEM_ERROR', error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'the login details changed', request_id: 'req1',
  }));
  assertEquals(out, {
    request_id: 'req1', error_type: 'ITEM_ERROR', error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'the login details changed',
  });
});

Deno.test('plaidErrorFields: never passes the request through', () => {
  for (const err of [plaidError(), plaidError({ error_code: 'INVALID_FIELD' })]) {
    const text = JSON.stringify(plaidErrorFields(err));
    assertEquals(text.includes('plaid-secret'), false);
    assertEquals(text.includes('access-token'), false);
  }
});

Deno.test('plaidErrorFields: any other error keeps only its message', () => {
  assertEquals(plaidErrorFields(new Error('boom')), {
    request_id: null, error_type: null, error_code: null, error_message: 'boom',
  });
  // A network failure: axios error with no response.
  assertEquals(plaidErrorFields(plaidError()).error_message, 'Request failed with status code 400');
  assertEquals(plaidErrorFields(null), { request_id: null, error_type: null, error_code: null, error_message: null });
  assertEquals(plaidErrorFields('text').error_message, null);
});

Deno.test('eventRow: every column present, long text clipped', () => {
  const row = eventRow({ event: 'sync_failed', user_id: 'u1', error_message: 'x'.repeat(10_000), request_id: 'r'.repeat(10_000) });
  assertEquals(row.event, 'sync_failed');
  assertEquals(row.user_id, 'u1');
  assertEquals(row.item_id, null);
  assertEquals(row.link_session_id, null);
  assertEquals(row.error_message!.length, 500);
  assertEquals(row.request_id!.length, 200);
});

Deno.test('linkExitEvent: reads the app body', () => {
  const item = '11111111-2222-3333-4444-555555555555';
  assertEquals(
    linkExitEvent({
      link_session_id: 'ls1', request_id: 'rq1', institution_id: 'ins_1', status: 'requires_credentials',
      error_type: 'ITEM_ERROR', error_code: 'INVALID_CREDENTIALS', error_message: 'wrong password', item_id: item,
    }, 'u1'),
    {
      event: 'link_exit', user_id: 'u1', item_id: item, link_session_id: 'ls1', request_id: 'rq1', institution_id: 'ins_1',
      link_status: 'requires_credentials', error_type: 'ITEM_ERROR', error_code: 'INVALID_CREDENTIALS', error_message: 'wrong password',
    },
  );
});

Deno.test('linkExitEvent: a broken or hostile body never throws', () => {
  assertEquals(linkExitEvent(null, 'u1'), null);
  assertEquals(linkExitEvent('text', 'u1'), null);
  assertEquals(linkExitEvent([1, 2], 'u1'), null);
  const out = linkExitEvent({ link_session_id: 7, item_id: 'not-a-uuid', error_message: 'x'.repeat(10_000), user_id: 'someone-else' }, 'u1')!;
  assertEquals(out.user_id, 'u1'); // never the body's
  assertEquals(out.item_id, null);
  assertEquals(out.link_session_id, null);
  assertEquals(out.error_message!.length, 500);
  // A plain cancel carries nothing but is still an exit.
  assertEquals(linkExitEvent({}, 'u1')!.event, 'link_exit');
});

Deno.test('recordPlaidEvent: inserts the row', async () => {
  const { admin, inserted } = fakeAdmin();
  await recordPlaidEvent(admin, { event: 'exchange_ok', user_id: 'u1', item_id: 'i1', plaid_item_id: 'p1', request_id: 'r1' });
  assertEquals(inserted.length, 1);
  assertEquals(inserted[0].event, 'exchange_ok');
  assertEquals(inserted[0].plaid_item_id, 'p1');
});

Deno.test('recordPlaidEvent: fills Plaid item id and user from our item id', async () => {
  const { admin, inserted } = fakeAdmin({ item: { plaid_item_id: 'p9', user_id: 'u9' } });
  await recordPlaidEvent(admin, { event: 'remove_failed', item_id: 'i1' });
  assertEquals(inserted[0].plaid_item_id, 'p9');
  assertEquals(inserted[0].user_id, 'u9');
});

Deno.test('recordPlaidEvent: an Item that is already gone still gets a row', async () => {
  const { admin, inserted } = fakeAdmin();
  await recordPlaidEvent(admin, { event: 'sync_failed', user_id: 'u1', item_id: 'i1' });
  assertEquals(inserted[0].plaid_item_id, null);
  assertEquals(inserted[0].user_id, 'u1');
});

Deno.test('recordPlaidEvent: never throws, whatever the database does', async () => {
  await recordPlaidEvent(fakeAdmin({ insertError: 'relation does not exist' }).admin, { event: 'sync_failed' });
  await recordPlaidEvent(fakeAdmin({ throws: true }).admin, { event: 'sync_failed', item_id: 'i1' });
});
