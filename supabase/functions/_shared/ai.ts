/**
 * The AI fallback (Phase 12b). Everything here is pure except askClaude, which
 * is injected, so every branch is testable without a network or a key.
 *
 * This runs only where every other source was unsure. Its answers are cached
 * globally and keyed by merchant and amount band: the model only ever sees
 * merchant-level text and the built-in category list, so one answer is right
 * for every herd, and a merchant one subscriber pays to resolve is then free
 * for everyone.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { z } from 'npm:zod@4.6.5';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.128.0/helpers/zod';

/** Classification needs no reasoning and Haiku 4.5 rejects `effort`. */
const MODEL = 'claude-haiku-4-5';
/** Uncached rows per sync. Cache hits are free and do not count. */
export const AI_MAX_PER_SYNC = 50;
/**
 * How long one sync may spend on the model, and how hard it retries. The SDK
 * defaults (10 minutes, 2 retries) can hold a sync open for half an hour before
 * its cursor advances, so every page would be pulled again next time.
 */
export const AI_CLIENT = { timeout: 20_000, maxRetries: 1 };
/** Rows per `in (...)` when writing answers back. Matches set-merchant-rule. */
export const AI_UPDATE_CHUNK = 200;
/** The bands the cache key uses, shared with 12c's crowd labels. */
const BANDS = [5, 15, 50, 150, 500];

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

export type AiCategory = { id: string; slug: string; name: string; parent_name: string | null };
export type AiAnswer = { key: string; slug: string };
export type AskFn = (rows: AiRow[], categories: AiCategory[]) => Promise<AiAnswer[]>;

/**
 * Whether this herd may use the AI fallback. True for everyone today; AI is
 * meant to be a subscriber feature, and this is the one place that check will
 * go. Server-side on purpose — a tier limit is never enforced in the client.
 */
export function aiAllowed(_herdId: string): boolean {
  return true;
}

const bandOf = (amount: number): string => {
  const magnitude = Math.abs(amount);
  const index = BANDS.findIndex((edge) => magnitude < edge);
  return index === -1 ? String(BANDS.length) : String(index);
};

/**
 * What one answer covers: a merchant, a direction and an amount band. A row
 * with no merchant key falls back to its raw description, so two unrelated
 * blank-merchant rows never share an answer.
 */
export function cacheKeyFor(row: AiRow): string {
  const merchant = row.merchant_key || `raw:${row.name.trim().toLowerCase()}`;
  return `${merchant}|${row.amount > 0 ? 'in' : 'out'}|${bandOf(row.amount)}`;
}

/**
 * Split the rows into what the cache already answers and what the model must
 * be asked. One row per distinct key: asking twice about one merchant is
 * money spent on an answer we already have in flight.
 */
