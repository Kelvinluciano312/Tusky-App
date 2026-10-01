/**
 * Jev and a herd's own categories (Phase 15h). The global pass (ai.ts) only
 * knows the built-ins, because its answers are shared by every herd. This
 * second step runs per herd: where a row landed in a built-in group, or one
 * of its children, and the herd has its own categories under that group, Jev
 * chooses between those and keeping what the row has.
 *
 * Its answers are cached per herd, never globally: custom category names are
 * the herd's own. The cache key carries the set of custom categories offered,
 * so adding or removing one asks again. Pure except the JevAsk it is given.
 */
import { cacheKeyFor, JEV_CONFIDENCE, type AiRow } from './ai.ts';
import { JEV_CONCURRENCY, JEV_PASS_BUDGET_MS, type JevAsk, type JevQuestion, type JevResponse, mapLimit, readChoice } from './jev.ts';

/** Merchants asked about per sync in this step. Cache hits are free. */
export const CUSTOM_MAX_PER_SYNC = 25;

/** A category row as sync loads it: built-in (herd_id null) or the herd's own. */
export type CatRow = { id: string; name: string; parent_id: string | null; herd_id: string | null };

/** A row with the category it has now. */
export type CustomRow = AiRow & { category_id: string };

export type CustomPlan = {
  row: CustomRow;
  group: CatRow;
  current: CatRow;
  options: CatRow[];
  key: string;
};

/** The group a built-in category sits in (itself, for a group). */
function groupOf(id: string, byId: Map<string, CatRow>): CatRow | null {
  const c = byId.get(id);
  if (!c || c.herd_id !== null) return null;
  return c.parent_id === null ? c : byId.get(c.parent_id) ?? null;
}

/**
 * Which rows to consider, with what to offer. A row is a candidate when its
 * category is a built-in whose group has custom children in this herd. Rows
 * already in a custom category are left alone.
 */
export function planCustom(rows: CustomRow[], categories: CatRow[], herdId: string): CustomPlan[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const customByGroup = new Map<string, CatRow[]>();
  for (const c of categories) {
    if (c.herd_id !== herdId || c.parent_id === null) continue;
    customByGroup.set(c.parent_id, [...(customByGroup.get(c.parent_id) ?? []), c]);
  }
  const plans: CustomPlan[] = [];
  for (const row of rows) {
    const current = byId.get(row.category_id);
    const group = groupOf(row.category_id, byId);
    if (!current || !group) continue;
    const options = (customByGroup.get(group.id) ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    if (options.length === 0) continue;
    plans.push({ row, group, current, options, key: customCacheKey(row, group.id, options) });
  }
  return plans;
}

/** Merchant, direction and band (as the global cache), the group, and the custom set offered. */
export function customCacheKey(row: AiRow, groupId: string, options: CatRow[]): string {
  return `${cacheKeyFor(row)}|${groupId}|${options.map((o) => o.id).join(',')}`;
}

/**
 * One Choice: each custom category, plus keeping the current one. Option ids
 * are short and ours (c0, c1, …, keep), so no database id reaches the model.
 */
export function customQuestion(plan: Pick<CustomPlan, 'group' | 'current' | 'options'>): Record<string, JevQuestion> {
  const criteria: Record<string, string> = {};
  plan.options.forEach((o, i) => {
    criteria[`c${i}`] = o.name;
  });
  criteria.keep = `${plan.current.name} (none of the others fits better)`;
  return {
    custom: {
      type: 'choice',
      instructions: `This bank transaction is in ${plan.group.name}. This household also uses its own categories there. Which fits it best?`,
      criteria,
    },
  };
}

/**
 * The custom category Jev is sure of, or null to keep the row as it is.
 * Throws on a reply it cannot read: a failed call, never a decline.
 */
export function pickCustom(
  response: JevResponse,
  options: CatRow[],
): { category_id: string; confidence: number } | null {
  const answer = readChoice(response.answers.custom);
  if (!answer) throw new Error('jev: unreadable custom answer');
  if (answer.choice === 'keep' || answer.confidence < JEV_CONFIDENCE) return null;
  const index = /^c(\d+)$/.exec(answer.choice);
  const option = index ? options[Number(index[1])] : undefined;
  if (!option) throw new Error(`jev: answered an option we did not offer: ${answer.choice}`);
  return { category_id: option.id, confidence: answer.confidence };
}

/** A herd cache row: a custom category, or null for "keep what it has". */
export type CustomVerdict = { category_id: string | null; confidence: number | null };

/**
 * Ask about each distinct key once, at most CUSTOM_MAX_PER_SYNC, within the
 * pass budget. A key whose call failed is missing from the result, so the
 * next sync asks again; a decline comes back as a null category.
 */
export async function askCustom(plans: CustomPlan[], ask: JevAsk): Promise<Map<string, CustomVerdict>> {
  const seen = new Set<string>();
  const distinct = plans.filter((p) => (seen.has(p.key) ? false : (seen.add(p.key), true))).slice(0, CUSTOM_MAX_PER_SYNC);
  const deadline = Date.now() + JEV_PASS_BUDGET_MS;
  const settled = await mapLimit(distinct, JEV_CONCURRENCY, async (plan) => {
    const pick = pickCustom(await ask(customStateFor(plan.row), customQuestion(plan), { deadline }), plan.options);
    return [plan.key, pick ? { category_id: pick.category_id, confidence: pick.confidence } : { category_id: null, confidence: null }] as const;
  }, deadline);
  return new Map(settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : [])));
}

/** The same merchant-level fields the global pass sends, nothing about the herd. */
function customStateFor(row: AiRow) {
  return {
    merchant: row.merchant_name ?? '(unknown)',
    description: row.name,
    amount: Math.abs(row.amount).toFixed(2),
    direction: row.amount > 0 ? 'money in' : 'money out',
  };
}

/**
 * Row updates for every plan with an answer (cached or fresh) that names a
 * custom category, and the cache rows to write: fresh answers only, and only
 * when a shared row carries the key. Private rows take their answer but are
 * never cached, as in the global pass.
 */
export function applyCustom(
  plans: CustomPlan[],
  cached: Map<string, CustomVerdict>,
  fresh: Map<string, CustomVerdict>,
): { updates: { id: string; category_id: string; confidence: number | null }[]; cacheable: ({ key: string } & CustomVerdict)[] } {
  const updates: { id: string; category_id: string; confidence: number | null }[] = [];
  const cacheable = new Map<string, CustomVerdict>();
  for (const plan of plans) {
    const verdict = fresh.get(plan.key) ?? cached.get(plan.key);
    if (!verdict) continue;
    if (verdict.category_id) updates.push({ id: plan.row.id, category_id: verdict.category_id, confidence: verdict.confidence });
    if (fresh.has(plan.key) && !plan.row.is_private) cacheable.set(plan.key, verdict);
  }
  return { updates, cacheable: [...cacheable].map(([key, v]) => ({ key, ...v })) };
}
