import { assertEquals } from 'jsr:@std/assert';

import { buildSnapshotRows } from './accounts.ts';

const USER = 'user-1';
const MATE = 'user-2';

Deno.test('buildSnapshotRows carries every account through', () => {
  const rows = buildSnapshotRows(
    [
      { id: 'a', user_id: USER, current_balance: 110 },
      { id: 'b', user_id: USER, current_balance: 210.55 },
    ],
  );
  assertEquals(rows.length, 2);
  assertEquals(rows[0], { account_id: 'a', user_id: USER, balance: 110 });
  assertEquals(rows[1], { account_id: 'b', user_id: USER, balance: 210.55 });
});

Deno.test('buildSnapshotRows coalesces a null balance to 0, mirroring signedBalance', () => {
  // Plaid returns null for some brokerage accounts. One multi-row insert means a
  // single null would abort the whole day, not just that account.
  const rows = buildSnapshotRows([{ id: 'a', user_id: USER, current_balance: null }]);
  assertEquals(rows[0].balance, 0);
});

Deno.test('buildSnapshotRows never drops an account', () => {
  // Dropping the null-balance one would make the chart disagree with Home for
  // exactly the users who hold brokerage accounts.
  const rows = buildSnapshotRows(
    [
      { id: 'a', user_id: USER, current_balance: null },
      { id: 'b', user_id: USER, current_balance: 5 },
    ],
  );
  assertEquals(rows.length, 2);
});

Deno.test('buildSnapshotRows sorts by account_id so concurrent writers cannot deadlock', () => {
  const rows = buildSnapshotRows(
    [
      { id: 'c', user_id: USER, current_balance: 3 },
      { id: 'a', user_id: USER, current_balance: 1 },
      { id: 'b', user_id: USER, current_balance: 2 },
    ],
  );
  assertEquals(rows.map((r) => r.account_id), ['a', 'b', 'c']);
});

Deno.test('buildSnapshotRows omits date, leaving it to the column default', () => {
  const rows = buildSnapshotRows([{ id: 'a', user_id: USER, current_balance: 1 }]);
  assertEquals(Object.keys(rows[0]).sort(), ['account_id', 'balance', 'user_id']);
});

Deno.test('buildSnapshotRows keeps each account connector', () => {
  // A herd's snapshot covers every member's accounts; each row names who connected it.
  const rows = buildSnapshotRows([
    { id: 'a', user_id: USER, current_balance: 1 },
    { id: 'b', user_id: MATE, current_balance: 2 },
  ]);
  assertEquals(rows.map((r) => r.user_id), [USER, MATE]);
});

Deno.test('buildSnapshotRows handles no accounts', () => {
  assertEquals(buildSnapshotRows([]), []);
});

Deno.test('buildSnapshotRows keeps a negative balance signed as stored', () => {
  // The credit/loan flip belongs to the view, not the writer.
  const rows = buildSnapshotRows([{ id: 'a', user_id: USER, current_balance: -65262 }]);
  assertEquals(rows[0].balance, -65262);
});

Deno.test('buildSnapshotRows skips accounts of an archived bank', () => {
  // A disconnected bank's balance is frozen. Carrying it forward would count it
  // in today's net worth, though Home no longer does. Its past rows remain.
  const rows = buildSnapshotRows(
    [
      { id: 'a', user_id: USER, current_balance: 1 },
      { id: 'b', user_id: USER, current_balance: 2, archived: true },
      { id: 'c', user_id: USER, current_balance: 3, archived: false },
    ],
  );
  assertEquals(rows.map((r) => r.account_id), ['a', 'c']);
});
