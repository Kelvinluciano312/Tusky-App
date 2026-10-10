/**
 * The AI fallback (Phase 12b), answered by Jev since Phase 12d. Everything here
 * is pure except the JevAsk that jevCategorizer is given, so every branch is
 * testable without a network or a key.
 *
 * This runs only where every other source was unsure. Its answers are cached
 * globally and keyed by merchant and amount band: Jev only ever sees
 * merchant-level text and the built-in categories, so one answer is right for
 * every herd, and a merchant one subscriber pays to resolve is then free for
 * everyone.
 */
import { amountBand } from './crowd.ts';
import {
  askJev,
  JEV_CONCURRENCY,
  JEV_PASS_BUDGET_MS,
  type JevAsk,
  type JevQuestion,
  type JevResponse,
  mapLimit,
  readChoice,
} from './jev.ts';

/** Uncached merchants asked about per sync. Cache hits are free and do not count. */
export const AI_MAX_PER_SYNC = 50;
/** Rows per `in (...)` when writing answers back. Matches set-merchant-rule. */
export const AI_UPDATE_CHUNK = 200;
/**
 * The confidence an answer needs before we write it: TypeSafe's own
 * classification cookbook uses 0.9. Every row stores the confidence it came
 * with, so scripts/cat-quality.mjs can show whether this should move.
 */
export const JEV_CONFIDENCE = 0.9;
/** The built-in "nothing fits" group. Jev choosing it is a decline. */
export const FALLBACK_SLUG = 'uncategorized';

export type AiRow = {
  id: string;
  /** normalizeMerchant's output; '' when the name has no letters. */
  merchant_key: string;
  /** The bank's raw description. */
  name: string;
  merchant_name: string | null;
  /** Signed: positive is money in. */
  amount: number;
  pfc_primary: string | null;
  pfc_detailed: string | null;
  /** Whether the row's account is private to its connector. */
  is_private: boolean;
};

/** A built-in category. `parent_slug` is null for one of the groups. */
export type AiCategory = { id: string; slug: string; name: string; parent_slug: string | null };
export type AiLevel = 'child' | 'group';
/** What one answer writes. Null confidence and level mark a 12b-era (Haiku) cache row. */
export type AiVerdict = { category_id: string; confidence: number | null; level: AiLevel | null };
/** One merchant's answer. A null slug is an explicit decline. */
export type AiAnswer = { key: string; slug: string | null; confidence?: number; level?: AiLevel };
/**
 * Answers for the rows asked about. A key missing from the result was not
 * answered at all (its call failed). Unlike a null slug, it is not remembered
 * as declined, so the next sync asks again.
 */
export type AskFn = (rows: AiRow[], categories: AiCategory[]) => Promise<AiAnswer[]>;

/**
 * What one answer covers: a merchant, a direction and an amount band. A row
 * with no merchant key falls back to its raw description, so two unrelated
 * blank-merchant rows never share an answer.
 */
export function cacheKeyFor(row: AiRow): string {
  const merchant = row.merchant_key || `raw:${row.name.trim().toLowerCase()}`;
  return `${merchant}|${row.amount > 0 ? 'in' : 'out'}|${amountBand(row.amount)}`;
}

/**
 * Split the rows into what the cache already answers and what Jev must be
 * asked. One row per distinct key: asking twice about one merchant is money
 * spent on an answer we already have in flight.
 */
export function buildAskList(
  rows: AiRow[],
  /** key → verdict, or null for a merchant Jev declined once already. */
  cached: Map<string, AiVerdict | null>,
): { ask: AiRow[]; resolved: Map<string, AiVerdict> } {
  const resolved = new Map<string, AiVerdict>();
  const ask: AiRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = cacheKeyFor(row);
    if (cached.has(key)) {
      // A null answer is an answer: this merchant has been asked about and
      // declined. Asking again every sync is money for nothing.
      const hit = cached.get(key);
      if (hit) resolved.set(row.id, hit);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    ask.push(row);
  }
  return { ask, resolved };
}

