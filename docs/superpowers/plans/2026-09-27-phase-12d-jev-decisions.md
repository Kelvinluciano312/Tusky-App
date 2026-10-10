# Phase 12d — Jev Decisions Implementation Plan

**Status (2026-09-28):** built and merged (PR #28). The migration is on dev and the sync functions are deployed there. Still open: (1) prod has not had the 12d migration (`20261007120000`) pushed or the sync functions redeployed; (2) no live Jev call has run on dev yet: 0 rows are triaged and the AI cache is empty, because no sync with `ai_categorize` on has happened since the deploy.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Jev (TypeSafe AI's System One model) Tusky's engine for every structured decision: categorization (replacing 12b's Haiku), review-deck priority, split hints and recurring tiebreaks. It stays behind one off-by-default switch and the `aiAllowed()` subscriber seam.

**Architecture:** One impure client (`askJev`, raw `fetch`) lives in `_shared/jev.ts` beside pure readers and a bounded-concurrency helper. Each surface keeps its question builders and answer readers next to its own logic (`ai.ts`, `triage.ts`, `recurring.ts`) and takes the client as an injected `JevAsk`, so every branch is tested offline. `syncItem` checks the gate once (`jevEnabled`) after the cursor advance and runs the passes. Each pass swallows its own errors.

**Tech Stack:** Supabase Edge Functions (Deno, `npm:` imports, `jsr:@std/assert` tests), Postgres migrations, Expo SDK 57 app (`node --test` for pure logic), TypeSafe System One HTTP API.

**Spec:** `docs/superpowers/specs/2026-09-27-phase-12d-jev-decisions-design.md`

## Global Constraints

- **Never fail a sync.** Every Jev pass catches, logs with `console.warn`, and returns 0. Rows and streams keep what the non-Jev path gave them.
- **After the cursor advance.** All Jev passes run after `sync_cursor` is written and `result` is latched, beside the snapshot pass.
- **The global cache stays clean.** Only categorization writes `ai_category_cache`, and only with built-in categories. It never writes a private-account row. Triage never touches the cache.
- **Manual always wins.** Categorization writes re-check `.eq('category_is_manual', false)`. Triage writes re-check `.is('reviewed_at', null)`.
- **Jev-owned columns are never in sync's upsert payload** (`ai_confidence`, `ai_level`, `review_priority`, `split_suggested`). A bulk upsert sends the union of the rows' keys.
- **One gate for everything:** `hasJevKey() && aiAllowed(herd_id) && profiles.ai_categorize` (the connector's), checked once per sync by `jevEnabled`. `aiAllowed` stays `true`.
- **Constants:** `JEV_MODEL = 'jev-latest'`, `JEV_URL = 'https://api.typesafe.ai/v1/systemone'`, `JEV_CONFIDENCE = 0.9`, secret `JEV_API_KEY`. The request body is `{ state, model, questions }`. Transport is raw `fetch`, never the TypeSafe SDK.
- **`category_source` stays `'ai'`.** No enum change.
- **Production:** no command against `awiwcgrisyzimzxgddxu` without Pedro's go-ahead. The CLI stays linked to dev (`ifibrsgqdibcomzxencf`). Never `supabase secrets set --env-file`.
- **Commands:** Edge tests `npx -y deno test --allow-env supabase/functions/_shared/` (the flag is required; the bare command in CLAUDE.md fails 9 tests). App: `npm test`, `npm run typecheck`, `npx expo lint` inside `apps/mobile`. Supabase CLI: `npx -y supabase@2.118.0 …`.
- **Git:** commit per task with a `git commit` heredoc ending `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Create the PR, but never merge it: Pedro merges.

## Where this plan departs from the spec

These were decided while planning, against the code as it is. Each one is marked where it lands.

1. **A child is written only when its group also clears `JEV_CONFIDENCE`** (Task 3). The spec wrote the child on the child's confidence alone. But `child__<group>` asks "within *this* group…", so a confident child under a doubtful group is confidently answering the wrong question.
2. **No per-column SELECT grants** (Task 1). `transactions` already has a table-level `grant select … to authenticated` (Phase 6). That grant covers new columns, and it makes `ai_confidence`/`ai_level` readable too, which is harmless because RLS limits every row to its own herd. The migration verifies the client has **no UPDATE** on any of the four columns.
3. **The timeout is tighter, and each pass has a budget** (Task 2). `JEV_CLIENT.timeout` is 10 s, not 20 s, and `JEV_PASS_BUDGET_MS = 15_000` caps each pass. 12b made one call per sync; a Jev pass makes up to 50.
4. **`review_priority` stores the Score rounded to its nearest level (0–2)** (Task 4). Rows then group into at most 6 write statements, and the app orders by level.
5. **The Haiku categorization code is deleted** (Task 3). It covers `askClaude`, `hasAnthropicKey`, `AI_CLIENT` and the `@anthropic-ai/sdk`/`zod` imports. This resolves the spec's first open item: there are no Haiku credits, and the future chat will get its own client.
6. **Builders and readers live beside their surface** (`ai.ts`, `triage.ts`, `recurring.ts`). `jev.ts` holds only the client and the generic readers.
7. **The gate is checked once per sync** (`jevEnabled`), not inside each pass.
8. **Triage selects unreviewed, not-yet-judged posted rows** (newest 50) rather than "rows posted in this sync". A failed row is retried next sync.
9. **"Ambiguous" recurring is defined:** a regular cadence with ≥ 3 payments whose amounts stray past the tolerance but stay within `NEAR_MISS_FACTOR = 2` times it (Task 5).
10. **The split hint also hides when the payer was picked by hand** (Task 6).

## Review Focus

1. **A transient Jev failure must never be cached as "declined."** A 503, a timeout, a spent budget or a 402 (out of credit) is not a decline. Remembering it would mean that merchant is never asked about again. *Pinned by Task 3's "a merchant whose call failed is neither written nor remembered" and "a failed call is left out, not declined."*
2. **A doubtful group must not yield a confident-looking child** (departure 1). *Pinned by Task 3's "an unsure group declines even when its child question is sure."*
3. **A degraded vendor must not hold a user's sync open for minutes.** With 50 calls, 8 at a time, each timing out at 10 s, one pass would take ~70 s. *Pinned by Task 2's "mapLimit starts nothing once the deadline has passed" and "askJev past its deadline throws before sending anything", and Task 3's "each call carries the pass deadline."*
4. **A flaky call must not make a recurring stream flicker.** If Jev tips a near miss in on Monday and its call fails on Tuesday, the stream must survive Tuesday. *Pinned by Task 5's "a near miss Jev could not judge is kept, never deleted."*
5. **The split hint must never show where it means nothing:** a solo herd, a private account, income, a row already split, or a payer picked by hand. *Pinned by Task 4's `asksSplit` tests and "a solo herd is never asked about splitting", and by Task 6's render condition.*

---

### Task 1: Schema: the Jev-owned columns

**Files:**
- Create: `supabase/migrations/20261007120000_phase12d_jev_decisions.sql`

**Interfaces:**
- Produces: `ai_category_cache.confidence numeric`, `ai_category_cache.level text` (`'child'|'group'`). On `transactions`: `ai_confidence numeric`, `ai_level text`, `review_priority smallint` (0–2) and `split_suggested boolean`. All are nullable, and every task after this one writes or reads them.

- [x] **Step 1: Confirm the CLI is linked to dev**

Run: `cat supabase/.temp/project-ref`
Expected: `ifibrsgqdibcomzxencf`. Anything else: STOP and tell Pedro.

- [x] **Step 2: Write the migration**

```sql
-- Phase 12d: Jev decisions. Every column here is written only by sync's Jev
-- passes (service_role). None is ever in sync's upsert payload — a bulk upsert
-- sends the union of the rows' keys — and the app never writes any of them.

-- How sure Jev was of a cached answer, and at which level of the tree it
-- answered. Null on rows cached by 12b's Haiku, which reported no confidence.
alter table public.ai_category_cache
  add column confidence numeric check (confidence between 0 and 1),
  add column level text check (level in ('child', 'group'));

alter table public.transactions
  -- Copied from the answer that set an `ai` category, and kept when the user
  -- fixes it: cat-quality.mjs reads both sides to calibrate JEV_CONFIDENCE.
  add column ai_confidence numeric check (ai_confidence between 0 and 1),
  add column ai_level text check (ai_level in ('child', 'group')),
  -- Review triage: 0 routine, 1 worth a glance, 2 likely needs a fix.
  add column review_priority smallint check (review_priority between 0 and 2),
  -- Looks like a shared expense. A hint only: it never writes `split`.
  add column split_suggested boolean;

comment on column public.transactions.review_priority is
  'Jev review triage (12d): 0 routine, 1 worth a glance, 2 likely needs a fix; null = not judged.';
comment on column public.transactions.split_suggested is
  'Jev hint (12d, shared herds only): looks like a shared expense. Never writes split.';

-- No grants on purpose. The table-level SELECT that authenticated has had on
-- transactions since Phase 6 already covers these columns, and no client may
-- write them: there is no UPDATE grant. ai_category_cache stays server-only.
```

- [x] **Step 3: Apply it to dev**

Run: `npx -y supabase@2.118.0 db push`
Expected: `Applying migration 20261007120000_phase12d_jev_decisions.sql...` then `Finished supabase db push.`

- [x] **Step 4: Verify the privileges**

Run:
```bash
npx -y supabase@2.118.0 db query --linked -o csv "select has_column_privilege('authenticated','public.transactions','review_priority','SELECT') as read_priority, has_column_privilege('authenticated','public.transactions','split_suggested','SELECT') as read_split, has_column_privilege('authenticated','public.transactions','review_priority','UPDATE') as write_priority, has_column_privilege('authenticated','public.transactions','split_suggested','UPDATE') as write_split, has_column_privilege('authenticated','public.transactions','ai_confidence','UPDATE') as write_conf, has_column_privilege('authenticated','public.transactions','ai_level','UPDATE') as write_level, has_table_privilege('authenticated','public.ai_category_cache','SELECT') as read_cache"
```
Expected: `t,t,f,f,f,f,f`. Any `t` in the last five: STOP, because a client could write a Jev column or read the global cache.

- [x] **Step 5: Run the RLS check**

Run: `node scripts/rls-check.mjs`
Expected: every check passes, as before the migration (columns on an already-protected table change nothing).

- [x] **Step 6: Commit**

```bash
git add supabase/migrations/20261007120000_phase12d_jev_decisions.sql
git commit -F - <<'EOF'
feat(db): the columns Jev's decisions land in (Phase 12d)

Confidence and level on the AI cache and on each row, a review priority and
a split hint. Nullable, server-written, never in sync's upsert payload.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 2: The Jev client

**Files:**
- Create: `supabase/functions/_shared/jev.ts`
- Test: `supabase/functions/_shared/jev.test.ts`

**Interfaces:**
- Produces (used by Tasks 3–5):
  - `JEV_URL`, `JEV_MODEL`, `JEV_CLIENT = { timeout: 10_000, maxRetries: 1 }`, `JEV_PASS_BUDGET_MS = 15_000`, `JEV_CONCURRENCY = 8`, `JEV_MAX_RETRY_WAIT_MS = 2_000`
  - `type JevQuestion` (choice | score | noul), `type JevResponse = { model: string; answers: Record<string, unknown> }`
  - `type JevAsk = (state: unknown, questions: Record<string, JevQuestion>, opts?: { deadline?: number }) => Promise<JevResponse>`
  - `askJev: JevAsk`-compatible (extra test-only opts `fetchFn`, `sleep`), `hasJevKey(): boolean`
  - `readChoice(a): { choice: string; confidence: number } | null`, `readScore(a): { score: number; confidence: number } | null`, `readNoul(a): number | null`
  - `mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, deadline?: number): Promise<PromiseSettledResult<R>[]>`
  - `retryWaitMs(header: string | null, now?: number): number | null`

- [x] **Step 1: Write the failing tests**

`supabase/functions/_shared/jev.test.ts`:

```ts
import { assertEquals, assertRejects } from 'jsr:@std/assert';

import {
  askJev,
  hasJevKey,
  JEV_CLIENT,
  JEV_MODEL,
  JEV_PASS_BUDGET_MS,
  JEV_URL,
  type JevQuestion,
  mapLimit,
  readChoice,
  readNoul,
  readScore,
  retryWaitMs,
} from './jev.ts';

const withKey = async (body: () => Promise<void>) => {
  const had = Deno.env.get('JEV_API_KEY');
  Deno.env.set('JEV_API_KEY', 'jev-test');
  try {
    await body();
  } finally {
    if (had === undefined) Deno.env.delete('JEV_API_KEY');
    else Deno.env.set('JEV_API_KEY', had);
  }
};

const Q: Record<string, JevQuestion> = { urgent: { type: 'noul', instructions: 'Is this urgent?' } };
const OK = {
  model: 'jev-1.13.0',
  answers: { urgent: { type: 'noul', noul: 0.9 } },
  usage: { input_tokens: 10, output_tokens: 3 },
};

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

/** A fetch that replays `replies` in order and records what it was sent. */
function fakeFetch(replies: Reply[]) {
  const sent: { url: string; init: RequestInit }[] = [];
  const fn = (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    const r = replies.shift();
    if (!r) throw new Error('no reply planned');
    return Promise.resolve(
      new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers }),
    );
  };
  return { fetchFn: fn as typeof fetch, sent };
}

const noSleep = () => Promise.resolve();

Deno.test('readChoice reads a choice and refuses anything else', () => {
  assertEquals(
    readChoice({ type: 'choice', choice: 'gas', confidence: 0.93, probabilities: { gas: 0.95 } }),
    { choice: 'gas', confidence: 0.93 },
  );
  assertEquals(readChoice({ type: 'score', score: 1, confidence: 1 }), null);
  assertEquals(readChoice({ type: 'choice', choice: 'gas' }), null);
  assertEquals(readChoice(undefined), null);
});

Deno.test('readScore reads the position on the levels and its confidence', () => {
  assertEquals(readScore({ type: 'score', score: 1.43, confidence: 0.64, probabilities: {} }), {
    score: 1.43,
    confidence: 0.64,
  });
  assertEquals(readScore({ type: 'score', score: 'high', confidence: 1 }), null);
  assertEquals(readScore({ type: 'noul', noul: 0.4 }), null);
});

Deno.test('readNoul reads a probability and refuses one outside 0..1', () => {
  assertEquals(readNoul({ type: 'noul', noul: 0.93 }), 0.93);
  assertEquals(readNoul({ type: 'noul', noul: 1.2 }), null);
  assertEquals(readNoul({ type: 'noul', noul: '0.9' }), null);
  assertEquals(readNoul(null), null);
});

Deno.test('hasJevKey follows JEV_API_KEY', async () => {
  const had = Deno.env.get('JEV_API_KEY');
  Deno.env.delete('JEV_API_KEY');
  try {
    // A project with no key syncs normally; every Jev pass is skipped.
    assertEquals(hasJevKey(), false);
  } finally {
    if (had !== undefined) Deno.env.set('JEV_API_KEY', had);
  }
  await withKey(() => {
    assertEquals(hasJevKey(), true);
    return Promise.resolve();
  });
});

Deno.test('the client is bounded: a slow vendor must not hold a sync open', () => {
  assertEquals(JEV_CLIENT.timeout <= 10_000, true);
  assertEquals(JEV_CLIENT.maxRetries <= 1, true);
  assertEquals(JEV_PASS_BUDGET_MS <= 20_000, true);
});

Deno.test('askJev posts state, the pinned model and the questions, with the key as a bearer token', async () => {
  await withKey(async () => {
    const { fetchFn, sent } = fakeFetch([{ status: 200, body: OK }]);
    const res = await askJev({ merchant: 'Shell' }, Q, { fetchFn, sleep: noSleep });
    assertEquals(res.answers.urgent, { type: 'noul', noul: 0.9 });
    assertEquals(res.model, 'jev-1.13.0');
    assertEquals(sent.length, 1);
    assertEquals(sent[0].url, JEV_URL);
    assertEquals(sent[0].init.method, 'POST');
    assertEquals((sent[0].init.headers as Record<string, string>).Authorization, 'Bearer jev-test');
    assertEquals(JSON.parse(sent[0].init.body as string), {
      state: { merchant: 'Shell' },
      model: JEV_MODEL,
      questions: Q,
    });
  });
});

Deno.test('askJev retries a 429 once, waiting out a short Retry-After', async () => {
  await withKey(async () => {
    const { fetchFn, sent } = fakeFetch([
      { status: 429, headers: { 'retry-after': '1' } },
      { status: 200, body: OK },
    ]);
    const waits: number[] = [];
    const res = await askJev({}, Q, { fetchFn, sleep: (ms) => (waits.push(ms), Promise.resolve()) });
    assertEquals(res.answers.urgent, { type: 'noul', noul: 0.9 });
    assertEquals(sent.length, 2);
    assertEquals(waits, [1000]);
  });
});

Deno.test('askJev gives up after one retry', async () => {
  await withKey(async () => {
    const { fetchFn, sent } = fakeFetch([{ status: 503 }, { status: 503 }]);
    await assertRejects(() => askJev({}, Q, { fetchFn, sleep: noSleep }), Error, 'HTTP 503');
    assertEquals(sent.length, 2);
  });
});

Deno.test('askJev does not retry a request the API refused', async () => {
  await withKey(async () => {
    for (const status of [400, 401, 402]) {
      const { fetchFn, sent } = fakeFetch([{ status }]);
      await assertRejects(() => askJev({}, Q, { fetchFn, sleep: noSleep }), Error, `HTTP ${status}`);
      assertEquals(sent.length, 1);
    }
  });
});

Deno.test('askJev will not wait out a long Retry-After inside a sync', async () => {
  await withKey(async () => {
    const { fetchFn, sent } = fakeFetch([{ status: 429, headers: { 'retry-after': '30' } }]);
    await assertRejects(() => askJev({}, Q, { fetchFn, sleep: noSleep }), Error, 'HTTP 429');
    assertEquals(sent.length, 1);
  });
});

Deno.test('askJev refuses a reply with no answers', async () => {
  await withKey(async () => {
    const { fetchFn } = fakeFetch([{ status: 200, body: { model: 'jev-1.13.0' } }]);
    await assertRejects(() => askJev({}, Q, { fetchFn, sleep: noSleep }), Error, 'no answers');
  });
});

Deno.test('askJev without a key throws before sending anything', async () => {
  const had = Deno.env.get('JEV_API_KEY');
  Deno.env.delete('JEV_API_KEY');
  try {
    const { fetchFn, sent } = fakeFetch([]);
    await assertRejects(() => askJev({}, Q, { fetchFn, sleep: noSleep }), Error, 'JEV_API_KEY');
    assertEquals(sent.length, 0);
  } finally {
    if (had !== undefined) Deno.env.set('JEV_API_KEY', had);
  }
});

Deno.test('askJev past its deadline throws before sending anything', async () => {
  await withKey(async () => {
    const { fetchFn, sent } = fakeFetch([{ status: 200, body: OK }]);
    await assertRejects(
      () => askJev({}, Q, { fetchFn, sleep: noSleep, deadline: Date.now() - 1 }),
      Error,
      'budget',
    );
    assertEquals(sent.length, 0);
  });
});

Deno.test('retryWaitMs: short waits are honoured, long ones are a failure', () => {
  assertEquals(retryWaitMs(null), 250);
  assertEquals(retryWaitMs(''), 250);
  assertEquals(retryWaitMs('garbage'), 250);
  assertEquals(retryWaitMs('0'), 0);
  assertEquals(retryWaitMs('1'), 1000);
  assertEquals(retryWaitMs('30'), null);
  const now = Date.parse('2026-09-27T12:00:00Z');
  assertEquals(retryWaitMs('Sun, 27 Sep 2026 12:00:01 GMT', now), 1000);
});

Deno.test('mapLimit never runs more than `limit` at once, and keeps order', async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 1));
    running--;
    return n * 2;
  });
  assertEquals(peak <= 3, true);
  assertEquals(out.map((s) => (s.status === 'fulfilled' ? s.value : null)), [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
});

Deno.test('mapLimit settles a failure without stopping the rest', async () => {
  const out = await mapLimit([1, 2, 3], 2, (n) => (n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(n)));
  assertEquals(out.map((s) => s.status), ['fulfilled', 'rejected', 'fulfilled']);
});

Deno.test('mapLimit starts nothing once the deadline has passed', async () => {
  let ran = 0;
  const out = await mapLimit([1, 2], 2, () => {
    ran++;
    return Promise.resolve(1);
  }, Date.now() - 1);
  assertEquals(ran, 0);
  assertEquals(out.every((s) => s.status === 'rejected'), true);
});
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx -y deno test --allow-env supabase/functions/_shared/jev.test.ts`
Expected: FAIL. The module `./jev.ts` cannot be found.

- [x] **Step 3: Write the client**

`supabase/functions/_shared/jev.ts`:

```ts
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
```

- [x] **Step 4: Run the tests to verify they pass**

Run: `npx -y deno test --allow-env supabase/functions/_shared/jev.test.ts`
Expected: PASS, all 17 tests, with no "leaking async ops" warning.

- [x] **Step 5: Run the whole Edge suite**

Run: `npx -y deno test --allow-env supabase/functions/_shared/`
Expected: `ok | 171 passed | 0 failed` (154 before, plus 17).

- [x] **Step 6: Commit**

```bash
git add supabase/functions/_shared/jev.ts supabase/functions/_shared/jev.test.ts
git commit -F - <<'EOF'
feat(sync): a bounded client for Jev's typed decisions (Phase 12d)

Raw fetch to TypeSafe's System One API, one retry on 429/5xx with a short
Retry-After, a per-call timeout and a per-pass deadline. Readers return
null on any shape they do not expect.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 3: Categorization through Jev

Replaces the Haiku fallback. The pure 12b scaffolding (cache key, ask list, answers → updates, grouped writes, private-row exclusion) stays. What changes: answers now carry confidence and level, groups become valid answers, and the model call is a Jev fan-out per merchant. The gate moves to `jevEnabled` in sync.ts.

**Files:**
- Modify: `supabase/functions/_shared/ai.ts` (full rewrite below)
- Modify: `supabase/functions/_shared/ai.test.ts` (full rewrite below)
- Modify: `supabase/functions/_shared/sync.ts` (imports lines 5–17; `runAiPass` lines 212–307; the 12b call in `syncItem` around lines 558–563)
- Modify: `supabase/functions/_shared/sync.test.ts` (imports lines 4–5; lines 52–204)

**Interfaces:**
- Consumes (Task 2): `askJev`, `hasJevKey`, `JEV_CONCURRENCY`, `JEV_PASS_BUDGET_MS`, `type JevAsk`, `type JevQuestion`, `type JevResponse`, `mapLimit`, `readChoice`
- Produces:
  - `ai.ts`: `JEV_CONFIDENCE = 0.9`, `FALLBACK_SLUG = 'uncategorized'`, `type AiLevel = 'child' | 'group'`, `type AiVerdict = { category_id: string; confidence: number | null; level: AiLevel | null }`, `type AiCategory = { id; slug; name; parent_slug: string | null }`, `type AiAnswer = { key: string; slug: string | null; confidence?: number; level?: AiLevel }`, `categoryQuestions(cats)`, `categoryState(row)`, `pickCategorization(res, cats)`, `jevCategorizer(ask?): AskFn`. `buildAskList`, `applyAnswers` and `groupUpdates` now carry `AiVerdict` (the signatures are in the code below).
  - `sync.ts`: `jevEnabled(admin, item: { user_id: string; herd_id: string }): Promise<boolean>`, and `runAiPass(admin, item, ask?: AskFn)`, which no longer gates itself.

- [x] **Step 1: Write the failing `ai.test.ts`**

Replace the whole file with:

```ts
import { assertEquals, assertRejects, assertThrows } from 'jsr:@std/assert';

import {
  AI_MAX_PER_SYNC,
  type AiCategory,
  type AiLevel,
  type AiRow,
  aiAllowed,
  applyAnswers,
  buildAskList,
  cacheKeyFor,
  categoryQuestions,
  categoryState,
  FALLBACK_SLUG,
  groupUpdates,
  JEV_CONFIDENCE,
  jevCategorizer,
  pickCategorization,
} from './ai.ts';
import { JEV_PASS_BUDGET_MS, type JevAsk, type JevResponse } from './jev.ts';

const CATS: AiCategory[] = [
  { id: 'g-food', slug: 'food_and_dining', name: 'Food & Dining', parent_slug: null },
  { id: 'c-groceries', slug: 'groceries', name: 'Groceries', parent_slug: 'food_and_dining' },
  { id: 'c-restaurants', slug: 'restaurants', name: 'Restaurants', parent_slug: 'food_and_dining' },
  { id: 'g-transport', slug: 'transportation', name: 'Transportation', parent_slug: null },
  { id: 'c-fuel', slug: 'gas', name: 'Gas', parent_slug: 'transportation' },
  { id: 'c-parking', slug: 'parking', name: 'Parking', parent_slug: 'transportation' },
  { id: 'g-none', slug: 'uncategorized', name: 'Uncategorized', parent_slug: null },
];

const row = (over: Partial<AiRow> = {}): AiRow => ({
  id: 't1',
  merchant_key: 'shell',
  name: 'SHELL OIL 4412',
  merchant_name: 'Shell',
  amount: -48.2,
  pfc_primary: 'TRANSPORTATION',
  pfc_detailed: null,
  is_private: false,
  ...over,
});

/** A verdict as the cache and the row writes carry it. */
const v = (category_id: string, confidence: number | null = 0.95, level: AiLevel | null = 'child') => ({
  category_id,
  confidence,
  level,
});

/** One merchant's answer from the categorizer; a null slug is a decline. */
const ans = (key: string, slug: string | null, confidence = 0.95, level: AiLevel = 'child') =>
  slug === null ? { key, slug } : { key, slug, confidence, level };

const choice = (c: string, confidence: number) => ({ type: 'choice', choice: c, confidence, probabilities: {} });
const reply = (answers: Record<string, unknown>): JevResponse => ({ model: 'jev-1.13.0', answers });
const SURE_GAS = reply({ group: choice('transportation', 0.97), child__transportation: choice('gas', 0.96) });

// --- The 12b scaffolding, now carrying confidence ---------------------------

Deno.test('aiAllowed lets every herd through for now — the seam a subscription check will fill', () => {
  assertEquals(aiAllowed('any-herd-id'), true);
});

Deno.test('the per-sync cap is 50', () => {
  assertEquals(AI_MAX_PER_SYNC, 50);
});

Deno.test('cacheKeyFor groups a merchant by direction and amount band, not by exact amount', () => {
  assertEquals(cacheKeyFor(row({ amount: -48.2 })), cacheKeyFor(row({ amount: -22 })));
  assertEquals(cacheKeyFor(row({ amount: 48.2 })) === cacheKeyFor(row({ amount: -48.2 })), false);
  assertEquals(cacheKeyFor(row({ amount: -4 })) === cacheKeyFor(row({ amount: -48 })), false);
});

Deno.test('a blank merchant keys on its own description, not on every other blank one', () => {
  const a = row({ id: 'a', merchant_key: '', merchant_name: null, name: 'SQ *BLUE BOTTLE' });
  const b = row({ id: 'b', merchant_key: '', merchant_name: null, name: 'POS DEBIT 88213' });
  assertEquals(cacheKeyFor(a) === cacheKeyFor(b), false);
});

Deno.test('buildAskList answers from the cache, confidence included, and only asks about the rest', () => {
  const cached = new Map([[cacheKeyFor(row()), v('c-fuel')]]);
  const other = row({ id: 't2', merchant_key: 'lidl', merchant_name: 'Lidl', name: 'LIDL 220', amount: -31 });
  const { ask, resolved } = buildAskList([row(), other], cached);
  assertEquals(ask.map((r) => r.id), ['t2']);
  assertEquals(resolved.get('t1'), v('c-fuel'));
});

Deno.test('the same merchant twice in one batch is asked about once, and both rows get the answer', () => {
  const a = row({ id: 'a' });
  const b = row({ id: 'b', amount: -49 });
  const { ask } = buildAskList([a, b], new Map());
  assertEquals(ask.length, 1);

  const { updates } = applyAnswers([a, b], [ans(cacheKeyFor(a), 'gas')], CATS);
  assertEquals(updates.sort((x, y) => x.id.localeCompare(y.id)), [
    { id: 'a', ...v('c-fuel') },
    { id: 'b', ...v('c-fuel') },
  ]);
});

Deno.test('a slug we never offered is ignored, and the row keeps what it had', () => {
  const { updates, cacheable } = applyAnswers([row()], [ans(cacheKeyFor(row()), 'crypto-moonshots')], CATS);
  assertEquals(updates, []);
  assertEquals(cacheable, []);
});

Deno.test('an answer for a key we did not ask about is ignored', () => {
  const { updates } = applyAnswers([row()], [ans('some-other-key', 'gas')], CATS);
  assertEquals(updates, []);
});

Deno.test('a duplicated key takes the first answer and ignores the rest', () => {
  const key = cacheKeyFor(row());
  const { updates } = applyAnswers([row()], [ans(key, 'gas'), ans(key, 'groceries')], CATS);
  assertEquals(updates, [{ id: 't1', ...v('c-fuel') }]);
});

Deno.test('a private row takes the answer but never reaches the global cache', () => {
  const secret = row({ id: 'p1', is_private: true });
  const { updates, cacheable } = applyAnswers([secret], [ans(cacheKeyFor(secret), 'gas')], CATS);
  assertEquals(updates, [{ id: 'p1', ...v('c-fuel') }]);
  assertEquals(cacheable, []);
});

Deno.test('a shared row is cacheable, with its confidence and level', () => {
  const { cacheable } = applyAnswers([row()], [ans(cacheKeyFor(row()), 'gas')], CATS);
  assertEquals(cacheable, [{ key: cacheKeyFor(row()), ...v('c-fuel') }]);
});

Deno.test('a group-level answer lands on the group', () => {
  const { updates } = applyAnswers([row()], [ans(cacheKeyFor(row()), 'transportation', 0.92, 'group')], CATS);
  assertEquals(updates, [{ id: 't1', ...v('g-transport', 0.92, 'group') }]);
});

Deno.test('an explicit decline is remembered, so the merchant is asked about once', () => {
  const key = cacheKeyFor(row());
  const { updates, unanswered } = applyAnswers([row()], [ans(key, null)], CATS, [key]);
  assertEquals(updates, []);
  assertEquals(unanswered, [key]);
});

Deno.test('an asked key with no usable answer is remembered as declined', () => {
  const asked = [cacheKeyFor(row())];
  const { updates, unanswered } = applyAnswers([row()], [], CATS, asked);
  assertEquals(updates, []);
  assertEquals(unanswered, asked);
});

Deno.test('a private row the model declined is not remembered either', () => {
  const secret = row({ is_private: true });
  const { unanswered } = applyAnswers([secret], [], CATS, [cacheKeyFor(secret)]);
  assertEquals(unanswered, []);
});

Deno.test('a remembered "no answer" resolves the row without asking again', () => {
  const cached = new Map([[cacheKeyFor(row()), null]]);
  const { ask, resolved } = buildAskList([row()], cached);
  assertEquals(ask, []);
  assertEquals(resolved.size, 0);
});

Deno.test('an answer for a key outside the ask list is ignored', () => {
  const { updates } = applyAnswers([row()], [ans(cacheKeyFor(row()), 'gas')], CATS, []);
  assertEquals(updates, []);
});

Deno.test('updates are grouped by what they write and chunked, not written one row at a time', () => {
  const updates = [
    { id: 'a', ...v('c-fuel') },
    { id: 'b', ...v('c-fuel') },
    { id: 'c', ...v('c-fuel') },
    { id: 'd', ...v('c-fuel', 0.91) },
    { id: 'e', ...v('c-groceries') },
  ];
  assertEquals(groupUpdates(updates, 2), [
    { verdict: v('c-fuel'), ids: ['a', 'b'] },
    { verdict: v('c-fuel'), ids: ['c'] },
    { verdict: v('c-fuel', 0.91), ids: ['d'] },
    { verdict: v('c-groceries'), ids: ['e'] },
  ]);
});

// --- The Jev fan-out -------------------------------------------------------

Deno.test('the group question offers every group, with "none fits" for the fallback', () => {
  const q = categoryQuestions(CATS);
  assertEquals(q.group.type, 'choice');
  const criteria = (q.group as { criteria: Record<string, string> }).criteria;
  assertEquals(Object.keys(criteria).sort(), ['food_and_dining', 'transportation', 'uncategorized']);
  // The children's names tell Jev what each group means.
  assertEquals(criteria.food_and_dining, 'Food & Dining (Groceries, Restaurants)');
  assertEquals(criteria[FALLBACK_SLUG], 'None of these clearly fits');
});

Deno.test('one child question per group with at least two children, all in the same request', () => {
  const q = categoryQuestions(CATS);
  assertEquals(Object.keys(q).sort(), ['child__food_and_dining', 'child__transportation', 'group']);
  assertEquals((q.child__transportation as { criteria: Record<string, string> }).criteria, {
    gas: 'Gas',
    parking: 'Parking',
  });
});

Deno.test('a group with one child gets no child question: one option is not a choice', () => {
  const q = categoryQuestions([
    ...CATS,
    { id: 'g-gifts', slug: 'gifts', name: 'Gifts', parent_slug: null },
    { id: 'c-donations', slug: 'donations', name: 'Donations', parent_slug: 'gifts' },
  ]);
  assertEquals('child__gifts' in q, false);
  assertEquals('gifts' in (q.group as { criteria: Record<string, string> }).criteria, true);
});

Deno.test('the state is merchant-level text only', () => {
  assertEquals(categoryState(row()), {
    merchant: 'Shell',
    description: 'SHELL OIL 4412',
    amount: '48.20',
    direction: 'money out',
    bank_guess: 'TRANSPORTATION',
  });
});

Deno.test('a sure group and a sure child write the child', () => {
  assertEquals(pickCategorization(SURE_GAS, CATS), { slug: 'gas', confidence: 0.96, level: 'child' });
});

Deno.test('the threshold is inclusive', () => {
  const res = reply({
    group: choice('transportation', JEV_CONFIDENCE),
    child__transportation: choice('gas', JEV_CONFIDENCE),
  });
  assertEquals(pickCategorization(res, CATS), { slug: 'gas', confidence: JEV_CONFIDENCE, level: 'child' });
});

Deno.test('a sure group with an unsure child writes the group', () => {
  const res = reply({ group: choice('transportation', 0.97), child__transportation: choice('gas', 0.6) });
  assertEquals(pickCategorization(res, CATS), { slug: 'transportation', confidence: 0.97, level: 'group' });
});

Deno.test('an unsure group declines even when its child question is sure', () => {
  // The child question asked "within Transportation…". If the group itself is
  // doubtful, a confident child is a confident answer to the wrong question.
  const res = reply({ group: choice('transportation', 0.7), child__transportation: choice('gas', 0.99) });
  assertEquals(pickCategorization(res, CATS), null);
});

Deno.test('"none of these fits" is a decline', () => {
  assertEquals(pickCategorization(reply({ group: choice(FALLBACK_SLUG, 0.99) }), CATS), null);
});

Deno.test('a child from another group falls back to the group', () => {
  const res = reply({ group: choice('transportation', 0.97), child__transportation: choice('groceries', 0.99) });
  assertEquals(pickCategorization(res, CATS), { slug: 'transportation', confidence: 0.97, level: 'group' });
});

Deno.test('a group with no child question is answered at the group', () => {
  assertEquals(pickCategorization(reply({ group: choice('transportation', 0.95) }), CATS), {
    slug: 'transportation',
    confidence: 0.95,
    level: 'group',
  });
});

Deno.test('an unreadable reply throws: it is a failed call, not a decline', () => {
  assertThrows(() => pickCategorization(reply({}), CATS));
  assertThrows(() => pickCategorization(reply({ group: choice('crypto', 0.99) }), CATS));
});

Deno.test('jevCategorizer asks once per merchant, with the whole fan-out and the pass deadline', async () => {
  const seen: { state: unknown; keys: string[]; deadline?: number }[] = [];
  const ask: JevAsk = (state, questions, opts) => {
    seen.push({ state, keys: Object.keys(questions).sort(), deadline: opts?.deadline });
    return Promise.resolve(SURE_GAS);
  };
  const before = Date.now();
  const answers = await jevCategorizer(ask)([row()], CATS);
  assertEquals(answers, [{ key: cacheKeyFor(row()), slug: 'gas', confidence: 0.96, level: 'child' }]);
  assertEquals(seen.length, 1);
  assertEquals(seen[0].state, categoryState(row()));
  assertEquals(seen[0].keys, ['child__food_and_dining', 'child__transportation', 'group']);
  assertEquals(seen[0].deadline !== undefined && seen[0].deadline <= before + JEV_PASS_BUDGET_MS + 50, true);
});

Deno.test('jevCategorizer returns a decline as a null slug', async () => {
  const answers = await jevCategorizer(() => Promise.resolve(reply({ group: choice(FALLBACK_SLUG, 0.99) })))(
    [row()],
    CATS,
  );
  assertEquals(answers, [{ key: cacheKeyFor(row()), slug: null }]);
});

Deno.test('a failed call is left out, not declined', async () => {
  const lidl = row({ id: 't2', merchant_key: 'lidl', merchant_name: 'Lidl', name: 'LIDL 220', amount: -31 });
  const ask: JevAsk = (state) =>
    (state as { merchant: string }).merchant === 'Lidl'
      ? Promise.reject(new Error('jev: HTTP 503'))
      : Promise.resolve(SURE_GAS);
  const answers = await jevCategorizer(ask)([row(), lidl], CATS);
  assertEquals(answers.map((a) => a.key), [cacheKeyFor(row())]);
});

Deno.test('every call failing throws, so the pass logs why', async () => {
  await assertRejects(
    () => jevCategorizer(() => Promise.reject(new Error('jev: HTTP 402')))([row()], CATS),
    Error,
    '402',
  );
});

Deno.test('an unreadable reply for every merchant throws too', async () => {
  await assertRejects(() => jevCategorizer(() => Promise.resolve(reply({})))([row()], CATS));
});

Deno.test('no rows, no calls', async () => {
  let calls = 0;
  const answers = await jevCategorizer(() => {
    calls++;
    return Promise.resolve(SURE_GAS);
  })([], CATS);
  assertEquals(answers, []);
  assertEquals(calls, 0);
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx -y deno test --allow-env supabase/functions/_shared/ai.test.ts`
Expected: FAIL. TypeScript errors such as `Module './ai.ts' has no exported member 'categoryQuestions'`.

- [x] **Step 3: Rewrite `ai.ts`**

Replace the whole file with:

```ts
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
 * Whether this herd may use AI decisions. True for everyone today. AI is
 * meant to be a subscriber feature, and this is the one place that check will
 * go. Server-side on purpose: a tier limit is never enforced in the client.
 */
export function aiAllowed(_herdId: string): boolean {
  return true;
}

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
```

- [x] **Step 4: Run `ai.test.ts` to verify it passes**

Run: `npx -y deno test --allow-env supabase/functions/_shared/ai.test.ts`
Expected: PASS, all 36 tests.

- [x] **Step 5: Write the failing `sync.test.ts` changes**

Replace lines 4–5 (the imports) with:

```ts
import type { AiCategory, AiRow } from './ai.ts';
import { jevEnabled, loadCommunity, runAiPass } from './sync.ts';
```

Replace everything from `const ITEM = { id: 'item-1', …` (line 52) through the end of the test `'runAiPass: with no API key nothing is read and nothing is asked'` (line 204) with:

```ts
const ITEM = { id: 'item-1', user_id: 'user-1', herd_id: 'herd-1' };

// The built-ins the pass loads: a group and one of its children.
const CATEGORY_ROWS = [
  { id: 'g-transport', slug: 'transportation', name: 'Transportation', parent_id: null },
  { id: 'c-fuel', slug: 'gas', name: 'Gas', parent_id: 'g-transport' },
];

const txRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 't1',
  merchant_key: 'shell',
  name: 'SHELL OIL 4412',
  merchant_name: 'Shell',
  amount: -48.2,
  pfc_primary: 'TRANSPORTATION',
  pfc_detailed: null,
  accounts: { is_private: false },
  ...over,
});

/** The reads runAiPass makes, in order. The gate (jevEnabled) was checked before it. */
function readPlan(rows: unknown[], cache: unknown[] = []): Record<string, Resp[]> {
  return {
    'transactions:select': [{ data: rows }],
    'ai_category_cache:select': [{ data: cache }],
    'categories:select': [{ data: CATEGORY_ROWS }],
  };
}

const withKey = async (body: () => Promise<void>) => {
  const had = Deno.env.get('JEV_API_KEY');
  Deno.env.set('JEV_API_KEY', 'jev-test');
  try {
    await body();
  } finally {
    if (had === undefined) Deno.env.delete('JEV_API_KEY');
    else Deno.env.set('JEV_API_KEY', had);
  }
};

const gasAnswer = (r: AiRow) => ({ key: `${r.merchant_key}|out|2`, slug: 'gas', confidence: 0.97, level: 'child' as const });
const answerGas = (rows: AiRow[], _cats: AiCategory[]) => Promise.resolve(rows.map(gasAnswer));

Deno.test('jevEnabled: without a key nothing is read', async () => {
  const had = Deno.env.get('JEV_API_KEY');
  Deno.env.delete('JEV_API_KEY');
  try {
    const { admin, calls } = fakeAdmin({ 'profiles:select': [{ data: { ai_categorize: true } }] });
    assertEquals(await jevEnabled(admin, ITEM), false);
    assertEquals(calls.length, 0);
  } finally {
    if (had !== undefined) Deno.env.set('JEV_API_KEY', had);
  }
});

Deno.test('jevEnabled: a user who has not opted in gets no Jev decisions', async () => {
  await withKey(async () => {
    const { admin, of } = fakeAdmin({ 'profiles:select': [{ data: { ai_categorize: false } }] });
    assertEquals(await jevEnabled(admin, ITEM), false);
    // The connector's own switch.
    assertEquals(of('profiles', 'select')[0].filters, [['eq', 'user_id', 'user-1']]);
  });
});

Deno.test('jevEnabled: key, seam and switch together turn it on', async () => {
  await withKey(async () => {
    const { admin } = fakeAdmin({ 'profiles:select': [{ data: { ai_categorize: true } }] });
    assertEquals(await jevEnabled(admin, ITEM), true);
  });
});

Deno.test('jevEnabled: a failed profile read means off, never a thrown sync', async () => {
  await withKey(async () => {
    const { admin } = fakeAdmin({ 'profiles:select': [{ data: null, error: { message: 'boom' } }] });
    assertEquals(await jevEnabled(admin, ITEM), false);
  });
});

Deno.test('runAiPass: Jev is offered the built-in groups and their children', async () => {
  const { admin, of } = fakeAdmin(readPlan([txRow()]));
  let offered: AiCategory[] = [];
  await runAiPass(admin, ITEM, (rows, cats) => {
    offered = cats;
    return answerGas(rows, cats);
  });
  assertEquals(offered, [
    { id: 'g-transport', slug: 'transportation', name: 'Transportation', parent_slug: null },
    { id: 'c-fuel', slug: 'gas', name: 'Gas', parent_slug: 'transportation' },
  ]);
  // Built-ins only: a herd's custom category must never reach the global cache.
  assertEquals(of('categories', 'select')[0].filters, [['is', 'herd_id', null]]);
});

Deno.test('runAiPass: answers are written grouped, stamped `ai` with their confidence, and only over rows still not manual', async () => {
  const rows = [txRow({ id: 't1' }), txRow({ id: 't2', amount: -49 })];
  const { admin, of } = fakeAdmin(readPlan(rows));
  const set = await runAiPass(admin, ITEM, answerGas);

  assertEquals(set, 2);
  const writes = of('transactions', 'update');
  assertEquals(writes.length, 1);
  assertEquals(writes[0].payload, {
    category_id: 'c-fuel',
    category_source: 'ai',
    ai_confidence: 0.97,
    ai_level: 'child',
  });
  assertEquals(writes[0].filters, [
    ['in', 'id', ['t1', 't2']],
    // A row someone categorized by hand between the read and the write stays put.
    ['eq', 'category_is_manual', false],
  ]);
});

Deno.test('runAiPass: a group-level answer lands on the group', async () => {
  const { admin, of } = fakeAdmin(readPlan([txRow()]));
  await runAiPass(admin, ITEM, (asked) =>
    Promise.resolve(asked.map((r) => ({
      key: `${r.merchant_key}|out|2`,
      slug: 'transportation',
      confidence: 0.93,
      level: 'group' as const,
    }))));
  assertEquals(of('transactions', 'update')[0].payload, {
    category_id: 'g-transport',
    category_source: 'ai',
    ai_confidence: 0.93,
    ai_level: 'group',
  });
});

Deno.test('runAiPass: a private account\'s merchant never reaches the global cache', async () => {
  const rows = [txRow({ id: 'p1', accounts: { is_private: true } })];
  const { admin, of } = fakeAdmin(readPlan(rows));
  const set = await runAiPass(admin, ITEM, answerGas);

  assertEquals(set, 1);
  assertEquals(of('transactions', 'update').length, 1);
  assertEquals(of('ai_category_cache', 'upsert').length, 0);
});

Deno.test('runAiPass: a shared answer is cached with its confidence, and a declined merchant is cached as null', async () => {
  const rows = [txRow({ id: 't1' }), txRow({ id: 't2', merchant_key: 'mystery', name: 'POS DEBIT 88213' })];
  const { admin, of } = fakeAdmin(readPlan(rows));
  const set = await runAiPass(admin, ITEM, (asked) =>
    Promise.resolve(asked.map((r) =>
      r.merchant_key === 'shell'
        ? gasAnswer(r)
        // Jev chose "none of these fits": an explicit decline.
        : { key: `${r.merchant_key}|out|2`, slug: null }
    )));

  assertEquals(set, 1);
  const cached = of('ai_category_cache', 'upsert');
  assertEquals(cached.length, 1);
  assertEquals(cached[0].payload, [
    { cache_key: 'shell|out|2', category_id: 'c-fuel', confidence: 0.97, level: 'child' },
    // Without this row, the same unplaceable merchant is sent again every sync.
    { cache_key: 'mystery|out|2', category_id: null, confidence: null, level: null },
  ]);
});

Deno.test('runAiPass: a merchant whose call failed is neither written nor remembered', async () => {
  const rows = [txRow({ id: 't1' }), txRow({ id: 't2', merchant_key: 'mystery', name: 'POS DEBIT 88213' })];
  const { admin, of } = fakeAdmin(readPlan(rows));
  // Only shell came back: mystery's call failed (a 503, a timeout, the budget).
  const set = await runAiPass(admin, ITEM, (asked) =>
    Promise.resolve(asked.filter((r) => r.merchant_key === 'shell').map(gasAnswer)));

  assertEquals(set, 1);
  // Remembering mystery as declined would stop us ever asking about it again.
  assertEquals(of('ai_category_cache', 'upsert')[0].payload, [
    { cache_key: 'shell|out|2', category_id: 'c-fuel', confidence: 0.97, level: 'child' },
  ]);
});

Deno.test('runAiPass: a cache hit carries its confidence onto the row and asks nothing', async () => {
  const { admin, of } = fakeAdmin(
    readPlan([txRow()], [{ cache_key: 'shell|out|2', category_id: 'c-fuel', confidence: 0.96, level: 'child' }]),
  );
  let asked = false;
  const set = await runAiPass(admin, ITEM, () => {
    asked = true;
    return Promise.resolve([]);
  });
  assertEquals(asked, false);
  assertEquals(set, 1);
  assertEquals(of('transactions', 'update')[0].payload, {
    category_id: 'c-fuel',
    category_source: 'ai',
    ai_confidence: 0.96,
    ai_level: 'child',
  });
});

Deno.test('runAiPass: a 12b-era cache hit has no confidence, and says so', async () => {
  const { admin, of } = fakeAdmin(
    readPlan([txRow()], [{ cache_key: 'shell|out|2', category_id: 'c-fuel', confidence: null, level: null }]),
  );
  await runAiPass(admin, ITEM, () => Promise.resolve([]));
  assertEquals(of('transactions', 'update')[0].payload, {
    category_id: 'c-fuel',
    category_source: 'ai',
    ai_confidence: null,
    ai_level: null,
  });
});

Deno.test('runAiPass: a cached null answer costs nothing and asks nothing', async () => {
  const { admin, of } = fakeAdmin(
    readPlan([txRow({ id: 't1' })], [{ cache_key: 'shell|out|2', category_id: null, confidence: null, level: null }]),
  );
  let asked = false;
  const set = await runAiPass(admin, ITEM, () => {
    asked = true;
    return Promise.resolve([]);
  });
  assertEquals(asked, false);
  assertEquals(set, 0);
  assertEquals(of('transactions', 'update').length, 0);
  assertEquals(of('ai_category_cache', 'upsert').length, 0);
});

Deno.test('runAiPass: a vendor that fails costs the sync nothing', async () => {
  const { admin, calls } = fakeAdmin(readPlan([txRow()]));
  const set = await runAiPass(admin, ITEM, () => Promise.reject(new Error('jev: HTTP 402')));
  assertEquals(set, 0);
  assertEquals(calls.filter((c) => c.verb === 'update' || c.verb === 'upsert').length, 0);
});
```

- [x] **Step 6: Run it to verify it fails**

Run: `npx -y deno test --allow-env supabase/functions/_shared/sync.test.ts`
Expected: FAIL. `sync.ts` has no exported member `jevEnabled`, and it still imports `askClaude`, which `ai.ts` no longer exports.

- [x] **Step 7: Update `sync.ts`**

Replace the `./ai.ts` import block (lines 5–17) with:

```ts
import {
  AI_MAX_PER_SYNC,
  type AiAnswer,
  type AiCategory,
  type AiLevel,
  type AiRow,
  type AiVerdict,
  aiAllowed,
  applyAnswers,
  type AskFn,
  buildAskList,
  cacheKeyFor,
  groupUpdates,
  jevCategorizer,
} from './ai.ts';
```

and add, directly below the `./crowd.ts` import:

```ts
import { hasJevKey } from './jev.ts';
```

Replace the whole `runAiPass` function, doc comment included (lines 212–307), with:

```ts
/**
 * Whether Jev may decide anything for this Item (12d). It needs a key, the
 * subscriber seam, and the connector's own switch: one switch covers every
 * surface, off by default. Checked once per sync. Never throws: unsure means no.
 */
export async function jevEnabled(
  admin: SupabaseClient,
  item: { user_id: string; herd_id: string },
): Promise<boolean> {
  try {
    if (!hasJevKey() || !aiAllowed(item.herd_id)) return false;
    const { data, error } = await admin
      .from('profiles').select('ai_categorize').eq('user_id', item.user_id).maybeSingle();
    if (error) return false;
    return data?.ai_categorize === true;
  } catch {
    return false;
  }
}

/**
 * The AI fallback (12b; answered by Jev since 12d), run after the upsert over
 * the rows every other source was unsure about. The caller has already checked
 * jevEnabled. Never throws: a missed category is not worth failing a sync
 * over, and the next sync retries. `ask` is injected for tests.
 */
export async function runAiPass(
  admin: SupabaseClient,
  item: { id: string; user_id: string; herd_id: string },
  ask: AskFn = jevCategorizer(),
): Promise<number> {
  try {
    // Only this Item's rows, and only the ones nothing else could settle.
    const { data: rowData, error: rowError } = await admin
      .from('transactions')
      .select('id, merchant_key, name, merchant_name, amount, pfc_primary, pfc_detailed, accounts!inner(is_private)')
      .eq('item_id', item.id)
      .eq('category_is_manual', false)
      .in('category_source', ['plaid', 'fallback'])
      .or('pfc_confidence.is.null,pfc_confidence.in.(LOW,UNKNOWN)');
    if (rowError) throw rowError;
    const rows: AiRow[] = (rowData ?? []).map((r) => ({
      id: r.id,
      merchant_key: r.merchant_key ?? '',
      name: r.name,
      merchant_name: r.merchant_name,
      amount: Number(r.amount),
      pfc_primary: r.pfc_primary,
      pfc_detailed: r.pfc_detailed,
      is_private: (r.accounts as unknown as { is_private: boolean }).is_private,
    }));
    if (rows.length === 0) return 0;

    const keys = [...new Set(rows.map(cacheKeyFor))];
    const { data: cacheRows } = await admin
      .from('ai_category_cache').select('cache_key, category_id, confidence, level').in('cache_key', keys);
    const cached = new Map<string, AiVerdict | null>(
      (cacheRows ?? []).map((c) => [
        c.cache_key as string,
        c.category_id
          ? {
            category_id: c.category_id as string,
            confidence: c.confidence === null || c.confidence === undefined ? null : Number(c.confidence),
            level: (c.level as AiLevel | null) ?? null,
          }
          : null,
      ]),
    );

    // Every built-in, groups included: since 12d a sure group is an answer too.
    const { data: categoryRows } = await admin
      .from('categories').select('id, slug, name, parent_id').is('herd_id', null);
    const slugById = new Map((categoryRows ?? []).map((c) => [c.id as string, c.slug as string | null]));
    const categories: AiCategory[] = (categoryRows ?? []).flatMap((c) => {
      if (!c.slug) return [];
      const base = { id: c.id as string, slug: c.slug as string, name: c.name as string };
      if (c.parent_id === null) return [{ ...base, parent_slug: null }];
      const parent = slugById.get(c.parent_id as string);
      // A child whose group has no slug cannot be placed in the fan-out.
      return parent ? [{ ...base, parent_slug: parent }] : [];
    });

    const { ask: toAsk, resolved } = buildAskList(rows, cached);
    const sent = toAsk.slice(0, AI_MAX_PER_SYNC);
    let answers: AiAnswer[] = [];
    if (sent.length > 0) answers = await ask(sent, categories);
    // Only the keys Jev actually answered, with a category or an explicit
    // decline. A key whose call failed is neither written nor remembered, so
    // the next sync asks again.
    const sentKeys = new Set(sent.map(cacheKeyFor));
    const answered = [...new Set(answers.map((a) => a.key))].filter((k) => sentKeys.has(k));
    const { updates, cacheable, unanswered } = applyAnswers(rows, answers, categories, answered);

    // Cache hits update rows too, and cost nothing.
    for (const [id, verdict] of resolved) updates.push({ id, ...verdict });

    // Grouped and chunked: a warm cache can answer hundreds of rows at once, and
    // one statement per row would add seconds to every sync.
    for (const group of groupUpdates(updates)) {
      const { error } = await admin
        .from('transactions')
        .update({
          category_id: group.verdict.category_id,
          category_source: 'ai',
          ai_confidence: group.verdict.confidence,
          ai_level: group.verdict.level,
        })
        .in('id', group.ids)
        // Re-checked at write time: a row set by hand meanwhile stays put.
        .eq('category_is_manual', false);
      if (error) throw error;
    }
    const entries = [
      ...cacheable.map((c) => ({
        cache_key: c.key,
        category_id: c.category_id as string | null,
        confidence: c.confidence,
        level: c.level,
      })),
      // Asked and declined: remembered so no later sync pays to ask again.
      ...unanswered.map((key) => ({ cache_key: key, category_id: null, confidence: null, level: null })),
    ];
    if (entries.length > 0) {
      await admin.from('ai_category_cache').upsert(entries, { onConflict: 'cache_key' });
    }
    return updates.length;
  } catch (err) {
    console.warn(`ai pass skipped for item ${item.id}: ${describeError(err)}`);
    return 0;
  }
}
```

In `syncItem`, replace the 12b call (the comment block starting `// 12b, over what nothing else could settle.` and its two lines of code) with:

```ts
    // 12b/12d: Jev's decisions. After the cursor and after `result` is latched,
    // for the same two reasons the snapshot below is: it calls a third party,
    // and a slow or dead vendor must not cost a full re-pagination next sync or
    // turn a good sync into an error. The gate is read once. Never throws.
    const jevOn = await jevEnabled(admin, item);
    if (jevOn) {
      const aiSet = await runAiPass(admin, item);
      if (aiSet > 0) console.log(`item ${item.id}: AI categorized ${aiSet}`);
    }
```

- [x] **Step 8: Run the Edge suite**

Run: `npx -y deno test --allow-env supabase/functions/_shared/`
Expected: `0 failed`.

- [x] **Step 9: Confirm Haiku is gone from the Edge code**

Run: `grep -rn "askClaude\|hasAnthropicKey\|ANTHROPIC_API_KEY\|anthropic-ai\|AI_CLIENT" supabase/functions/`
Expected: no output.

- [x] **Step 10: Commit**

```bash
git add supabase/functions/_shared/ai.ts supabase/functions/_shared/ai.test.ts supabase/functions/_shared/sync.ts supabase/functions/_shared/sync.test.ts
git commit -F - <<'EOF'
feat(sync): Jev answers the AI fallback, one fan-out per merchant (Phase 12d)

A group Choice and every group's child Choice in one request. The child
is written when the group and the child both clear 0.9, the group alone
when only it does; otherwise the merchant is declined and remembered. A
failed call is never remembered as a decline. Confidence and level land
on the row and in the cache. Haiku's categorization path is removed, and
the gate is checked once per sync.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 4: Triage: review priority and the split hint

**Files:**
- Create: `supabase/functions/_shared/triage.ts`
- Test: `supabase/functions/_shared/triage.test.ts`
- Modify: `supabase/functions/_shared/sync.ts` (imports; add `runTriagePass` after `runAiPass`; call it inside `if (jevOn)`)
- Modify: `supabase/functions/_shared/sync.test.ts` (fake builder methods; imports; new tests at the end)

**Interfaces:**
- Consumes (Task 2): `askJev`, `JEV_CONCURRENCY`, `JEV_PASS_BUDGET_MS`, `type JevAsk`, `type JevQuestion`, `type JevResponse`, `mapLimit`, `readNoul`, `readScore`. From Task 3: `jevOn` in `syncItem`.
- Produces: `TRIAGE_PER_SYNC = 50`, `SPLIT_SUGGEST_AT = 0.7`, `PRIORITY_LEVELS: string[]` (3 entries), `type TriageRow`, `type Triage = { id: string; review_priority: number; split_suggested: boolean | null }`, `asksSplit(row, shared)`, `triageState(row, herdSize)`, `triageQuestions(row, shared)`, `readTriage(row, response, shared): Triage | null`, `groupTriage(results)`. In `sync.ts`: `runTriagePass(admin, item, ask?: JevAsk): Promise<number>`. The app (Task 6) reads `review_priority` 0–2 and `split_suggested`.

- [x] **Step 1: Write the failing `triage.test.ts`**

```ts
import { assertEquals } from 'jsr:@std/assert';

import type { JevResponse } from './jev.ts';
import {
  asksSplit,
  groupTriage,
  PRIORITY_LEVELS,
  readTriage,
  SPLIT_SUGGEST_AT,
  triageQuestions,
  type TriageRow,
  triageState,
} from './triage.ts';

const row = (over: Partial<TriageRow> = {}): TriageRow => ({
  id: 'r1',
  name: 'TRADER JOES 552',
  merchant_name: "Trader Joe's",
  amount: -84.1,
  category_name: 'Groceries',
  category_source: 'plaid',
  is_private: false,
  split: null,
  ...over,
});

const score = (s: number) => ({ type: 'score', score: s, confidence: 0.8, probabilities: {} });
const noul = (n: number) => ({ type: 'noul', noul: n });
const reply = (answers: Record<string, unknown>): JevResponse => ({ model: 'jev-1.13.0', answers });

Deno.test('three levels, and they read as a scale from routine to wrong', () => {
  assertEquals(PRIORITY_LEVELS.length, 3);
  assertEquals(PRIORITY_LEVELS[0].startsWith('Routine'), true);
  assertEquals(PRIORITY_LEVELS[2].startsWith('Likely needs a fix'), true);
});

Deno.test('asksSplit: only money out, on a shared account, in a shared herd, not already split', () => {
  assertEquals(asksSplit(row(), true), true);
  assertEquals(asksSplit(row(), false), false); // a herd of one has nobody to split with
  assertEquals(asksSplit(row({ is_private: true }), true), false); // private rows never count toward settle-up
  assertEquals(asksSplit(row({ amount: 2500 }), true), false); // income is not an expense
  assertEquals(asksSplit(row({ split: { a: 50, b: 50 } }), true), false); // the user already decided
});

Deno.test('a solo herd is never asked about splitting', () => {
  assertEquals(Object.keys(triageQuestions(row(), false)), ['review_priority']);
  assertEquals(Object.keys(triageQuestions(row(), true)).sort(), ['is_shared_expense', 'review_priority']);
});

Deno.test('the priority question is a three-level Score', () => {
  const q = triageQuestions(row(), false).review_priority;
  assertEquals(q.type, 'score');
  assertEquals((q as { criteria: string[] }).criteria, PRIORITY_LEVELS);
});

Deno.test('the state is the row and the herd size: no ids, balances or names of people', () => {
  assertEquals(triageState(row(), 2), {
    merchant: "Trader Joe's",
    description: 'TRADER JOES 552',
    amount: '84.10',
    direction: 'money out',
    category: 'Groceries',
    category_set_by: 'plaid',
    household_size: 2,
  });
  assertEquals(triageState(row({ category_name: null }), 1).category, 'Uncategorized');
});

Deno.test('the Score position rounds to its nearest level and stays on the scale', () => {
  const at = (s: number) => readTriage(row(), reply({ review_priority: score(s) }), false)?.review_priority;
  assertEquals(at(0.2), 0);
  assertEquals(at(1.43), 1);
  assertEquals(at(1.6), 2);
  assertEquals(at(2), 2);
  assertEquals(at(-0.4), 0);
  assertEquals(at(2.7), 2);
});

Deno.test('an unreadable priority leaves the whole row for the next sync', () => {
  assertEquals(readTriage(row(), reply({ is_shared_expense: noul(0.9) }), true), null);
});

Deno.test('the split hint needs a Noul at or over the bar', () => {
  const split = (n: number) =>
    readTriage(row(), reply({ review_priority: score(0), is_shared_expense: noul(n) }), true)?.split_suggested;
  assertEquals(split(SPLIT_SUGGEST_AT), true);
  assertEquals(split(0.95), true);
  assertEquals(split(0.69), false);
});

Deno.test('no split question means no split hint, not a "no"', () => {
  assertEquals(readTriage(row(), reply({ review_priority: score(0) }), false), {
    id: 'r1',
    review_priority: 0,
    split_suggested: null,
  });
  // Asked, but the answer was unreadable: still no hint either way.
  assertEquals(
    readTriage(row(), reply({ review_priority: score(0), is_shared_expense: { type: 'noul' } }), true)
      ?.split_suggested,
    null,
  );
});

Deno.test('results are grouped by what they write', () => {
  assertEquals(
    groupTriage([
      { id: 'a', review_priority: 2, split_suggested: true },
      { id: 'b', review_priority: 0, split_suggested: null },
      { id: 'c', review_priority: 2, split_suggested: true },
    ]),
    [
      { review_priority: 2, split_suggested: true, ids: ['a', 'c'] },
      { review_priority: 0, split_suggested: null, ids: ['b'] },
    ],
  );
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx -y deno test --allow-env supabase/functions/_shared/triage.test.ts`
Expected: FAIL. The module `./triage.ts` cannot be found.

- [x] **Step 3: Write `triage.ts`**

```ts
/**
 * Per-row triage (Phase 12d): how likely it is that a new row needs the user's
 * attention in the review deck, and, in a shared herd, whether it looks like a
 * shared household expense. One Jev request per row carries both. Pure except
 * the JevAsk that runTriagePass (sync.ts) is given.
 *
 * Per row and per herd, so nothing here is cached. Unlike a category, "worth a
 * second look" and "shared" depend on this household.
 */
import { type JevQuestion, type JevResponse, readNoul, readScore } from './jev.ts';

/** New rows judged per sync, newest first. The rest wait for the next sync. */
export const TRIAGE_PER_SYNC = 50;
/**
 * The Noul at which a split is suggested. Above 0.5 on purpose: a wrong hint
 * costs only attention, and sparing attention is the point of the feature.
 */
export const SPLIT_SUGGEST_AT = 0.7;
/** review_priority's levels, 0..2. The app puts 2 first and marks it. */
export const PRIORITY_LEVELS = [
  'Routine: an ordinary purchase whose category clearly fits the merchant',
  'Worth a glance: an unfamiliar merchant, an unusual amount, or a category that may not fit',
  'Likely needs a fix: the category looks wrong for this merchant, or the charge looks like a duplicate, a refund or a mistake',
];

export type TriageRow = {
  id: string;
  name: string;
  merchant_name: string | null;
  /** Signed: positive is money in. */
  amount: number;
  category_name: string | null;
  category_source: string;
  is_private: boolean;
  split: Record<string, number> | null;
};

export type Triage = { id: string; review_priority: number; split_suggested: boolean | null };

/**
 * Whether to ask about sharing at all. It needs a shared herd, a shared account
 * (private rows never count toward settle-up), money out, and no split chosen yet.
 */
export function asksSplit(row: TriageRow, shared: boolean): boolean {
  return shared && !row.is_private && row.amount < 0 && row.split === null;
}

/** What Jev sees about one row: the row itself and the household's size, nothing that names anyone. */
export function triageState(row: TriageRow, herdSize: number) {
  return {
    merchant: row.merchant_name ?? '(unknown)',
    description: row.name,
    amount: Math.abs(row.amount).toFixed(2),
    direction: row.amount > 0 ? 'money in' : 'money out',
    category: row.category_name ?? 'Uncategorized',
    category_set_by: row.category_source,
    household_size: herdSize,
  };
}

/**
 * The questions for one row. The split Noul is added only when it can matter
 * (speculative fan-out), so a solo herd never pays for it.
 */
export function triageQuestions(row: TriageRow, shared: boolean): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {
    review_priority: {
      type: 'score',
      instructions: 'How likely is it that the user needs to check or fix this bank transaction?',
      criteria: PRIORITY_LEVELS,
    },
  };
  if (asksSplit(row, shared)) {
    questions.is_shared_expense = {
      type: 'noul',
      instructions: 'Is this a shared household expense that the members of the household would split?',
      criteria: {
        true: 'Rent, utilities, groceries, household supplies, a shared subscription, or a meal or trip together',
        false: "One person's own purchase or subscription, a transfer, income, or anything only one person uses",
      },
    };
  }
  return questions;
}

/**
 * Read one row's answers. Null when the priority is unreadable, so the row is
 * left whole for the next sync rather than half-judged. The Score's position
 * is rounded to its nearest level.
 */
export function readTriage(row: TriageRow, response: JevResponse, shared: boolean): Triage | null {
  const priority = readScore(response.answers.review_priority);
  if (!priority) return null;
  const top = PRIORITY_LEVELS.length - 1;
  const review_priority = Math.min(top, Math.max(0, Math.round(priority.score)));

  let split_suggested: boolean | null = null;
  if (asksSplit(row, shared)) {
    const yes = readNoul(response.answers.is_shared_expense);
    split_suggested = yes === null ? null : yes >= SPLIT_SUGGEST_AT;
  }
  return { id: row.id, review_priority, split_suggested };
}

/** Group results by what they write: at most six statements a sync, not one per row. */
export function groupTriage(
  results: Triage[],
): { review_priority: number; split_suggested: boolean | null; ids: string[] }[] {
  const groups = new Map<string, { review_priority: number; split_suggested: boolean | null; ids: string[] }>();
  for (const r of results) {
    const key = `${r.review_priority}|${r.split_suggested}`;
    const group = groups.get(key) ??
      { review_priority: r.review_priority, split_suggested: r.split_suggested, ids: [] };
    group.ids.push(r.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}
```

- [x] **Step 4: Run `triage.test.ts` to verify it passes**

Run: `npx -y deno test --allow-env supabase/functions/_shared/triage.test.ts`
Expected: PASS, all 10 tests.

- [x] **Step 5: Write the failing `runTriagePass` tests**

In `sync.test.ts`:

(a) In `fakeAdmin`, replace the filter-name list `['eq', 'in', 'is', 'not', 'or', 'neq', 'gt', 'lt']` with:

```ts
    for (const filter of ['eq', 'in', 'is', 'not', 'or', 'neq', 'gt', 'lt', 'gte', 'order', 'limit', 'range']) {
```

(b) Replace the sync import line with:

```ts
import { jevEnabled, loadCommunity, runAiPass, runTriagePass } from './sync.ts';
```

and add below the `./ai.ts` type import:

```ts
import type { JevAsk, JevResponse } from './jev.ts';
```

(c) Append at the end of the file:

```ts
// --- Triage (12d) ------------------------------------------------------------

const triRow = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'r1',
  name: 'TRADER JOES 552',
  merchant_name: "Trader Joe's",
  amount: -84.1,
  category_id: 'c-groceries',
  category_source: 'plaid',
  split: null,
  accounts: { is_private: false },
  ...over,
});

/** The reads runTriagePass makes, in order. */
function triagePlan(rows: unknown[], members: string[] = ['user-1']): Record<string, Resp[]> {
  return {
    'transactions:select': [{ data: rows }],
    'herd_members:select': [{ data: members.map((user_id) => ({ user_id })) }],
    'categories:select': [{ data: [{ id: 'c-groceries', name: 'Groceries' }] }],
  };
}

const judged = (answers: Record<string, unknown>): JevResponse => ({ model: 'jev-1.13.0', answers });
const fixAndShare: JevAsk = () =>
  Promise.resolve(judged({
    review_priority: { type: 'score', score: 1.8, confidence: 0.7, probabilities: {} },
    is_shared_expense: { type: 'noul', noul: 0.9 },
  }));

Deno.test('runTriagePass: reads only unreviewed, unjudged posted rows, newest first, 50 at a time', async () => {
  const { admin, of } = fakeAdmin(triagePlan([triRow()]));
  await runTriagePass(admin, ITEM, fixAndShare);
  assertEquals(of('transactions', 'select')[0].filters, [
    ['eq', 'item_id', 'item-1'],
    ['eq', 'pending', false],
    ['is', 'reviewed_at', null],
    ['is', 'review_priority', null],
    ['order', 'date', { ascending: false }],
    ['limit', 50],
  ]);
});

Deno.test('runTriagePass: writes grouped, and never over a row reviewed meanwhile', async () => {
  const { admin, of } = fakeAdmin(triagePlan([triRow({ id: 'r1' }), triRow({ id: 'r2' })], ['user-1', 'user-2']));
  const written = await runTriagePass(admin, ITEM, fixAndShare);

  assertEquals(written, 2);
  const writes = of('transactions', 'update');
  assertEquals(writes.length, 1);
  assertEquals(writes[0].payload, { review_priority: 2, split_suggested: true });
  assertEquals(writes[0].filters, [['in', 'id', ['r1', 'r2']], ['is', 'reviewed_at', null]]);
});

Deno.test('runTriagePass: in a herd of one, only the priority is asked', async () => {
  const { admin, of } = fakeAdmin(triagePlan([triRow()]));
  const asked: string[][] = [];
  await runTriagePass(admin, ITEM, (_state, questions) => {
    asked.push(Object.keys(questions));
    return fixAndShare({}, {});
  });
  assertEquals(asked, [['review_priority']]);
  assertEquals(of('transactions', 'update')[0].payload, { review_priority: 2, split_suggested: null });
});

Deno.test('runTriagePass: a row whose call failed stays unjudged for the next sync', async () => {
  const { admin, of } = fakeAdmin(triagePlan([triRow({ id: 'r1' }), triRow({ id: 'r2', name: 'OTHER' })]));
  const written = await runTriagePass(admin, ITEM, (state, questions) =>
    (state as { description: string }).description === 'OTHER'
      ? Promise.reject(new Error('jev: HTTP 503'))
      : fixAndShare(state, questions));
  assertEquals(written, 1);
  assertEquals(of('transactions', 'update')[0].filters[0], ['in', 'id', ['r1']]);
});

Deno.test('runTriagePass: a vendor that fails costs the sync nothing', async () => {
  const { admin, calls } = fakeAdmin(triagePlan([triRow()]));
  assertEquals(await runTriagePass(admin, ITEM, () => Promise.reject(new Error('jev: HTTP 402'))), 0);
  assertEquals(calls.filter((c) => c.verb === 'update').length, 0);
});

Deno.test('runTriagePass: nothing to judge reads no herd and asks nothing', async () => {
  const { admin, of } = fakeAdmin(triagePlan([]));
  let asked = false;
  const written = await runTriagePass(admin, ITEM, () => {
    asked = true;
    return fixAndShare({}, {});
  });
  assertEquals(written, 0);
  assertEquals(asked, false);
  assertEquals(of('herd_members', 'select').length, 0);
});
```

- [x] **Step 6: Run it to verify it fails**

Run: `npx -y deno test --allow-env supabase/functions/_shared/sync.test.ts`
Expected: FAIL. `sync.ts` has no exported member `runTriagePass`.

- [x] **Step 7: Add `runTriagePass` and wire it in**

In `sync.ts`, replace `import { hasJevKey } from './jev.ts';` with:

```ts
import { askJev, hasJevKey, JEV_CONCURRENCY, JEV_PASS_BUDGET_MS, type JevAsk, mapLimit } from './jev.ts';
```

Add, directly below the `./review.ts` import:

```ts
import { groupTriage, readTriage, TRIAGE_PER_SYNC, triageQuestions, type TriageRow, triageState } from './triage.ts';
```

Add directly after the `runAiPass` function:

```ts
/**
 * Triage (12d): a review priority for each unreviewed posted row and, in a
 * shared herd, a split hint. Runs after runAiPass so it sees the final
 * categories. Only rows no triage has reached, newest first, TRIAGE_PER_SYNC
 * at a time. A row whose call failed stays unjudged and is retried next sync.
 * The caller has already checked jevEnabled. Never throws.
 */
export async function runTriagePass(
  admin: SupabaseClient,
  item: { id: string; user_id: string; herd_id: string },
  ask: JevAsk = askJev,
): Promise<number> {
  try {
    const { data: rowData, error: rowError } = await admin
      .from('transactions')
      .select('id, name, merchant_name, amount, category_id, category_source, split, accounts!inner(is_private)')
      .eq('item_id', item.id)
      .eq('pending', false)
      .is('reviewed_at', null)
      .is('review_priority', null)
      .order('date', { ascending: false })
      .limit(TRIAGE_PER_SYNC);
    if (rowError) throw rowError;
    if (!rowData || rowData.length === 0) return 0;

    const { data: memberRows, error: memberError } = await admin
      .from('herd_members').select('user_id').eq('herd_id', item.herd_id);
    if (memberError) throw memberError;
    const herdSize = (memberRows ?? []).length;
    // isShared's rule (apps/mobile/src/lib/herd.ts): a herd of one has nobody to share with.
    const shared = herdSize > 1;

    const categoryIds = [...new Set(rowData.map((r) => r.category_id as string | null).filter(Boolean))];
    let nameOf = new Map<string, string>();
    if (categoryIds.length > 0) {
      const { data: categoryRows, error: categoryError } = await admin
        .from('categories').select('id, name').in('id', categoryIds);
      if (categoryError) throw categoryError;
      nameOf = new Map((categoryRows ?? []).map((c) => [c.id as string, c.name as string]));
    }

    const rows: TriageRow[] = rowData.map((r) => ({
      id: r.id,
      name: r.name,
      merchant_name: r.merchant_name,
      amount: Number(r.amount),
      category_name: r.category_id ? nameOf.get(r.category_id) ?? null : null,
      category_source: r.category_source,
      is_private: (r.accounts as unknown as { is_private: boolean }).is_private,
      split: r.split,
    }));

    const deadline = Date.now() + JEV_PASS_BUDGET_MS;
    const settled = await mapLimit(rows, JEV_CONCURRENCY, async (row) =>
      readTriage(row, await ask(triageState(row, herdSize), triageQuestions(row, shared), { deadline }), shared), deadline);
    const results = settled.flatMap((s) => (s.status === 'fulfilled' && s.value ? [s.value] : []));
    if (results.length === 0) {
      const failed = settled.find((s) => s.status === 'rejected') as PromiseRejectedResult | undefined;
      if (failed) throw failed.reason;
      return 0;
    }

    let written = 0;
    for (const group of groupTriage(results)) {
      const { error } = await admin
        .from('transactions')
        .update({ review_priority: group.review_priority, split_suggested: group.split_suggested })
        .in('id', group.ids)
        // Re-checked at write time: a row reviewed meanwhile needs no priority.
        .is('reviewed_at', null);
      if (error) throw error;
      written += group.ids.length;
    }
    return written;
  } catch (err) {
    console.warn(`triage pass skipped for item ${item.id}: ${describeError(err)}`);
    return 0;
  }
}
```

In `syncItem`, extend the `if (jevOn)` block from Task 3 so it reads:

```ts
    if (jevOn) {
      const aiSet = await runAiPass(admin, item);
      if (aiSet > 0) console.log(`item ${item.id}: AI categorized ${aiSet}`);
      // After the categories settle, so triage judges the final ones.
      const triaged = await runTriagePass(admin, item);
      if (triaged > 0) console.log(`item ${item.id}: triaged ${triaged}`);
    }
```

- [x] **Step 8: Run the Edge suite**

Run: `npx -y deno test --allow-env supabase/functions/_shared/`
Expected: `0 failed`.

- [x] **Step 9: Commit**

```bash
git add supabase/functions/_shared/triage.ts supabase/functions/_shared/triage.test.ts supabase/functions/_shared/sync.ts supabase/functions/_shared/sync.test.ts
git commit -F - <<'EOF'
feat(sync): Jev triages new rows for review and spots shared costs (Phase 12d)

One request per unreviewed row: a three-level review priority, plus, in
shared herds only, whether it looks like a shared expense. A hint, never
a split, so no balance can move. Rows are grouped into a handful of
writes and never written over a row reviewed meanwhile.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 5: Recurring tiebreak

**Files:**
- Modify: `supabase/functions/_shared/recurring.ts` (`detectGroup` lines 152–211; `streamKey` lines 213–214; `detectStreams` lines 225–266; `refreshRecurring` lines 286–348; imports)
- Modify: `supabase/functions/_shared/recurring.test.ts` (imports line 3; new tests at the end)
- Modify: `supabase/functions/_shared/sync.ts` (imports; the recurring block in `syncItem`)

**Interfaces:**
- Consumes (Task 2): `JEV_CONCURRENCY`, `JEV_PASS_BUDGET_MS`, `type JevAsk`, `type JevQuestion`, `mapLimit`, `readNoul`. From Task 3: `jevOn` in `syncItem`.
- Produces: `NEAR_MISS_FACTOR = 2`, `RECURRING_ASK_MAX = 20`, `RECURRING_YES_AT = 0.5`, `export streamKey`, `detectCandidates(rows, opts): { streams: StreamRow[]; nearMisses: StreamRow[] }`, `type RecurringDecide = (candidates: StreamRow[]) => Promise<Map<string, boolean>>`, `settleNearMisses(sure, nearMisses, decide?)`, `recurringQuestions()`, `recurringState(stream, categoryName)`, `jevRecurringDecide(ask, categoryNames)`, and `refreshRecurring(admin, item, transferCategoryIds, decide?)`. `detectStreams` keeps its signature and behaviour.

- [x] **Step 1: Write the failing tests**

Replace line 3 of `recurring.test.ts` with:

```ts
import type { JevAsk } from './jev.ts';
import {
  type DetectInput,
  detectCandidates,
  detectStreams,
  ignoredCategoryIds,
  jevRecurringDecide,
  normalizeMerchant,
  RECURRING_ASK_MAX,
  recurringState,
  settleNearMisses,
  staleStreamIds,
  streamKey,
} from './recurring.ts';
```

Append to the end of `recurring.test.ts`:

```ts
// --- 12d: near misses and Jev's tiebreak ---------------------------------------

const pay = (date: string, amount: number, account_id = 'acc-1'): DetectInput => ({
  account_id,
  date,
  amount,
  name: 'CITY POWER',
  merchant_name: 'City Power',
  category_id: 'c-utilities',
});
const DATES = ['2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];
// Median 55; 80 strays 25, past monthly's 35% (19.25) but within twice it (38.5).
const VARIABLE = [-50, -80, -45, -60].map((a, i) => pay(DATES[i], a));
// 200 strays 145: past twice the tolerance too.
const WILD = [-50, -200, -45, -60].map((a, i) => pay(DATES[i], a));
const STEADY = DATES.map((d) => pay(d, -15.99));
const OPTS = { transferCategoryIds: [] };

Deno.test('a regular bill whose amount swings past the tolerance is a near miss, not a stream', () => {
  const { streams, nearMisses } = detectCandidates(VARIABLE, OPTS);
  assertEquals(streams, []);
  assertEquals(nearMisses.length, 1);
  assertEquals(nearMisses[0].merchant_key, 'city power');
  // What was stored before 12d is unchanged.
  assertEquals(detectStreams(VARIABLE, OPTS), []);
});

Deno.test('a swing past twice the tolerance is neither', () => {
  assertEquals(detectCandidates(WILD, OPTS), { streams: [], nearMisses: [] });
});

Deno.test('a steady subscription is sure, never a near miss', () => {
  const { streams, nearMisses } = detectCandidates(STEADY, OPTS);
  assertEquals(streams.length, 1);
  assertEquals(nearMisses, []);
  assertEquals(detectStreams(STEADY, OPTS), streams);
});

Deno.test('without Jev, near misses are dropped exactly as before 12d', async () => {
  const { streams, nearMisses } = detectCandidates([...STEADY.map((p) => ({ ...p, account_id: 'acc-2' })), ...VARIABLE], OPTS);
  assertEquals(await settleNearMisses(streams, nearMisses), { streams, keep: [] });
});

Deno.test('a near miss Jev calls recurring joins the streams', async () => {
  const { nearMisses } = detectCandidates(VARIABLE, OPTS);
  const out = await settleNearMisses([], nearMisses, (c) => Promise.resolve(new Map([[streamKey(c[0]), true]])));
  assertEquals(out, { streams: nearMisses, keep: [] });
});

Deno.test('a near miss Jev rejects is left out, and may be deleted', async () => {
  const { nearMisses } = detectCandidates(VARIABLE, OPTS);
  const out = await settleNearMisses([], nearMisses, (c) => Promise.resolve(new Map([[streamKey(c[0]), false]])));
  assertEquals(out, { streams: [], keep: [] });
});

Deno.test('a near miss Jev could not judge is kept, never deleted', async () => {
  const { nearMisses } = detectCandidates(VARIABLE, OPTS);
  // Tipped in on Monday, the call fails on Tuesday: the stream must survive Tuesday.
  assertEquals(await settleNearMisses([], nearMisses, () => Promise.reject(new Error('jev: HTTP 503'))), {
    streams: [],
    keep: nearMisses,
  });
  assertEquals(await settleNearMisses([], nearMisses, () => Promise.resolve(new Map())), {
    streams: [],
    keep: nearMisses,
  });
});

Deno.test('near misses past the cap are not asked about, and are kept', async () => {
  const many = Array.from({ length: RECURRING_ASK_MAX + 1 }, (_, i) =>
    VARIABLE.map((p) => ({ ...p, account_id: `acc-${String(i).padStart(2, '0')}` }))).flat();
  const { nearMisses } = detectCandidates(many, OPTS);
  let asked = 0;
  const out = await settleNearMisses([], nearMisses, (c) => {
    asked = c.length;
    return Promise.resolve(new Map(c.map((s) => [streamKey(s), true])));
  });
  assertEquals(asked, RECURRING_ASK_MAX);
  assertEquals(out.streams.length, RECURRING_ASK_MAX);
  assertEquals(out.keep.length, 1);
});

Deno.test('jevRecurringDecide: a yes at 0.5 or more tips it in, and a failed call has no verdict', async () => {
  const { nearMisses } = detectCandidates(
    [...VARIABLE, ...VARIABLE.map((p) => ({ ...p, account_id: 'acc-2' })), ...VARIABLE.map((p) => ({ ...p, account_id: 'acc-3' }))],
    OPTS,
  );
  const byAccount: Record<string, number | 'fail'> = { 'acc-1': 0.5, 'acc-2': 0.2, 'acc-3': 'fail' };
  let i = 0;
  const ask: JevAsk = () => {
    const answer = byAccount[nearMisses[i++].account_id];
    return answer === 'fail'
      ? Promise.reject(new Error('jev: HTTP 503'))
      : Promise.resolve({ model: 'jev-1.13.0', answers: { is_recurring: { type: 'noul', noul: answer } } });
  };
  const verdicts = await jevRecurringDecide(ask, new Map())(nearMisses);
  assertEquals(verdicts.get(streamKey(nearMisses[0])), true);
  assertEquals(verdicts.get(streamKey(nearMisses[1])), false);
  assertEquals(verdicts.has(streamKey(nearMisses[2])), false);
});

Deno.test('recurringState names the category and never an account', () => {
  const { nearMisses } = detectCandidates(VARIABLE, OPTS);
  const state = recurringState(nearMisses[0], 'Utilities');
  assertEquals(state.category, 'Utilities');
  assertEquals(state.cadence, 'monthly');
  assertEquals(state.occurrences, 4);
  assertEquals(JSON.stringify(state).includes('acc-1'), false);
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `npx -y deno test --allow-env supabase/functions/_shared/recurring.test.ts`
Expected: FAIL. `recurring.ts` has no exported member `detectCandidates`.

- [x] **Step 3: Update `recurring.ts`**

(a) Below `import type { SupabaseClient } …`, add:

```ts
import { JEV_CONCURRENCY, JEV_PASS_BUDGET_MS, type JevAsk, type JevQuestion, mapLimit, readNoul } from './jev.ts';
```

(b) Below `const PRICE_CHANGE_PCT = 0.05;`, add:

```ts
/**
 * How far past the amount tolerance a regular run may stray and still be
 * worth asking Jev about (12d). Twice the tolerance: a bill whose amount
 * varies, not a shop visited on a whim.
 */
export const NEAR_MISS_FACTOR = 2;
/** Near misses sent to Jev per Item per sync. The rest are kept, not asked. */
export const RECURRING_ASK_MAX = 20;
/** Jev's `is_recurring` at or above this tips a near miss in. */
export const RECURRING_YES_AT = 0.5;
```

(c) Replace the whole `detectGroup` function (its comment `/** One merchant's occurrences, oldest first → a stream, or null. */` through its closing brace) with:

```ts
/**
 * One merchant's occurrences, oldest first → a stream it is sure of, a near
 * miss, or null. A near miss (12d) has a regular cadence and enough payments,
 * but amounts that stray past the tolerance while staying within
 * NEAR_MISS_FACTOR times it. The heuristic cannot tell a variable bill from a
 * shop visited on a schedule, so Jev is asked instead.
 */
function classifyGroup(occ: Occurrence[]): { detected: Detected; sure: boolean } | null {
  const n = occ.length;
  if (n < MIN_OCCURRENCES) return null;

  // The newest interval picks the cadence; walk back while intervals fit it.
  const cadence = cadenceFor(occ[n - 1].day - occ[n - 2].day);
  if (!cadence) return null;
  const { minDays, maxDays, tolerance } = CADENCES[cadence];
  let start = n - 1;
  while (start > 0) {
    const gap = occ[start].day - occ[start - 1].day;
    if (gap < minDays || gap > maxDays) break;
    start--;
  }
  const run = occ.slice(start);

  // Drop leading amount outliers — a prorated first charge.
  while (
    run.length > MIN_OCCURRENCES &&
    !withinTolerance(run[0].amount, median(run.slice(1).map((o) => o.amount)), tolerance)
  ) {
    run.shift();
  }
  if (run.length < MIN_OCCURRENCES) return null;

  const amounts = run.map((o) => o.amount);
  const center = median(amounts);
  const within = (factor: number) => amounts.every((a) => withinTolerance(a, center, tolerance * factor));
  if (!within(NEAR_MISS_FACTOR)) return null;
  const sure = within(1);

  const last = run[run.length - 1];
  const previous = run[run.length - 2];

  // Flag only a FIXED price that moved, so variable utilities never flag.
  const earlier = amounts.slice(0, -1);
  const fixed = earlier.every((a) => Math.round(a * 100) === Math.round(earlier[0] * 100));
  const delta = round2(Math.abs(last.amount) - Math.abs(previous.amount));
  const moved = Math.abs(delta) >= Math.max(PRICE_CHANGE_MIN, PRICE_CHANGE_PCT * Math.abs(previous.amount));

  const next_date = cadence === 'monthly'
    ? nextMonthlyDate(last.date, anchorDay(run.map((o) => Number(o.date.slice(8, 10)))))
    : isoFromDay(last.day + (cadence === 'weekly' ? 7 : 14));

  return {
    sure,
    detected: {
      name: last.source.merchant_name ?? last.source.name,
      category_id: last.source.category_id,
      frequency: cadence,
      average_amount: round2(amounts.reduce((sum, a) => sum + a, 0) / amounts.length),
      last_amount: round2(last.amount),
      previous_amount: round2(previous.amount),
      amount_change: fixed && moved ? delta : null,
      first_date: run[0].date,
      last_date: last.date,
      next_date,
      occurrences: run.length,
    },
  };
}
```

(d) Replace `const streamKey = (s: …) =>` with the exported form:

```ts
/** A stream's identity, as the upsert's conflict target and Jev's verdicts see it. */
export const streamKey = (s: { account_id: string; direction: Direction; merchant_key: string }) =>
  `${s.account_id}|${s.direction}|${s.merchant_key}`;
```

(e) Replace the whole `detectStreams` function, doc comment included, with:

```ts
const byStreamKey = (a: StreamRow, b: StreamRow) =>
  streamKey(a) < streamKey(b) ? -1 : streamKey(a) > streamKey(b) ? 1 : 0;

/**
 * Posted transactions → the streams detection is sure of, and the near misses
 * Jev may tip in (12d). One per (account, direction, merchant). Transfer-kind
 * categories are excluded by OUR category_id, so a manual recategorization to
 * Transfer takes a stream out at the next sync.
 */
export function detectCandidates(
  rows: DetectInput[],
  opts: { transferCategoryIds: string[] },
): { streams: StreamRow[]; nearMisses: StreamRow[] } {
  const transfers = new Set(opts.transferCategoryIds);
  const groups = new Map<
    string,
    { account_id: string; merchant_key: string; direction: Direction; byDate: Map<string, Occurrence> }
  >();

  for (const r of rows) {
    if (r.amount === 0) continue;
    if (r.category_id && transfers.has(r.category_id)) continue;
    const merchant_key = normalizeMerchant(r.merchant_name ?? r.name);
    if (!merchant_key) continue;
    const direction: Direction = r.amount < 0 ? 'outflow' : 'inflow';
    const key = streamKey({ account_id: r.account_id, direction, merchant_key });

    let group = groups.get(key);
    if (!group) {
      group = { account_id: r.account_id, merchant_key, direction, byDate: new Map() };
      groups.set(key, group);
    }
    // Same-day charges at one merchant are one payment.
    const sameDay = group.byDate.get(r.date);
    if (sameDay) {
      sameDay.amount = round2(sameDay.amount + r.amount);
      sameDay.source = r;
    } else {
      group.byDate.set(r.date, { date: r.date, day: dayNumber(r.date), amount: r.amount, source: r });
    }
  }

  const streams: StreamRow[] = [];
  const nearMisses: StreamRow[] = [];
  for (const g of groups.values()) {
    const found = classifyGroup([...g.byDate.values()].sort((a, b) => a.day - b.day));
    if (!found) continue;
    const row = { account_id: g.account_id, merchant_key: g.merchant_key, direction: g.direction, ...found.detected };
    (found.sure ? streams : nearMisses).push(row);
  }
  return { streams: streams.sort(byStreamKey), nearMisses: nearMisses.sort(byStreamKey) };
}

/** The streams detection is sure of: what every sync stored before 12d, and still does with Jev off. */
export function detectStreams(rows: DetectInput[], opts: { transferCategoryIds: string[] }): StreamRow[] {
  return detectCandidates(rows, opts).streams;
}

/** Jev's verdict per streamKey. A missing key means "could not judge". */
export type RecurringDecide = (candidates: StreamRow[]) => Promise<Map<string, boolean>>;

/**
 * Fold Jev's verdicts on the near misses into the sure streams (12d). A near
 * miss Jev calls recurring joins them, and one it rejects is left out (and
 * deleted if it was stored). One it could not judge (cap reached, call failed)
 * is returned in `keep`: neither added nor deleted, so a flaky call never makes
 * a stream flicker. Without `decide` (Jev off) the heuristic alone stands,
 * exactly as before 12d.
 */
export async function settleNearMisses(
  sure: StreamRow[],
  nearMisses: StreamRow[],
  decide?: RecurringDecide,
): Promise<{ streams: StreamRow[]; keep: StreamRow[] }> {
  if (!decide || nearMisses.length === 0) return { streams: sure, keep: [] };
  let verdicts = new Map<string, boolean>();
  try {
    verdicts = await decide(nearMisses.slice(0, RECURRING_ASK_MAX));
  } catch (err) {
    console.warn(`recurring tiebreak skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {
    streams: [...sure, ...nearMisses.filter((s) => verdicts.get(streamKey(s)) === true)],
    keep: nearMisses.filter((s) => !verdicts.has(streamKey(s))),
  };
}

/** The one question per near miss. */
export function recurringQuestions(): Record<string, JevQuestion> {
  return {
    is_recurring: {
      type: 'noul',
      instructions:
        'Are these transactions a recurring bill or subscription, rather than repeat purchases that happen to be regular?',
      criteria: {
        true: 'A bill, subscription, membership, rent, loan or insurance payment, or a regular paycheck',
        false: 'Everyday purchases at a shop or restaurant the user happens to visit often',
      },
    },
  };
}

/** What Jev sees about one near miss: the pattern, never the account. */
export function recurringState(s: StreamRow, categoryName: string | null) {
  return {
    merchant: s.name,
    cadence: s.frequency,
    occurrences: s.occurrences,
    amounts: {
      average: Math.abs(s.average_amount),
      previous: Math.abs(s.previous_amount),
      last: Math.abs(s.last_amount),
    },
    direction: s.direction === 'inflow' ? 'money in' : 'money out',
    category: categoryName ?? 'Uncategorized',
    first_date: s.first_date,
    last_date: s.last_date,
  };
}

/**
 * The RecurringDecide that sync uses: one Noul per near miss, bounded like
 * every Jev pass. A call that fails or answers unreadably has no verdict, so
 * settleNearMisses keeps that stream as it was.
 */
export function jevRecurringDecide(ask: JevAsk, categoryNames: Map<string, string>): RecurringDecide {
  return async (candidates) => {
    const deadline = Date.now() + JEV_PASS_BUDGET_MS;
    const questions = recurringQuestions();
    const settled = await mapLimit(candidates, JEV_CONCURRENCY, async (s) => {
      const name = s.category_id ? categoryNames.get(s.category_id) ?? null : null;
      const yes = readNoul((await ask(recurringState(s, name), questions, { deadline })).answers.is_recurring);
      if (yes === null) throw new Error('jev: unreadable is_recurring');
      return yes >= RECURRING_YES_AT;
    }, deadline);
    const verdicts = new Map<string, boolean>();
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') verdicts.set(streamKey(candidates[i]), s.value);
    });
    return verdicts;
  };
}
```

(f) In `refreshRecurring`: change the signature to take the optional decider, and fold the near misses in. Replace:

```ts
export async function refreshRecurring(
  admin: SupabaseClient,
  item: { id: string; user_id: string },
  transferCategoryIds: string[],
): Promise<void> {
```

with:

```ts
export async function refreshRecurring(
  admin: SupabaseClient,
  item: { id: string; user_id: string },
  transferCategoryIds: string[],
  /** Jev's tiebreak for near misses (12d); absent when Jev is off. */
  decide?: RecurringDecide,
): Promise<void> {
```

Replace `const streams = detectStreams(rows, { transferCategoryIds });` with:

```ts
  const { streams: sure, nearMisses } = detectCandidates(rows, { transferCategoryIds });
  const { streams, keep } = await settleNearMisses(sure, nearMisses, decide);
```

Replace `const stale = staleStreamIds(existing ?? [], streams);` with:

```ts
  // A near miss Jev could not judge this time is neither refreshed nor deleted.
  const stale = staleStreamIds(existing ?? [], [...streams, ...keep]);
```

- [x] **Step 4: Run the recurring tests to verify they pass**

Run: `npx -y deno test --allow-env supabase/functions/_shared/recurring.test.ts`
Expected: PASS, every existing test plus the 10 new ones.

- [x] **Step 5: Wire the tiebreak into `syncItem`**

In `sync.ts`, replace the recurring import with:

```ts
import {
  ignoredCategoryIds,
  jevRecurringDecide,
  normalizeMerchant,
  type RecurringDecide,
  refreshRecurring,
} from './recurring.ts';
```

In `syncItem`'s recurring block, replace:

```ts
      await refreshRecurring(admin, item, [...transferCategoryIds, ...ignoredCategoryIds(ownTransfers ?? [])]);
```

with:

```ts
      // 12d: Jev breaks ties on near misses only when this sync's gate is open.
      let decide: RecurringDecide | undefined;
      if (jevOn) {
        const { data: names, error: namesError } = await admin
          .from('categories').select('id, name').or(`herd_id.is.null,herd_id.eq.${item.herd_id}`);
        if (namesError) throw namesError;
        decide = jevRecurringDecide(askJev, new Map((names ?? []).map((c) => [c.id as string, c.name as string])));
      }
      await refreshRecurring(
        admin,
        item,
        [...transferCategoryIds, ...ignoredCategoryIds(ownTransfers ?? [])],
        decide,
      );
```

- [x] **Step 6: Run the Edge suite**

Run: `npx -y deno test --allow-env supabase/functions/_shared/`
Expected: `0 failed`.

- [x] **Step 7: Commit**

```bash
git add supabase/functions/_shared/recurring.ts supabase/functions/_shared/recurring.test.ts supabase/functions/_shared/sync.ts
git commit -F - <<'EOF'
feat(sync): Jev breaks recurring ties the heuristic cannot (Phase 12d)

A regular run whose amounts stray past the tolerance, but within twice
it, is a near miss. Jev decides whether it is a bill. A near miss Jev
could not judge is neither added nor deleted, so a flaky call never makes
a stream flicker; with Jev off, detection is exactly what it was.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 6: The app: deck order, the review hint, the split hint, the switch

**Files:**
- Modify: `apps/mobile/src/lib/review.ts` (add `orderQueue`)
- Test: `apps/mobile/src/lib/review.test.ts`
- Modify: `apps/mobile/src/lib/queries.ts` (imports; `Transaction` type ~line 242; `TRANSACTION_COLUMNS` line 248–249; `useReviewQueue` lines 783–806)
- Modify: `apps/mobile/src/components/review-card.tsx` (after the `guessHint` block, ~line 153)
- Modify: `apps/mobile/src/components/who-paid.tsx` (the `Pick` at line 36; after the split block, ~line 91)
- Modify: `apps/mobile/src/app/(tabs)/settings.tsx` (lines 234–243)

**Interfaces:**
- Consumes (Tasks 1, 4): `transactions.review_priority` (0–2 | null), `transactions.split_suggested` (boolean | null)
- Produces: `orderQueue(rows: { id: string; review_priority: number | null }[]): string[]`

- [x] **Step 1: Write the failing test**

In `apps/mobile/src/lib/review.test.ts`, change the import to:

```ts
import { deckReducer, newDeck, NOTE_MAX, normalizeNote, orderQueue, topCard } from './review.ts';
```

and append:

```ts
test('orderQueue puts likely fixes first, then glances, oldest first within each', () => {
  assert.deepEqual(
    orderQueue([
      { id: 'a', review_priority: 0 },
      { id: 'b', review_priority: 2 },
      { id: 'c', review_priority: null },
      { id: 'd', review_priority: 1 },
      { id: 'e', review_priority: 2 },
    ]),
    ['b', 'e', 'd', 'a', 'c'],
  );
});

test('with Jev off every row is unjudged, and the order is exactly the old one', () => {
  assert.deepEqual(
    orderQueue([
      { id: 'x', review_priority: null },
      { id: 'y', review_priority: null },
      { id: 'z', review_priority: null },
    ]),
    ['x', 'y', 'z'],
  );
});
```

- [x] **Step 2: Run it to verify it fails**

Run (in `apps/mobile`): `npm test`
Expected: FAIL. `orderQueue` is not exported.

- [x] **Step 3: Add `orderQueue` to `lib/review.ts`**

Append:

```ts
/**
 * The deck's order (12d): Jev's "likely needs a fix" first, then "worth a
 * glance", then everything else, keeping the queue's oldest-first order within
 * each. Unjudged rows count as routine, so with Jev off the order is exactly
 * the old one.
 */
export function orderQueue(rows: { id: string; review_priority: number | null }[]): string[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (b.row.review_priority ?? 0) - (a.row.review_priority ?? 0) || a.index - b.index)
    .map(({ row }) => row.id);
}
```

- [x] **Step 4: Run it to verify it passes**

Run (in `apps/mobile`): `npm test`
Expected: PASS, `tests 101`, `fail 0`.

- [x] **Step 5: Read the new columns and order the queue**

In `apps/mobile/src/lib/queries.ts`:

(a) Add between the `@/lib/presets` and `@/lib/settle` imports:

```ts
import { orderQueue } from '@/lib/review';
```

(b) In the `Transaction` type, directly after `reviewed_at: string | null;`, add:

```ts
  /** Jev's review triage (12d): 0 routine, 1 worth a glance, 2 likely needs a fix. Null = not judged. */
  review_priority: number | null;
  /** Jev thinks this looks shared (12d, shared herds only). A hint: never a split. */
  split_suggested: boolean | null;
```

(c) Append `, review_priority, split_suggested` to `TRANSACTION_COLUMNS`:

```ts
const TRANSACTION_COLUMNS =
  'id, account_id, name, merchant_name, merchant_key, logo_url, amount, iso_currency_code, date, pending, category_id, category_is_manual, category_source, notes, paid_by, paid_by_is_manual, split, reviewed_at, review_priority, split_suggested';
```

(d) In `useReviewQueue`, change the doc comment's first line to `The queue's ids, most likely fixes first (12d), else oldest first, snapshotted once per visit.`, change `.select('id, accounts!inner(hidden)')` to `.select('id, review_priority, accounts!inner(hidden)')`, and change `return data.map((r) => r.id);` to:

```ts
      return orderQueue(data);
```

- [x] **Step 6: Mark a likely fix on the review card**

In `apps/mobile/src/components/review-card.tsx`, directly after the `{guessHint(t.category_source) ? ( … ) : null}` block, add:

```tsx
        {t.review_priority === 2 ? (
          <AppText variant="caption" tone="brand" style={{ textAlign: 'center' }}>
            Worth a second look
          </AppText>
        ) : null}
```

- [x] **Step 7: Offer the split hint in WhoPaid**

In `apps/mobile/src/components/who-paid.tsx`:

(a) Add `'split_suggested'` to the `Pick` list:

```ts
    'id' | 'date' | 'amount' | 'pending' | 'category_id' | 'paid_by' | 'paid_by_is_manual' | 'split' | 'split_suggested' | 'accounts'
```

(b) Directly after the `{t.split ? ( … ) : null}` block, add:

```tsx
      {!t.split && !t.paid_by_is_manual && t.split_suggested ? (
        // Jev's hint (12d). It opens the same sheet and writes nothing itself.
        <Pressable onPress={() => setSplitting(true)} hitSlop={6}>
          <AppText variant="caption" tone="brand">
            Looks shared. Split it?
          </AppText>
        </Pressable>
      ) : null}
```

(WhoPaid already returns null outside a shared herd, and a private row is never asked, so neither case needs a check here.)

- [x] **Step 8: Say what the switch now covers**

In `apps/mobile/src/app/(tabs)/settings.tsx`, replace:

```tsx
            <AppText variant="label">Let AI sort the leftovers</AppText>
            <AppText variant="caption" tone="dim">
              Only for transactions nothing else could place. It sees the merchant, the amount,
              the description your bank sent and your bank&apos;s guess &mdash; never your balances,
              your accounts or who you are.
            </AppText>
```

with:

```tsx
            <AppText variant="label">Let AI help sort and review</AppText>
            <AppText variant="caption" tone="dim">
              Places transactions nothing else could, puts the ones worth a second look first in
              Review, and spots costs you may want to split. It sees the merchant, the amount, the
              description your bank sent and the category &mdash; never your balances, your accounts
              or who you are.
            </AppText>
```

and change `accessibilityLabel="Let AI sort the leftovers"` to `accessibilityLabel="Let AI help sort and review"`.

- [x] **Step 9: Typecheck, lint, test**

Run (in `apps/mobile`): `npm run typecheck; npx expo lint; npm test`
Expected: typecheck exits 0; lint reports 0 errors; `tests 101`, `fail 0`.

- [x] **Step 10: Commit**

```bash
git add apps/mobile/src/lib/review.ts apps/mobile/src/lib/review.test.ts apps/mobile/src/lib/queries.ts apps/mobile/src/components/review-card.tsx apps/mobile/src/components/who-paid.tsx "apps/mobile/src/app/(tabs)/settings.tsx"
git commit -F - <<'EOF'
feat(app): likely fixes first in Review, and a hint to split shared costs (Phase 12d)

The deck orders by Jev's triage, and unjudged rows keep today's order. A
likely fix says so on its card. In a shared herd, a row Jev thinks is
shared offers the split sheet; it writes nothing on its own. The AI
switch says what it now covers.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 7: Measurement and docs

**Files:**
- Modify: `scripts/cat-quality.mjs` (lines 24–60)
- Modify: `CLAUDE.md` (status line; Commands; the 12b paragraph)
- Modify: `docs/ops/production.md` (line 36)
- Modify: `docs/ops/security-review-2026-09-27.md` (a new finding before `## What was verified and is sound`)
- Modify: `docs/product/monetization.md` (a new subsection under `### AI is cheap by comparison`; open question line 157)

**Interfaces:**
- Consumes: every column from Task 1 and every constant name from Tasks 2–5. Docs must use those exact names.

- [x] **Step 1: Rewrite the query section of `cat-quality.mjs`**

Replace everything from `const sql = \`` (line 25) to the end of the file with:

```js
/** One query on the linked project, as rows of text cells. The header row is kept: it prints as the titles. */
function query(sql) {
  // The SQL goes through a file: quoting it for a Windows shell is hopeless.
  const dir = mkdtempSync(join(tmpdir(), 'cat-quality-'));
  try {
    const file = join(dir, 'q.sql');
    writeFileSync(file, sql);
    const out = execFileSync('npx', ['-y', 'supabase@2.118.0', 'db', 'query', '--linked', '-o', 'csv', '-f', file], {
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.split(/\r?\n/).filter((l) => /^[a-z0-9_]+,/.test(l)).map((l) => l.split(','));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const WIDTHS = [8, 11, 15];
function print(title, rows) {
  console.log(`\n${title}`);
  for (const [label, ...cells] of rows) {
    console.log(`${label.padEnd(16)}${cells.map((c, i) => (c || '-').padStart(WIDTHS[i] ?? 12)).join('')}`);
  }
}

print('Each source: kept vs corrected', query(`
with kept as (
  select category_source as source, count(*) as kept
  from public.transactions where not category_is_manual and reviewed_at is not null group by 1
), fixed as (
  select corrected_from as source, count(*) as corrected
  from public.transactions where corrected_from is not null group by 1
)
select coalesce(k.source, f.source) as source, coalesce(k.kept, 0) as kept, coalesce(f.corrected, 0) as corrected,
  round(100.0 * coalesce(f.corrected, 0) / nullif(coalesce(k.kept, 0) + coalesce(f.corrected, 0), 0), 1) as corrected_pct
from kept k full join fixed f on f.source = k.source
order by 1;`));

// 12d: is JEV_CONFIDENCE in the right place? Corrections should fall as confidence rises.
print('AI answers by confidence (12d calibration)', query(`
with ai as (
  select case
      when ai_confidence is null then 'no_conf'
      when ai_confidence >= 0.99 then 'conf_99_up'
      when ai_confidence >= 0.95 then 'conf_95_99'
      else 'conf_90_95' end || '_' || coalesce(ai_level, 'na') as band,
    (category_source = 'ai' and not category_is_manual and reviewed_at is not null) as kept,
    (corrected_from = 'ai') as corrected
  from public.transactions
  where category_source = 'ai' or corrected_from = 'ai'
)
select band, count(*) filter (where kept) as kept, count(*) filter (where corrected) as corrected,
  round(100.0 * count(*) filter (where corrected) / nullif(count(*) filter (where kept or corrected), 0), 1) as corrected_pct
from ai group by 1 order by 1;`));

// 12d: does "likely needs a fix" predict fixes?
print('Review priority vs fixes (12d triage)', query(`
select 'priority_' || review_priority as level,
  count(*) filter (where corrected_from is null) as kept,
  count(*) filter (where corrected_from is not null) as corrected,
  round(100.0 * count(*) filter (where corrected_from is not null) / nullif(count(*), 0), 1) as corrected_pct
from public.transactions
where review_priority is not null and reviewed_at is not null
group by 1 order by 1;`));

// 12d: do people split what Jev suggested?
print('Split hint vs splits (12d)', query(`
select case when split_suggested then 'suggested' else 'not_suggested' end as hint,
  count(*) filter (where split is not null) as split,
  count(*) filter (where split is null) as not_split,
  round(100.0 * count(*) filter (where split is not null) / nullif(count(*), 0), 1) as split_pct
from public.transactions
where split_suggested is not null and reviewed_at is not null
group by 1 order by 1;`));
```

In the header comment, directly after the line `// compare runs made after 12a shipped.`, add:

```js
//
// Since 12d it also prints Jev's calibration (corrections by confidence band),
// whether triage's "likely needs a fix" predicts fixes, and whether split hints
// are taken.
```

- [x] **Step 2: Run it on dev**

Run: `node scripts/cat-quality.mjs`
Expected: four titled tables. The first matches what it printed before 12d. The three 12d tables show only their header rows until Task 8 produces data.

- [x] **Step 3: Update `CLAUDE.md`**

(a) In the status paragraph, change `(12a learning from fixes, 12b AI fallback, 12c crowd labels):` to `(12a learning from fixes, 12b AI fallback, 12c crowd labels, 12d Jev decisions — spec docs/superpowers/specs/2026-09-27-phase-12d-jev-decisions-design.md):`.

(b) In Commands, replace the line

```
npx -y deno test supabase/functions/_shared/    # Edge Function unit tests; Deno need not be installed
```

with

```
npx -y deno test --allow-env supabase/functions/_shared/    # Edge Function unit tests; Deno need not be installed (tests set env vars)
```

(c) Replace the whole `- **The AI fallback** (Phase 12b). …` bullet (from `- **The AI fallback** (Phase 12b).` through `…same unplaceable merchant on every sync.`) with:

```markdown
- **The AI fallback** (Phase 12b; answered by Jev since 12d). Opt-in per user (`profiles.ai_categorize`,
  off by default) and only over rows nothing else could settle. `_shared/ai.ts` is pure except the
  `JevAsk` that `jevCategorizer` is given. `runAiPass` in `_shared/sync.ts` never throws: a missed
  category is not worth failing a sync over. `ai_category_cache` is GLOBAL and has no `herd_id` — the
  model sees only merchant text and built-in categories, so one answer serves every herd — but a
  private account's row is never cached. `aiAllowed()` is the single server-side seam a subscription
  check will occupy; AI is meant to be a subscriber feature. Three things are easy to undo by
  accident: `ai` is a source in `resolveCategory`, so a re-resolve does not take back an answer the
  user was already shown; the pass runs **after** the cursor advance, beside the snapshot pass,
  because a slow vendor must never cost a re-pagination; and a cache row with a null `category_id`
  means "asked and declined", which is what stops us paying to ask about the same unplaceable
  merchant on every sync. A merchant whose call *failed* is never cached, so it is asked again.
- **Jev decisions** (Phase 12d). Jev (TypeSafe AI's System One model) makes every structured
  decision. Claude is kept for sentences, and nothing uses it yet. `_shared/jev.ts` holds the only
  impure call, `askJev`: a raw `fetch` to `https://api.typesafe.ai/v1/systemone`, with the secret
  `JEV_API_KEY` and the model pinned in `JEV_MODEL`. Its readers return null on any shape they do not
  expect. Each call is bounded (`JEV_CLIENT`) and each pass has a total budget (`JEV_PASS_BUDGET_MS`),
  because a pass is up to 50 calls. `jevEnabled` checks the key, `aiAllowed` and the connector's
  `ai_categorize` once per sync. One switch covers all surfaces.
  - **Categories:** one speculative fan-out per uncached merchant: a `group` Choice plus one
    `child__<group_slug>` Choice per group, in one request. A child is written only when the group
    AND the child clear `JEV_CONFIDENCE` (0.9). A sure group alone writes the group; anything else is
    declined. `uncategorized` is offered as "none fits", and choosing it is a decline.
    `ai_confidence`/`ai_level` on the row (and `confidence`/`level` in the cache) feed
    `cat-quality.mjs`'s calibration table.
  - **Triage** (`_shared/triage.ts`, `runTriagePass`) is per row and never cached. `review_priority`
    (0 routine, 1 worth a glance, 2 likely needs a fix) orders the review deck (`orderQueue` in
    `lib/review.ts`). Null sorts as routine, so with Jev off the deck is unchanged. `split_suggested`
    is asked only in shared herds, on shared accounts, for money out that is not already split. It is
    a hint the app shows in `WhoPaid`: it never writes `split`, so it cannot move a balance.
  - **Recurring:** the heuristic stays the source of truth. Only a near miss is sent to Jev: a regular
    cadence whose amounts are past the tolerance but within `NEAR_MISS_FACTOR`×. A `noul` ≥ 0.5 tips
    it in. A near miss Jev could not judge is neither added nor deleted, so a flaky call never makes a
    stream flicker. With Jev off, near misses are dropped exactly as before.
  - Only these passes write the four Jev columns on `transactions`, and never in sync's upsert
    payload. The client has no UPDATE on them. The table-level SELECT grant lets the app read all
    four, which is harmless: they are the herd's own rows.
```

- [x] **Step 4: Update `docs/ops/production.md` line 36**

Replace `` `ANTHROPIC_API_KEY` (the 12b AI pass; it must be scoped to a workspace, and without it the pass is skipped silently and syncs are otherwise unaffected) `` with:

```
`JEV_API_KEY` (TypeSafe's Jev, which makes every AI decision since Phase 12d; without it the Jev passes are skipped silently and syncs are otherwise unaffected; `ANTHROPIC_API_KEY` is no longer read)
```

- [x] **Step 5: Record TypeSafe as a processor in the security review**

In `docs/ops/security-review-2026-09-27.md`, insert directly before `## What was verified and is sound`:

```markdown
### 9. A second AI processor: TypeSafe (Phase 12d) — INFO, by design

With a user's AI switch on, sync sends TypeSafe (Jev) the merchant name, the bank's description, the
amount and direction, and Plaid's category guess for rows nothing else could place. For each new
unreviewed row it also sends the category, how that category was set, and the herd's size. It never
sends balances, account names or numbers, user ids, or anyone's name. Under 12b, Anthropic received
the same merchant-level fields; today it receives nothing. The switch stays off by default for this
reason: however well-behaved the model, the data leaves our infrastructure. **Before production:**
read TypeSafe's data-retention and training terms and record them here.

```

- [x] **Step 6: Record the cost finding in `docs/product/monetization.md`**

Directly before `## How the tiers work`, insert:

```markdown
### Decisions vs sentences (Phase 12d)

Since Phase 12d, Jev (TypeSafe AI) makes every AI decision: categories, review priority, split hints
and recurring tiebreaks. It costs $0.042 per million input tokens, and output is free. A
categorization call is roughly 1.5k input tokens, so $10 covers about 150,000 of them. For costing
purposes, the decisions are free. That changes what a credit meters: credits are for Claude-written
text (the future money assistant), not for decisions. Decisions stay a subscriber feature behind
`aiAllowed()` because they are a reason to subscribe, not because they cost us much. Re-evaluate once
dev data shows Jev's quality (`scripts/cat-quality.mjs`).

```

Replace the open question `- What is Jev from Typesafe AI, and how does it compare to Haiku on cost and quality?` with:

```markdown
- Jev vs Haiku: decided in Phase 12d. Jev makes decisions and Haiku writes text (see *Decisions vs sentences*). Quality is measured on dev with `scripts/cat-quality.mjs`.
```

- [x] **Step 7: Check that no doc still points at the old path**

Run: `grep -n "askClaude\|hasAnthropicKey\|messages.parse" CLAUDE.md docs/ops/production.md`
Expected: no output.

- [x] **Step 8: Commit**

```bash
git add scripts/cat-quality.mjs CLAUDE.md docs/ops/production.md docs/ops/security-review-2026-09-27.md docs/product/monetization.md
git commit -F - <<'EOF'
docs: Phase 12d, Jev decisions, and the instrument to judge them

cat-quality prints Jev's calibration, whether triage predicts fixes, and
whether split hints are taken. CLAUDE.md, the production runbook, the
security review and the monetization notes say what Jev does, what it
sees and what it costs. The documented Deno test command gains the
--allow-env it has needed since 12b.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
```

---

### Task 8: Dev rollout, end to end, and the PR

**Files:** none changed. This task deploys to dev, observes the result, and opens the PR.

**Interfaces:**
- Consumes: everything above. Test user `ccbd42ef-cba6-4f05-a100-a83a727255b2` (`ph.leao2099+tuskytest`), who connects the banks. Kel Test has no banks, so their switch decides nothing.

- [x] **Step 1: Confirm dev and the secret**

Run: `cat supabase/.temp/project-ref` → `ifibrsgqdibcomzxencf`.
Run: `npx -y supabase@2.118.0 secrets list` → the list includes `JEV_API_KEY`. (It shows names only. Never run `secrets set --env-file`.)
If `JEV_API_KEY` is missing: STOP and ask Pedro. Every pass would skip silently.

- [x] **Step 2: Deploy every function to dev**

Run: `npx -y supabase@2.118.0 functions deploy --use-api`
Expected: each function reports `Deployed Function …`. `plaid-sync-transactions` and `plaid-webhook` both bundle `_shared/sync.ts`.

- [x] **Step 3: Turn the switch on for the test user, and refill the review queue**

Run:
```bash
npx -y supabase@2.118.0 db query --linked -o csv "update public.profiles set ai_categorize = true where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2' returning user_id, ai_categorize"
node scripts/seed-review.mjs 25
```
Expected: one row, `…,t`. The seed script reports 25 rows back in the queue.

- [x] **Step 4: Sync**

Kill anything on port 8081 and start Metro fresh (CLAUDE.md: a Metro that outlived its session hangs). On the emulator, open Home and pull to refresh. The tooling notes give the gesture: `adb -s emulator-5554 shell input swipe 540 900 540 1900 1200` from the top of the list. Wait for the refresh spinner to stop (`node scripts/emu.mjs ui`).

- [x] **Step 5: Verify what Jev wrote**

Run:
```bash
npx -y supabase@2.118.0 db query --linked -o csv "select count(*) filter (where category_source = 'ai' and ai_confidence is not null) as ai_rows, count(*) filter (where review_priority is not null) as triaged, count(*) filter (where review_priority = 2) as likely_fix, count(*) filter (where split_suggested is not null) as split_judged from public.transactions where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2'"
npx -y supabase@2.118.0 db query --linked -o csv "select coalesce(level, 'declined_or_12b') as level, count(*) as n, round(avg(confidence), 3) as avg_conf from public.ai_category_cache group by 1 order by 1"
```
Expected: `triaged` ≥ 1 (the seeded rows). `split_judged` = 0, because the test user's herd is solo and the split question is never asked; unit tests cover the shared case. `ai_rows` ≥ 0: it depends on how many rows Plaid left uncertain. If both `ai_rows` and `triaged` are 0, open the Edge Function logs for `plaid-sync-transactions` in the dashboard and look for `ai pass skipped` / `triage pass skipped` lines. Report the logged reason (e.g. `jev: HTTP 401`) to Pedro instead of guessing.

- [x] **Step 6: Read the instrument**

Run: `node scripts/cat-quality.mjs`
Expected: the calibration table shows a row for each band Jev answered in. Record the four tables' output for the PR description.

- [x] **Step 7: See the deck**

Run: `node scripts/emu.mjs tap "Review"` (or open the review badge), then `node scripts/emu.mjs ui`.
Expected: if any row has `review_priority = 2`, the first card shows "Worth a second look". Then Settings (`node scripts/emu.mjs ui` on the Settings tab) shows "Let AI help sort and review". Take one screenshot only if layout looks wrong.

- [x] **Step 8: Run every suite one last time**

Run: `npx -y deno test --allow-env supabase/functions/_shared/` → `0 failed`.
Run (in `apps/mobile`): `npm run typecheck; npx expo lint; npm test` → clean, `fail 0`.

- [x] **Step 9: Push and open the PR (never merge)**

The branch was created tracking `origin/master`, so always name the push target:

```bash
git push -u origin pedro-12d
```

Write the PR body to the scratchpad (`pr-12d.md`) covering: the rule (Jev for decisions, Claude for sentences), the four surfaces, the ten departures from the spec (copy the list from this plan), the Step 5–6 numbers, and what waits for Pedro:
- the production migration and deploy, on his go-ahead;
- TypeSafe's retention terms, before production (security review finding 9);
- re-tuning `JEV_CONFIDENCE` once calibration data exists.

End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Then, in the PowerShell tool (Git Bash cannot see `gh`), refresh `PATH` per the tooling notes and run:

```powershell
gh pr create --repo Kelvinluciano312/Tusky-App --base master --head pedro-12d --title "Phase 12d: Jev decisions" --body-file <scratchpad>/pr-12d.md
```

Expected: a PR URL. Report it to Pedro. **Do not merge**, and do not run anything against production.
