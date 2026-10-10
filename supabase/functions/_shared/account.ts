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

export type DeleteResult = 'deleted' | 'plaid_failed' | 'busy' | 'wrong_password';

/**
 * Phase 16d: the caller types their password, and it is checked BEFORE
 * anything is touched (a signed-in phone left on a table must not be enough).
 * A missing or non-string password is refused without asking Auth.
 */
export async function deleteAccount(ops: AccountOps, userId: string, password: unknown): Promise<DeleteResult> {
  if (typeof password !== 'string' || password === '') return 'wrong_password';
  if (!(await ops.verifyPassword(userId, password))) return 'wrong_password';
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
  await ops.forgetPurchaser(userId).catch((err) => console.warn('RevenueCat forget failed', err));
  return 'deleted';
}
