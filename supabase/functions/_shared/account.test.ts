import { assertEquals } from 'jsr:@std/assert';

import { type AccountOps, deleteAccount, type DeleteProof, parseProof } from './account.ts';
import type { DisconnectResult } from './connections.ts';

const PW: DeleteProof = { kind: 'password', password: 'right' };
const APPLE: DeleteProof = { kind: 'apple', identityToken: 'id-token', authorizationCode: 'auth-code' };

/** Records every call in order; `herd` and `items` describe the user's state. */
function fakeOps(s: { size: number; herd: string | null; items: string[]; fail?: Record<string, DisconnectResult>; forgetThrows?: boolean; password?: string; verifyThrows?: boolean; joinsDuringPlaid?: boolean; appleOk?: boolean; grant?: string | null; revokeThrows?: boolean }) {
  const log: string[] = [];
  const ops: AccountOps = {
    verifyPassword: (u, p) => (log.push('verify ' + u), s.verifyThrows ? Promise.reject(new Error('auth down')) : Promise.resolve(p === (s.password ?? 'right'))),
    verifyApple: (u, t) => (log.push(`verify apple ${u} ${t}`), Promise.resolve(s.appleOk ?? true)),
    appleGrant: (c) => (log.push(`grant ${c}`), Promise.resolve(s.grant === undefined ? 'refresh-token' : s.grant)),
    revokeApple: (t) => (log.push(`revoke ${t}`), s.revokeThrows ? Promise.reject(new Error('apple down')) : Promise.resolve()),
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
  assertEquals(await deleteAccount(ops, 'u', PW), 'deleted');
  assertEquals(log, ['verify u', 'disconnect a', 'disconnect b', 'delete herd h1', 'delete user u', 'forget u']);
});

Deno.test('in a shared herd: leave first, so the herd keeps its config', async () => {
  const { ops, log } = fakeOps({ size: 3, herd: 'mine', items: [] });
  await deleteAccount(ops, 'u', PW);
  assertEquals(log.slice(0, 2), ['verify u', 'leave u']);
});

Deno.test('stops at a failure: nothing past the failed bank is touched', async () => {
  const { ops, log } = fakeOps({ size: 1, herd: 'h1', items: ['a', 'b', 'c'], fail: { b: 'plaid_failed' } });
  assertEquals(await deleteAccount(ops, 'u', PW), 'plaid_failed');
  assertEquals(log, ['verify u', 'disconnect a', 'disconnect b']);
});

Deno.test('a busy bank refuses too', async () => {
  const { ops } = fakeOps({ size: 1, herd: 'h1', items: ['a'], fail: { a: 'busy' } });
  assertEquals(await deleteAccount(ops, 'u', PW), 'busy');
});

Deno.test('a retry after a partial run finishes the job', async () => {
  const s = { size: 1, herd: 'h1' as string | null, items: ['a', 'b'], fail: { b: 'plaid_failed' as DisconnectResult } };
  const first = fakeOps(s);
  await deleteAccount(first.ops, 'u', PW);
  delete (s.fail as Record<string, DisconnectResult>).b;
  const second = fakeOps(s);
  assertEquals(await deleteAccount(second.ops, 'u', PW), 'deleted');
  assertEquals(second.log, ['verify u', 'disconnect b', 'delete herd h1', 'delete user u', 'forget u']);
});

Deno.test('a run that stopped after the herd went still deletes the user', async () => {
  const { ops, log } = fakeOps({ size: 0, herd: null, items: [] });
  assertEquals(await deleteAccount(ops, 'u', PW), 'deleted');
  assertEquals(log, ['verify u', 'delete user u', 'forget u']);
});

Deno.test('RevenueCat being down never fails a deletion', async () => {
  const { ops } = fakeOps({ size: 1, herd: 'h1', items: [], forgetThrows: true });
  assertEquals(await deleteAccount(ops, 'u', PW), 'deleted');
});

Deno.test('a join during the Plaid pass: the shared herd is never deleted, and a retry leaves it', async () => {
  const s = { size: 1, herd: 'h1' as string | null, items: ['a'], joinsDuringPlaid: true };
  const first = fakeOps(s);
  assertEquals(await deleteAccount(first.ops, 'u', PW), 'busy');
  assertEquals(first.log, ['verify u', 'disconnect a']);
  assertEquals(s.herd, 'theirs');
  const second = fakeOps(s);
  // The fake's leave keeps the herd name; what matters is leave comes first.
  assertEquals(await deleteAccount(second.ops, 'u', PW), 'deleted');
  assertEquals(second.log.slice(0, 2), ['verify u', 'leave u']);
});

