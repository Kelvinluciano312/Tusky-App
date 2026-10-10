import { assertEquals } from 'jsr:@std/assert';

import { type AccountOps, deleteAccount } from './account.ts';
import type { DisconnectResult } from './connections.ts';

/** Records every call in order; `herd` and `items` describe the user's state. */
function fakeOps(s: { size: number; herd: string | null; items: string[]; fail?: Record<string, DisconnectResult>; forgetThrows?: boolean; password?: string; verifyThrows?: boolean; joinsDuringPlaid?: boolean }) {
  const log: string[] = [];
  const ops: AccountOps = {
    verifyPassword: (u, p) => (log.push('verify ' + u), s.verifyThrows ? Promise.reject(new Error('auth down')) : Promise.resolve(p === (s.password ?? 'right'))),
    herdSize: () => Promise.resolve(s.size),
    leaveHerd: (u) => (log.push(`leave ${u}`), s.size = 1, Promise.resolve()),
    liveItems: () => Promise.resolve(s.items.map((id) => ({ id, status: 'active' }))),
    disconnect: (item) => {
      log.push(`disconnect ${item.id}`);
      const r = s.fail?.[item.id] ?? 'ok';
      if (r === 'ok') s.items = s.items.filter((i) => i !== item.id);
      // The race: a join lands while the banks are being removed at Plaid.
      if (s.joinsDuringPlaid) { s.size = 2; s.herd = 'theirs'; s.joinsDuringPlaid = false; }
      return Promise.resolve(r);
    },
    // As delete_personal_herd: refuses a shared herd or one with a live bank.
    deletePersonalHerd: () => {
      if (s.herd === null) return Promise.resolve(true);
      if (s.size > 1 || s.items.length > 0) return Promise.resolve(false);
      log.push(`delete herd ${s.herd}`);
      s.herd = null;
      return Promise.resolve(true);
    },
    deleteUser: (u) => (log.push(`delete user ${u}`), Promise.resolve()),
    forgetPurchaser: (u) => (log.push(`forget ${u}`), s.forgetThrows ? Promise.reject(new Error('rc down')) : Promise.resolve()),
  };
  return { ops, log };
}

Deno.test('alone: every bank goes at Plaid, then the herd, then the user', async () => {
  const { ops, log } = fakeOps({ size: 1, herd: 'h1', items: ['a', 'b'] });
  assertEquals(await deleteAccount(ops, 'u', 'right'), 'deleted');
  assertEquals(log, ['verify u', 'disconnect a', 'disconnect b', 'delete herd h1', 'delete user u', 'forget u']);
});

Deno.test('in a shared herd: leave first, so the herd keeps its config', async () => {
  const { ops, log } = fakeOps({ size: 3, herd: 'mine', items: [] });
  await deleteAccount(ops, 'u', 'right');
  assertEquals(log.slice(0, 2), ['verify u', 'leave u']);
});

Deno.test('stops at a failure: nothing past the failed bank is touched', async () => {
  const { ops, log } = fakeOps({ size: 1, herd: 'h1', items: ['a', 'b', 'c'], fail: { b: 'plaid_failed' } });
  assertEquals(await deleteAccount(ops, 'u', 'right'), 'plaid_failed');
  assertEquals(log, ['verify u', 'disconnect a', 'disconnect b']);
});

Deno.test('a busy bank refuses too', async () => {
  const { ops } = fakeOps({ size: 1, herd: 'h1', items: ['a'], fail: { a: 'busy' } });
  assertEquals(await deleteAccount(ops, 'u', 'right'), 'busy');
});

Deno.test('a retry after a partial run finishes the job', async () => {
  const s = { size: 1, herd: 'h1' as string | null, items: ['a', 'b'], fail: { b: 'plaid_failed' as DisconnectResult } };
  const first = fakeOps(s);
  await deleteAccount(first.ops, 'u', 'right');
  delete (s.fail as Record<string, DisconnectResult>).b;
  const second = fakeOps(s);
  assertEquals(await deleteAccount(second.ops, 'u', 'right'), 'deleted');
  assertEquals(second.log, ['verify u', 'disconnect b', 'delete herd h1', 'delete user u', 'forget u']);
});

Deno.test('a run that stopped after the herd went still deletes the user', async () => {
  const { ops, log } = fakeOps({ size: 0, herd: null, items: [] });
  assertEquals(await deleteAccount(ops, 'u', 'right'), 'deleted');
  assertEquals(log, ['verify u', 'delete user u', 'forget u']);
});

Deno.test('RevenueCat being down never fails a deletion', async () => {
  const { ops } = fakeOps({ size: 1, herd: 'h1', items: [], forgetThrows: true });
  assertEquals(await deleteAccount(ops, 'u', 'right'), 'deleted');
});

Deno.test('a join during the Plaid pass: the shared herd is never deleted, and a retry leaves it', async () => {
  const s = { size: 1, herd: 'h1' as string | null, items: ['a'], joinsDuringPlaid: true };
  const first = fakeOps(s);
  assertEquals(await deleteAccount(first.ops, 'u', 'right'), 'busy');
  assertEquals(first.log, ['verify u', 'disconnect a']);
  assertEquals(s.herd, 'theirs');
  const second = fakeOps(s);
  // The fake's leave keeps the herd name; what matters is leave comes first.
  assertEquals(await deleteAccount(second.ops, 'u', 'right'), 'deleted');
  assertEquals(second.log.slice(0, 2), ['verify u', 'leave u']);
});