export function buildAskList(
  rows: AiRow[],
  /** key → category, or null for a merchant the model declined once already. */
  cached: Map<string, string | null>,
): { ask: AiRow[]; resolved: Map<string, string> } {
  const resolved = new Map<string, string>();
  const ask: AiRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = cacheKeyFor(row);
    if (cached.has(key)) {
      // A null answer is an answer: this merchant has been asked about and the
      // model declined it. Asking again every sync is money for nothing.
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
 * Turn the model's answers into row updates and cache entries. Anything we did
 * not offer, did not ask about, or already answered is dropped — the row then
 * keeps the category it already had. Private rows take their answer but never
 * reach the global cache: which merchants someone keeps private is not a fact
 * other herds get to learn.
 *
 * `unanswered` is the keys we asked about and got nothing usable for. They are
 * cached as a null answer so the same unanswerable merchant is not sent again
 * on every later sync — and, like every cache entry, only when a shared row
 * carries the key.
 */
export function applyAnswers(
  rows: AiRow[],
  answers: AiAnswer[],
  categories: AiCategory[],
  /** The keys actually sent. Defaults to every key in the batch. */
  askedKeys?: string[],
): {
  updates: { id: string; category_id: string }[];
  cacheable: { key: string; category_id: string }[];
  unanswered: string[];
} {
  const idBySlug = new Map(categories.map((c) => [c.slug, c.id]));
  const asked = new Set(askedKeys ?? rows.map(cacheKeyFor));

  const byKey = new Map<string, string>();
  for (const answer of answers) {
    if (byKey.has(answer.key) || !asked.has(answer.key)) continue;
    const categoryId = idBySlug.get(answer.slug);
    if (!categoryId) continue;
    byKey.set(answer.key, categoryId);
  }

  const updates: { id: string; category_id: string }[] = [];
  const cacheable = new Map<string, string>();
  for (const row of rows) {
    const categoryId = byKey.get(cacheKeyFor(row));
    if (!categoryId) continue;
    updates.push({ id: row.id, category_id: categoryId });
    if (!row.is_private) cacheable.set(cacheKeyFor(row), categoryId);
  }
  // A key only reaches the cache — with an answer or without one — if a shared
  // row carries it.
  const shareable = new Set(rows.filter((r) => !r.is_private).map(cacheKeyFor));
  const unanswered = [...asked].filter((key) => !byKey.has(key) && shareable.has(key));

  return {
    updates,
    cacheable: [...cacheable].map(([key, category_id]) => ({ key, category_id })),
    unanswered,
  };
}

/**
 * Group the row updates by the category they land in and chunk each group, so
 * answering a warm cache over hundreds of rows is a handful of statements
 * rather than one round trip per row. Same shape as set-merchant-rule's plan.
 */
export function groupUpdates(
  updates: { id: string; category_id: string }[],
  chunk = AI_UPDATE_CHUNK,
): { category_id: string; ids: string[] }[] {
  const byCategory = new Map<string, string[]>();
  for (const u of updates) {
    const ids = byCategory.get(u.category_id) ?? [];
    ids.push(u.id);
    byCategory.set(u.category_id, ids);
  }
  const out: { category_id: string; ids: string[] }[] = [];
  for (const [category_id, ids] of byCategory) {
    for (let i = 0; i < ids.length; i += chunk) out.push({ category_id, ids: ids.slice(i, i + chunk) });
  }
  return out;
}

const ReplySchema = z.object({
  answers: z.array(z.object({
    key: z.string().describe('the exact key given for the transaction'),
    slug: z.string().describe('the slug of the best category, from the list'),
  })),
});

/** Whether a key is configured at all. Without one the pass is skipped silently. */
export function hasAnthropicKey(): boolean {
  return Boolean(Deno.env.get('ANTHROPIC_API_KEY'));
}

/**
 * The one impure function. A failure throws; the caller swallows it, because a
 * missed category is never worth failing a sync over.
 */
export const askClaude: AskFn = async (rows, categories) => {
  const client = new Anthropic(AI_CLIENT);
  const list = categories
    .map((c) => `${c.slug} — ${c.parent_name ? `${c.parent_name} / ` : ''}${c.name}`)
    .join('\n');
  const items = rows
    .map((r) => {
      const plaid = [r.pfc_detailed, r.pfc_primary].filter(Boolean).join(' / ') || 'none';
      const direction = r.amount > 0 ? 'money in' : 'money out';
      return `key: ${cacheKeyFor(r)}\n  merchant: ${r.merchant_name ?? '(unknown)'}\n  description: ${r.name}\n  amount: ${Math.abs(r.amount).toFixed(2)} (${direction})\n  bank's guess: ${plaid}`;
    })
    .join('\n\n');

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    system:
      'You categorize bank transactions. Reply with one answer per transaction, using the exact key given and a slug from the category list. ' +
      'Choose the most specific category that clearly fits. If none clearly fits, omit that transaction rather than guessing.',
    messages: [{ role: 'user', content: `Categories:\n${list}\n\nTransactions:\n\n${items}` }],
    output_config: { format: zodOutputFormat(ReplySchema) },
  });
  return response.parsed_output?.answers ?? [];
};
