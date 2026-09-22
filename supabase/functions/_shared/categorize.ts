/** PFC primary (e.g. 'FOOD_AND_DRINK') -> our category UUID. */
export type CategoryMap = Record<string, string>;

export type ExistingCategory = {
  category_id: string | null;
  category_is_manual: boolean;
} | null;

/**
 * Resolve a Plaid PFC primary to one of our categories. An unmapped or absent
 * primary resolves to the fallback so a transaction can never be dropped.
 */
export function resolveCategoryId(
  map: CategoryMap,
  pfcPrimary: string | null | undefined,
  fallbackId: string,
): string {
  if (!pfcPrimary) return fallbackId;
  return map[pfcPrimary] ?? fallbackId;
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
