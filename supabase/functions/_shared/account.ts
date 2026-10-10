import type { DisconnectResult } from './connections.ts';

/**
 * Deleting an account (Phase 14d). Both stores require it in the app. Plaid
 * bills per connected Item until /item/remove, and a cascade never calls
 * Plaid, so every live bank is removed there first; on the first failure we
 * stop and delete nothing, and a retry finishes the job. Pure: the function
 * wires the database, Plaid and RevenueCat in.
 */
export type AccountOps = {
  /** True when `password` is the user's current one. Throws when Auth cannot say. */
  verifyPassword(userId: string, password: string): Promise<boolean>;
  /** True when `identityToken` is a fresh Apple token for this user's own Apple identity. Throws when the lookup fails. */
  verifyApple(userId: string, identityToken: string): Promise<boolean>;
  /**
   * Trades the authorization code for a refresh token Apple can revoke. Null when
   * that fails or Apple is not configured: a deletion never waits on Apple.
   */
  appleGrant(authorizationCode: string): Promise<string | null>;
  revokeApple(refreshToken: string): Promise<void>;
  herdSize(userId: string): Promise<number>;
  leaveHerd(userId: string): Promise<void>;
  liveItems(userId: string): Promise<{ id: string; status: string }[]>;
  disconnect(item: { id: string; status: string }): Promise<DisconnectResult>;
  /**
   * Deletes the user's herd only while they are alone in it and it holds no
   * live bank, checked and deleted in one transaction (delete_personal_herd).
   * False when it refused; true when the herd is gone, now or already.
   */
  deletePersonalHerd(userId: string): Promise<boolean>;
  deleteUser(userId: string): Promise<void>;
  forgetPurchaser(userId: string): Promise<void>;
};

export type DeleteResult = 'deleted' | 'plaid_failed' | 'busy' | 'wrong_password' | 'apple_unverified';

/**
 * What the caller shows to prove it is them (a signed-in phone left on a table
 * must not be enough). A person with a password types it; an Apple-only person,
 * who has none, signs in with Apple again, and the code that sign-in returns is
 * what lets us revoke Apple's grant (Guideline 5.1.1(v)).
 */
export type DeleteProof =
  | { kind: 'password'; password: string }
  | { kind: 'apple'; identityToken: string; authorizationCode: string };

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== '';

/**
 * The proof in a request body: `{ password }` or `{ apple: { identity_token,
 * authorization_code } }`. Anything else, including both at once, is null.
 */
export function parseProof(body: unknown): DeleteProof | null {
  if (typeof body !== 'object' || body === null) return null;
  const { password, apple } = body as { password?: unknown; apple?: unknown };
  if (password !== undefined && apple !== undefined) return null;
  if (typeof password === 'string') return { kind: 'password', password };
  if (typeof apple === 'object' && apple !== null) {
    const { identity_token, authorization_code } = apple as { identity_token?: unknown; authorization_code?: unknown };
    if (nonEmpty(identity_token) && nonEmpty(authorization_code)) {
      return { kind: 'apple', identityToken: identity_token, authorizationCode: authorization_code };
    }
  }
  return null;
}

/**
 * Phase 16d: the proof is checked BEFORE anything is touched. A missing proof or
 * an empty password is refused without asking Auth.
 */
export async function deleteAccount(ops: AccountOps, userId: string, proof: DeleteProof | null): Promise<DeleteResult> {
  if (!proof) return 'wrong_password';
  let grant: string | null = null;
  if (proof.kind === 'password') {
    if (proof.password === '') return 'wrong_password';
    if (!(await ops.verifyPassword(userId, proof.password))) return 'wrong_password';
  } else {
    if (!(await ops.verifyApple(userId, proof.identityToken))) return 'apple_unverified';
    // The code is single-use and expires in 5 minutes, and the Plaid pass below
    // can be slow: trade it now.
    grant = await ops.appleGrant(proof.authorizationCode).catch(() => null);
  }
  // A shared herd keeps its config; leaving takes the user's banks and rows with them.
  if ((await ops.herdSize(userId)) > 1) await ops.leaveHerd(userId);
  for (const item of await ops.liveItems(userId)) {
    const result = await ops.disconnect(item);
    if (result !== 'ok') return result;
  }
  // Now alone: the herd and everything in it go, then the user (profile,
  // subscription and consents cascade; the consents trigger forgets crowd labels).
  // The herd is never read here and deleted by id: a join since the check above
  // would make that someone else's herd. A refusal is `busy`; a retry sorts it out.
  if (!(await ops.deletePersonalHerd(userId))) return 'busy';
  await ops.deleteUser(userId);
  // After the user is gone, so a deletion that stopped earlier never leaves
  // someone half-signed-out of Apple. A failure here never fails a deletion.
  if (grant) await ops.revokeApple(grant).catch((err) => console.warn('Apple revoke failed', err instanceof Error ? err.message : 'unknown'));
  await ops.forgetPurchaser(userId).catch((err) => console.warn('RevenueCat forget failed', err));
  return 'deleted';
}
