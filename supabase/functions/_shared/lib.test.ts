import { assertEquals } from 'jsr:@std/assert';

import { loggable } from './lib.ts';

/** Shaped like what the Plaid SDK throws: the request rides along. */
function plaidError(data?: { error_code?: string; error_message?: string }) {
  return Object.assign(new Error('Request failed with status code 400'), {
    isAxiosError: true,
    config: {
      headers: { 'PLAID-CLIENT-ID': 'client-id', 'PLAID-SECRET': 'plaid-secret' },
      data: '{"access_token":"access-token"}',
    },
    response: data ? { data } : undefined,
  });
}

Deno.test('loggable keeps only the code and message of a Plaid error', () => {
  const out = loggable(plaidError({ error_code: 'INVALID_FIELD', error_message: 'bad package name' }));
  assertEquals(out, 'INVALID_FIELD: bad package name');
});

Deno.test('loggable never passes the request of a Plaid error through', () => {
  for (const err of [plaidError(), plaidError({ error_code: 'INVALID_FIELD' })]) {
    const text = Deno.inspect(loggable(err), { depth: 10 });
    assertEquals(text.includes('plaid-secret'), false);
    assertEquals(text.includes('access-token'), false);
  }
  assertEquals(loggable(plaidError()), 'Request failed with status code 400');
});

Deno.test('loggable leaves other errors whole', () => {
  const err = new Error('boom');
  assertEquals(loggable(err), err);
  assertEquals(loggable('text'), 'text');
  assertEquals(loggable(null), null);
});