/**
 * Turn the answers into row updates and cache entries. Anything we did not
 * offer, did not ask about, or already answered is dropped, and the row then
 * keeps the category it already had. Private rows take their answer but never
 * reach the global cache: which merchants someone keeps private is not a fact
 * other herds get to learn.
 *
 * `unanswered` is the keys we asked about and got no usable category for. They
 * are cached as a null answer so the same unplaceable merchant is not sent
 * again on every later sync — and, like every cache entry, only when a shared
 * row carries the key. Pass only keys Jev actually answered as `askedKeys`: a
 * key whose call failed must not be remembered as declined.
 */
export function applyAnswers(
  rows: AiRow[],
  answers: AiAnswer[],
  categories: AiCategory[],
  /** The keys actually answered. Defaults to every key in the batch. */
  askedKeys?: string[],
): {
  updates: ({ id: string } & AiVerdict)[];
  cacheable: ({ key: string } & AiVerdict)[];
  unanswered: string[];
} {
  const idBySlug = new Map(categories.map((c) => [c.slug, c.id]));
  const asked = new Set(askedKeys ?? rows.map(cacheKeyFor));

  const byKey = new Map<string, AiVerdict>();
  for (const answer of answers) {
    if (byKey.has(answer.key) || !asked.has(answer.key)) continue;
    const categoryId = answer.slug ? idBySlug.get(answer.slug) : undefined;
    if (!categoryId) continue;
    byKey.set(answer.key, {
      category_id: categoryId,
      confidence: answer.confidence ?? null,
      level: answer.level ?? null,
    });
  }

  const updates: ({ id: string } & AiVerdict)[] = [];
  const cacheable = new Map<string, AiVerdict>();
  for (const row of rows) {
    const verdict = byKey.get(cacheKeyFor(row));
    if (!verdict) continue;
    updates.push({ id: row.id, ...verdict });
    if (!row.is_private) cacheable.set(cacheKeyFor(row), verdict);
  }
  // A key only reaches the cache — with an answer or without one — if a shared
  // row carries it.
  const shareable = new Set(rows.filter((r) => !r.is_private).map(cacheKeyFor));
  const unanswered = [...asked].filter((key) => !byKey.has(key) && shareable.has(key));

  return {
    updates,
    cacheable: [...cacheable].map(([key, verdict]) => ({ key, ...verdict })),
    unanswered,
  };
}

/**
 * Group the row updates by what they write and chunk each group, so answering
 * a warm cache over hundreds of rows is a handful of statements rather than one
 * round trip per row. Same shape as set-merchant-rule's plan.
 */
export function groupUpdates(
  updates: ({ id: string } & AiVerdict)[],
  chunk = AI_UPDATE_CHUNK,
): { verdict: AiVerdict; ids: string[] }[] {
  const groups = new Map<string, { verdict: AiVerdict; ids: string[] }>();
  for (const { id, ...verdict } of updates) {
    const key = JSON.stringify([verdict.category_id, verdict.confidence, verdict.level]);
    const group = groups.get(key) ?? { verdict, ids: [] };
    group.ids.push(id);
    groups.set(key, group);
  }
  const out: { verdict: AiVerdict; ids: string[] }[] = [];
  for (const { verdict, ids } of groups.values()) {
    for (let i = 0; i < ids.length; i += chunk) out.push({ verdict, ids: ids.slice(i, i + chunk) });
  }
  return out;
}

/**
 * The speculative fan-out (12d): the group question and one child question per
 * group, all in one request. Jev evaluates every question in parallel, so the
 * child questions we will not read cost a few tokens and no time, and they save
 * a second round trip. Question ids are ours and never reach the model.
 */
