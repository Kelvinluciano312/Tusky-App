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
 * merchant rule (7c), then what the herd's own fixes taught (12a), then an
 * answer the AI pass already gave (12b), then Plaid's detailed code, then its
 * primary (whose entries point at groups), then the fallback. 12c slots
 * `community` in here. A manual choice is applied on top by pickCategory, so it
 * always wins.
 *
 * `ai` sits above Plaid unconditionally, not below a confident Plaid code as
 * the plan's ordering has it: the AI pass only ever runs on rows Plaid was
 * unsure about, so the two orders differ only where Plaid later gains
 * confidence about a row it had doubted, and there keeping the answer the user
 * was already shown beats swapping it out from under them.
 */
export function resolveCategory(
  sources: {
    rule?: string | null;
    learned?: string | null;
    /** An answer the AI pass already applied to this row (12b). */
    ai?: string | null;
    detailed?: string | null;
    primary?: string | null;
  },
  maps: { detailed: CategoryMap; primary: CategoryMap },
  fallbackId: string,
): Resolved {
  if (sources.rule) return { categoryId: sources.rule, source: 'rule' };
  if (sources.learned) return { categoryId: sources.learned, source: 'learned' };
  if (sources.ai) return { categoryId: sources.ai, source: 'ai' };
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