Deno.test('no proof, an empty password or a wrong one touches nothing', async () => {
  for (const proof of [null, { kind: 'password', password: '' } as DeleteProof, { kind: 'password', password: 'wrong' } as DeleteProof]) {
    const { ops, log } = fakeOps({ size: 1, herd: 'h1', items: ['a'] });
    assertEquals(await deleteAccount(ops, 'u', proof), 'wrong_password');
    assertEquals(log.filter((l) => !l.startsWith('verify')), []);
  }
});

Deno.test('an empty password is refused without asking Auth', async () => {
  const { ops, log } = fakeOps({ size: 1, herd: 'h1', items: [] });
  await deleteAccount(ops, 'u', { kind: 'password', password: '' });
  assertEquals(log, []);
});

Deno.test('a password never reaches Apple', async () => {
  const { ops, log } = fakeOps({ size: 1, herd: 'h1', items: [] });
  assertEquals(await deleteAccount(ops, 'u', PW), 'deleted');
  assertEquals(log.some((l) => l.startsWith('grant') || l.startsWith('revoke')), false);
});

Deno.test('an Apple proof: the code is traded first, and the grant is revoked once the user is gone', async () => {
  const { ops, log } = fakeOps({ size: 1, herd: 'h1', items: ['a'] });
  assertEquals(await deleteAccount(ops, 'u', APPLE), 'deleted');
  assertEquals(log, [
    'verify apple u id-token',
    'grant auth-code',
    'disconnect a',
    'delete herd h1',
    'delete user u',
    'revoke refresh-token',
    'forget u',
  ]);
});

Deno.test('an Apple proof Apple does not vouch for touches nothing, and its code is never traded', async () => {
  const { ops, log } = fakeOps({ size: 1, herd: 'h1', items: ['a'], appleOk: false });
  assertEquals(await deleteAccount(ops, 'u', APPLE), 'apple_unverified');
  assertEquals(log, ['verify apple u id-token']);
});

Deno.test('no grant (Apple unconfigured or refusing): still deleted, nothing to revoke', async () => {
  const { ops, log } = fakeOps({ size: 1, herd: 'h1', items: [], grant: null });
  assertEquals(await deleteAccount(ops, 'u', APPLE), 'deleted');
  assertEquals(log.some((l) => l.startsWith('revoke')), false);
});

Deno.test('Apple being down at revocation never fails a deletion', async () => {
  const { ops, log } = fakeOps({ size: 1, herd: 'h1', items: [], revokeThrows: true });
  assertEquals(await deleteAccount(ops, 'u', APPLE), 'deleted');
  assertEquals(log.at(-1), 'forget u');
});

Deno.test('a deletion that stops at Plaid revokes nothing at Apple', async () => {
  const { ops, log } = fakeOps({ size: 1, herd: 'h1', items: ['a'], fail: { a: 'plaid_failed' } });
  assertEquals(await deleteAccount(ops, 'u', APPLE), 'plaid_failed');
  assertEquals(log.some((l) => l.startsWith('revoke')), false);
});

Deno.test('parseProof reads a password or an Apple proof, and nothing else', () => {
  assertEquals(parseProof({ password: 'hunter2' }), { kind: 'password', password: 'hunter2' });
  assertEquals(parseProof({ password: '' }), { kind: 'password', password: '' });
  assertEquals(
    parseProof({ apple: { identity_token: 'a', authorization_code: 'b' } }),
    { kind: 'apple', identityToken: 'a', authorizationCode: 'b' },
  );
  assertEquals(parseProof({ apple: { identity_token: 'a' } }), null);
  assertEquals(parseProof({ apple: { identity_token: '', authorization_code: 'b' } }), null);
  assertEquals(parseProof({ apple: { identity_token: 1, authorization_code: 2 } }), null);
  assertEquals(parseProof({ apple: 'token' }), null);
  assertEquals(parseProof({ password: 'x', apple: { identity_token: 'a', authorization_code: 'b' } }), null);
  assertEquals(parseProof({ password: 42 }), null);
  assertEquals(parseProof({}), null);
  assertEquals(parseProof(null), null);
  assertEquals(parseProof('password'), null);
});