export function categoryQuestions(categories: AiCategory[]): Record<string, JevQuestion> {
  const groups = categories.filter((c) => c.parent_slug === null);
  const childrenOf = (slug: string) => categories.filter((c) => c.parent_slug === slug);

  const groupCriteria: Record<string, string> = {};
  for (const g of groups) {
    if (g.slug === FALLBACK_SLUG) continue;
    const kids = childrenOf(g.slug).map((c) => c.name);
    groupCriteria[g.slug] = kids.length > 0 ? `${g.name} (${kids.join(', ')})` : g.name;
  }
  // TypeSafe's advice: offer a way out when the list may not cover every input.
  groupCriteria[FALLBACK_SLUG] = 'None of these clearly fits';

  const questions: Record<string, JevQuestion> = {
    group: {
      type: 'choice',
      instructions: 'Which group does this bank transaction belong to?',
      criteria: groupCriteria,
    },
  };
  for (const g of groups) {
    const kids = childrenOf(g.slug);
    // One option is not a choice, and confidence is undefined over one option.
    if (kids.length < 2) continue;
    questions[`child__${g.slug}`] = {
      type: 'choice',
      instructions: `Within ${g.name}, which category best fits this bank transaction?`,
      criteria: Object.fromEntries(kids.map((c) => [c.slug, c.name])),
    };
  }
  return questions;
}

/** What Jev sees about one merchant: the same merchant-level fields 12b sent. */
export function categoryState(row: AiRow) {
  return {
    merchant: row.merchant_name ?? '(unknown)',
    description: row.name,
    amount: Math.abs(row.amount).toFixed(2),
    direction: row.amount > 0 ? 'money in' : 'money out',
    bank_guess: [row.pfc_detailed, row.pfc_primary].filter(Boolean).join(' / ') || 'none',
  };
}

/**
 * Read the fan-out and return the most specific level Jev is sure enough of.
 * That is the child when both the group and the child clear JEV_CONFIDENCE
 * (the child question assumed the group, so a doubtful group makes its child
 * meaningless), else the group when it clears alone, else a decline (null).
 * Throws on a reply it cannot read: that is a failed call, not a decline, and
 * must never be remembered as one.
 */
export function pickCategorization(
  response: JevResponse,
  categories: AiCategory[],
): { slug: string; confidence: number; level: AiLevel } | null {
  const group = readChoice(response.answers.group);
  if (!group) throw new Error('jev: unreadable group answer');
  if (group.choice === FALLBACK_SLUG) return null;
  if (!categories.some((c) => c.slug === group.choice && c.parent_slug === null)) {
    throw new Error(`jev: answered a group we did not offer: ${group.choice}`);
  }
  if (group.confidence < JEV_CONFIDENCE) return null;

  const child = readChoice(response.answers[`child__${group.choice}`]);
  const inGroup = child !== null &&
    categories.some((c) => c.slug === child.choice && c.parent_slug === group.choice);
  if (child && inGroup && child.confidence >= JEV_CONFIDENCE) {
    return { slug: child.choice, confidence: child.confidence, level: 'child' };
  }
  return { slug: group.choice, confidence: group.confidence, level: 'group' };
}

/**
 * The AskFn sync uses: one fan-out request per merchant, at most
 * JEV_CONCURRENCY at once and JEV_PASS_BUDGET_MS in all. A merchant whose call
 * fails is left out of the answers, not declined, so the next sync asks again.
 * It throws only when every call failed, so the pass logs why.
 */
export function jevCategorizer(ask: JevAsk = askJev): AskFn {
  return async (rows, categories) => {
    if (rows.length === 0) return [];
    const questions = categoryQuestions(categories);
    const deadline = Date.now() + JEV_PASS_BUDGET_MS;
    const settled = await mapLimit(rows, JEV_CONCURRENCY, async (row): Promise<AiAnswer> => {
      const pick = pickCategorization(await ask(categoryState(row), questions, { deadline }), categories);
      return pick ? { key: cacheKeyFor(row), ...pick } : { key: cacheKeyFor(row), slug: null };
    }, deadline);

    const answers = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
    if (answers.length === 0) {
      throw (settled.find((s) => s.status === 'rejected') as PromiseRejectedResult).reason;
    }
    return answers;
  };
}
