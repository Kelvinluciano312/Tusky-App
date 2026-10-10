/**
 * A purchase or restore goes ahead only under the signed-in user's RevenueCat
 * id (Phase 14c). The webhook drops anonymous ids, so a purchase made under
 * the wrong id is money paid for no plan, or a plan on someone else's account.
 * Pure: `lib/purchases.ts` passes RevenueCat in.
 */
export type PurchaserDeps = { current(): Promise<string>; logIn(id: string): Promise<unknown> };

export async function ensurePurchaser(expected: string | null, deps: PurchaserDeps): Promise<void> {
  if (!expected) throw new Error('Sign in to buy a plan.');
  if ((await deps.current()) === expected) return;
  await deps.logIn(expected).catch(() => {});
  if ((await deps.current()) !== expected) {
    throw new Error("Tusky couldn't reach the store for your account. Check your connection and try again.");
  }
}
