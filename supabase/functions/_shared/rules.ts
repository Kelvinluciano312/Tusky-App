/**
 * Pure planning for merchant rules (Phase 7c): validate a request, merge it
 * into the stored rule, and work out which transactions the change moves.
 * The handler, set-merchant-rule, does the I/O.
 */
import { type CategoryMap, resolveCategoryId } from './categorize.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What normalizeMerchant produces, minus the empty string: a name with no letters takes no rule. */
const MERCHANT_KEY = /^[a-z]+( [a-z]+)*$/;

/** A validated request. An absent field keeps the stored value; null clears it. */
export type RuleInput = {
  merchant_key: string;
  category_id?: string | null;
  display_name?: string | null;
};

export type StoredRule = { category_id: string | null; display_name: string | null };

export function validateRuleInput(body: unknown): RuleInput | { error: string } {
  const b = (body ?? {}) as { merchant_key?: unknown; category_id?: unknown; display_name?: unknown };
  if (typeof b.merchant_key !== 'string' || !MERCHANT_KEY.test(b.merchant_key)) {
    return { error: 'merchant_key is required' };
  }
  const input: RuleInput = { merchant_key: b.merchant_key };

  if (b.category_id !== undefined) {
    if (b.category_id !== null && (typeof b.category_id !== 'string' || !UUID.test(b.category_id))) {
      return { error: 'category_id must be a UUID or null' };
    }
    input.category_id = b.category_id;
  }
  if (b.display_name !== undefined) {
    if (b.display_name === null) {
      input.display_name = null;
    } else {
      const name = typeof b.display_name === 'string' ? b.display_name.trim() : '';
      if (name.length < 1 || name.length > 60) return { error: 'display_name must be 1–60 characters' };
      input.display_name = name;
    }
  }
  if (input.category_id === undefined && input.display_name === undefined) {
    return { error: 'nothing to change' };
  }
  return input;
}

/** The rule after this request, or null when neither part is left (delete the row). */
export function mergeRule(existing: StoredRule | null, input: RuleInput): StoredRule | null {
  const merged = {
    category_id: input.category_id !== undefined ? input.category_id : (existing?.category_id ?? null),
    display_name: input.display_name !== undefined ? input.display_name : (existing?.display_name ?? null),
  };
  return merged.category_id === null && merged.display_name === null ? null : merged;
}

export type ReresolveRow = {
  id: string;
  pfc_detailed: string | null;
  pfc_primary: string | null;
  category_id: string | null;
};

/**
 * The caller's non-manual rows for one merchant, re-resolved with the rule's
 * category (null: no rule, so Plaid's again). Same resolver as sync, so a rule
 * applied then removed lands every row exactly where sync would put it.
 * Returns only the rows that change, grouped by their new category.
 */
export function planReresolve(
  rows: ReresolveRow[],
  ruleCategoryId: string | null,
  maps: { detailed: CategoryMap; primary: CategoryMap },
  fallbackId: string,
): { category_id: string; ids: string[] }[] {
  const byCategory = new Map<string, string[]>();
  for (const row of rows) {
    const next = resolveCategoryId(
      { rule: ruleCategoryId, detailed: row.pfc_detailed, primary: row.pfc_primary },
      maps,
      fallbackId,
    );
    if (next === row.category_id) continue;
    byCategory.set(next, [...(byCategory.get(next) ?? []), row.id]);
  }
  return [...byCategory].map(([category_id, ids]) => ({ category_id, ids }));
}
