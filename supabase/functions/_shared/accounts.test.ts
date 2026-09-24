import { assertEquals } from 'jsr:@std/assert';

import { buildSnapshotRows } from './accounts.ts';

const USER = 'user-1';

Deno.test('buildSnapshotRows carries every account through', () => {
  const rows = buildSnapshotRows(
    [
      { id: 'a', current_balance: 110 },
      { id: 'b', current_balance: 210.55 },
    ],
    USER,
  );
  assertEquals(rows.length, 2);
  assertEquals(rows[0], { account_id: 'a', user_id: USER, balance: 110 });
  assertEquals(rows[1], { account_id: 'b', user_id: USER, balance: 210.55 });
});

Deno.test('buildSnapshotRows coalesces a null balance to 0, mirroring signedBalance', () => {
  // Plaid returns null for some brokerage accounts. One multi-row insert means a
  // single null would abort the whole day, not just that account.
  const rows = buildSnapshotRows([{ id: 'a', current_balance: null }], USER);
  assertEquals(rows[0].balance, 0);
});

Deno.test('buildSnapshotRows never drops an account', () => {
  // Dropping the null-balance one would make the chart disagree with Home for
  // exactly the users who hold brokerage accounts.
  const rows = buildSnapshotRows(
    [
      { id: 'a', current_balance: null },
      { id: 'b', current_balance: 5 },
    ],
    USER,
  );
  assertEquals(rows.length, 2);
});

Deno.test('buildSnapshotRows sorts by account_id so concurrent writers cannot deadlock', () => {
  const rows = buildSnapshotRows(
    [
      { id: 'c', current_balance: 3 },
      { id: 'a', current_balance: 1 },
      { id: 'b', current_balance: 2 },
    ],
    USER,
  );
  assertEquals(rows.map((r) => r.account_id), ['a', 'b', 'c']);
});

Deno.test('buildSnapshotRows omits date, leaving it to the column default', () => {
  const rows = buildSnapshotRows([{ id: 'a', current_balance: 1 }], USER);
  assertEquals(Object.keys(rows[0]).sort(), ['account_id', 'balance', 'user_id']);
});

Deno.test('buildSnapshotRows handles no accounts', () => {
  assertEquals(buildSnapshotRows([], USER), []);
});

Deno.test('buildSnapshotRows keeps a negative balance signed as stored', () => {
  // The credit/loan flip belongs to the view, not the writer.
  const rows = buildSnapshotRows([{ id: 'a', current_balance: -65262 }], USER);
  assertEquals(rows[0].balance, -65262);
});

Deno.test('buildSnapshotRows skips accounts of an archived bank', () => {
  // A disconnected bank's balance is frozen. Carrying it forward would count it
  // in today's net worth, though Home no longer does. Its past rows remain.
  const rows = buildSnapshotRows(
    [
      { id: 'a', current_balance: 1 },
      { id: 'b', current_balance: 2, archived: true },
      { id: 'c', current_balance: 3, archived: false },
    ],
    USER,
  );
  assertEquals(rows.map((r) => r.account_id), ['a', 'c']);
});
