import type { DisconnectResult } from './connections.ts';

/**
 * Deleting an account (Phase 14d). Both stores require it in the app. Plaid
 * bills per connected Item until /item/remove, and a cascade never calls
 * Plaid, so every live bank is removed there first; on the first failure we
 * stop and delete nothing, and a retry finishes the job. Pure: the function
 * wires the database, Plaid and RevenueCat in.
 */
export type AccountOps = {
  herdSize(userId: string): Promise<number>;
  leaveHerd(userId: string): Promise<void>;
  liveItems(userId: string): Promise<{ id: string; status: string }[]>;
  disconnect(item: { id: string; status: string }): Promise<DisconnectResult>;
  herdOf(userId: string): Promise<string | null>;
  deleteHerd(herdId: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  forgetPurchaser(userId: string): Promise<void>;
};

export async function deleteAccount(ops: AccountOps, userId: string): Promise<'deleted' | 'plaid_failed' | 'busy'> {
  // A shared herd keeps its config; leaving takes the user's banks and rows with them.
  if ((await ops.herdSize(userId)) > 1) await ops.leaveHerd(userId);
  for (const item of await ops.liveItems(userId)) {
    const result = await ops.disconnect(item);
    if (result !== 'ok') return result;
  }
  // Now alone: the herd and everything in it go, then the user (profile,
  // subscription and consents cascade; the consents trigger forgets crowd labels).
  const herd = await ops.herdOf(userId);
  if (herd) await ops.deleteHerd(herd);
  await ops.deleteUser(userId);
  await ops.forgetPurchaser(userId).catch((err) => console.warn('RevenueCat forget failed', err));
  return 'deleted';
}
