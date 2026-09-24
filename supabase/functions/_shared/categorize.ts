/** PFC code (primary or detailed) -> our category UUID. */
export type CategoryMap = Record<string, string>;

export type ExistingCategory = {
  category_id: string | null;
  category_is_manual: boolean;
} | null;

/**
 * Resolve a transaction's category from its sources, in precedence order:
 * a merchant rule (7c), then Plaid's detailed code, then Plaid's primary code
 * (whose entries point at groups), then the fallback. The ordered sources leave
 * a slot for a future community source between rule and detailed. A manual
 * choice is applied on top by pickCategoryId, so it always wins.
 */
export function resolveCategoryId(
  sources: { rule?: string | null; detailed?: string | null; primary?: string | null },
  maps: { detailed: CategoryMap; primary: CategoryMap },
  fallbackId: string,
): string {
  return (
    sources.rule ||
    (sources.detailed ? maps.detailed[sources.detailed] : undefined) ||
    (sources.primary ? maps.primary[sources.primary] : undefined) ||
    fallbackId
  );
}

/**
 * The override rule: a user's manual category always wins over Plaid's guess.
 * Enforced here and applied in the upsert, so no call site can bypass it.
 * A manual flag with no category set is incoherent — treat it as unset rather
 * than writing null.
 */
export function pickCategoryId(existing: ExistingCategory, incomingId: string): string {
  if (existing?.category_is_manual && existing.category_id) return existing.category_id;
  return incomingId;
}

/**
 * Plaid returns amount positive for outflow. We store the intuitive convention:
 * positive is money in, negative is money out. `|| 0` collapses -0 to 0.
 */
export function toSignedAmount(plaidAmount: number): number {
  return -plaidAmount || 0;
}
