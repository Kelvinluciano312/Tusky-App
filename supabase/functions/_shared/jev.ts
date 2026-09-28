/**
 * Jev, TypeSafe AI's System One model (Phase 12d): typed decisions with
 * calibrated probabilities, and no text. Everything here is pure except
 * askJev, which every surface takes as an injected JevAsk, so each branch is
 * testable without a network or a key.
 *
 * Raw HTTP, not TypeSafe's npm SDK: the call is one fetch, the SDK's Deno
 * support is unverified, and it reads TYPESAFE_API_KEY while our secret is
 * JEV_API_KEY.
 */

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
/** Pinned in one place, so a version can be frozen if accuracy moves. */
export const JEV_MODEL = 'jev-latest';
/**
 * One call's bound. Tighter than 12b's single Haiku call, because a pass now
 * makes up to 50 of these; JEV_PASS_BUDGET_MS caps them all together.
 */
export const JEV_CLIENT = { timeout: 10_000, maxRetries: 1 };
/** How long one pass may spend on Jev in all, so a degraded vendor never stalls a sync. */
export const JEV_PASS_BUDGET_MS = 15_000;
/** Calls in flight at once. The 1,200 requests/minute limit is nowhere near. */
export const JEV_CONCURRENCY = 8;
/** The longest Retry-After we will wait out inside a sync. Longer is a failure. */
export const JEV_MAX_RETRY_WAIT_MS = 2_000;

export type JevQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } };

/** `answers` is keyed by the question ids we sent. Read each one with the readers below. */
export type JevResponse = { model: string; answers: Record<string, unknown> };

export type JevAsk = (
  state: unknown,
  questions: Record<string, JevQuestion>,
  opts?: { deadline?: number },
) => Promise<JevResponse>;

/** Whether a key is configured at all. Without one, every pass is skipped silently. */
export function hasJevKey(): boolean {
  return Boolean(Deno.env.get('JEV_API_KEY'));
}

const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const asObject = (x: unknown): Record<string, unknown> | null =>
  x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : null;

/** A Choice answer, or null when it is missing or not the shape the docs promise. */
export function readChoice(answer: unknown): { choice: string; confidence: number } | null {
  const a = asObject(answer);
  if (!a || a.type !== 'choice' || typeof a.choice !== 'string' || !isNumber(a.confidence)) return null;
  return { choice: a.choice, confidence: a.confidence };
}

/** A Score answer: `score` is the position on the levels (0 to the top level), not an index. */
export function readScore(answer: unknown): { score: number; confidence: number } | null {
  const a = asObject(answer);
  if (!a || a.type !== 'score' || !isNumber(a.score) || !isNumber(a.confidence)) return null;
  return { score: a.score, confidence: a.confidence };
}

/** A Noul answer: the probability that the answer is yes. */
export function readNoul(answer: unknown): number | null {
  const a = asObject(answer);
  if (!a || a.type !== 'noul' || !isNumber(a.noul) || a.noul < 0 || a.noul > 1) return null;
  return a.noul;
}

/**
 * Milliseconds to wait before the one retry, or null when the wait is too long
 * to spend inside a sync. Retry-After may be seconds or an HTTP date.
 */
export function retryWaitMs(header: string | null, now = Date.now()): number | null {
  if (header === null || header.trim() === '') return 250;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  if (!Number.isFinite(ms)) return 250;
  const wait = Math.max(0, ms);
  return wait <= JEV_MAX_RETRY_WAIT_MS ? wait : null;
}

/**
 * Run fn over items, at most `limit` at once, settling each like
 * Promise.allSettled and keeping order. Once `deadline` (epoch ms) has passed,
 * items not yet started are rejected without being run: the pass's budget is
 * spent, and what is left waits for the next sync.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  deadline?: number,
): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      if (deadline !== undefined && Date.now() >= deadline) {
        out[i] = { status: 'rejected', reason: new Error('jev: pass budget spent') };
        continue;
      }
      try {
        out[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (reason) {
        out[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

type AskOpts = {
  /** Epoch ms by which the whole pass must be done (see JEV_PASS_BUDGET_MS). */
  deadline?: number;
  /** Tests only. */
  fetchFn?: typeof fetch;
  /** Tests only. */
  sleep?: (ms: number) => Promise<void>;
};

/**
 * The one impure function. It throws on any failure, and every caller swallows
 * the throw, because no Jev decision is worth failing a sync over. It retries
 * once on a 429 or 5xx, and only when Retry-After is short.
 */
export const askJev = async (
  state: unknown,
  questions: Record<string, JevQuestion>,
  opts: AskOpts = {},
): Promise<JevResponse> => {
  const key = Deno.env.get('JEV_API_KEY');
  if (!key) throw new Error('jev: JEV_API_KEY is not set');
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const body = JSON.stringify({ state, model: JEV_MODEL, questions });

  for (let attempt = 0;; attempt++) {
    const left = opts.deadline === undefined
      ? JEV_CLIENT.timeout
      : Math.min(JEV_CLIENT.timeout, opts.deadline - Date.now());
    if (left <= 0) throw new Error('jev: pass budget spent');

    // A plain timer, cleared in `finally`: no pending timers outlive the call.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), left);
    let status = 0;
    let wait: number | null = null;
    try {
      const res = await fetchFn(JEV_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      if (res.ok) {
        const json = asObject(await res.json());
        const answers = asObject(json?.answers);
        if (!json || !answers) throw new Error('jev: reply has no answers');
        return { model: String(json.model ?? ''), answers };
      }
      status = res.status;
      wait = retryWaitMs(res.headers.get('retry-after'));
      await res.body?.cancel();
    } finally {
      clearTimeout(timer);
    }

    const retryable = status === 429 || status >= 500;
    if (!retryable || attempt >= JEV_CLIENT.maxRetries || wait === null) {
      throw new Error(`jev: HTTP ${status}`);
    }
    await sleep(wait);
  }
};
