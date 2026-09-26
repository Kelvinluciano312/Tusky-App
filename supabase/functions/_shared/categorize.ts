/** PFC code (primary or detailed) -> our category UUID. */
export type CategoryMap = Record<string, string>;

export type ExistingCategory = {
  category_id: string | null;
  category_is_manual: boolean;
} | null;

/** Where a transaction's category came from (Phase 12). Mirrors transactions.category_source. */
export type CategorySource = 'manual' | 'rule' | 'learned' | 'community' | 'ai' | 'plaid' | 'fallback';

export type Resolved = { categoryId: string; source: CategorySource };

/**
 * Resolve a transaction's category from its sources, in precedence order: a
 * merchant rule (7c), then what the herd's own fixes taught (12a), then Plaid's
 * detailed code, then its primary (whose entries point at groups), then the
 * fallback. 12b and 12c slot `community` and `ai` in here. A manual choice is
 * applied on top by pickCategory, so it always wins.
 */
export function resolveCategory(
  sources: { rule?: string | null; learned?: string | null; detailed?: string | null; primary?: string | null },
  maps: { detailed: CategoryMap; primary: CategoryMap },
  fallbackId: string,
): Resolved {
  if (sources.rule) return { categoryId: sources.rule, source: 'rule' };
  if (sources.learned) return { categoryId: sources.learned, source: 'learned' };
  const plaid = (sources.detailed ? maps.detailed[sources.detailed] : undefined) ||
    (sources.primary ? maps.primary[sources.primary] : undefined);
  if (plaid) return { categoryId: plaid, source: 'plaid' };
  return { categoryId: fallbackId, source: 'fallback' };
}

/**
 * The override rule: a user's manual category always wins over every automatic
 * source. Enforced here and applied in the upsert, so no call site can bypass
 * it. A manual flag with no category set is incoherent: treat it as unset.
 */
export function pickCategory(existing: ExistingCategory, incoming: Resolved): Resolved {
  if (existing?.category_is_manual && existing.category_id) {
    return { categoryId: existing.category_id, source: 'manual' };
  }
  return incoming;
}

/**
 * Plaid returns amount positive for outflow. We store the intuitive convention:
 * positive is money in, negative is money out. `|| 0` collapses -0 to 0.
 */
export function toSignedAmount(plaidAmount: number): number {
  return -plaidAmount || 0;
}
