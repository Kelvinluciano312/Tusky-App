# Phase 12b: the AI fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When every other source is unsure, an opt-in AI pass categorizes those transactions — and its answers are cached globally, so a merchant one subscriber resolves is free and already categorized for everyone.

**Architecture:** A new pure module, `_shared/ai.ts`, owns the prompt, the reply validation and the cache key; the Claude call is injected so every branch is testable without a network or a key. Sync runs it as a second pass after the upsert, over exactly the rows that landed on low-confidence Plaid or the fallback. A global `ai_category_cache` table is consulted before the model and written after it. Failure is always silent: the rows simply keep Plaid's category.

**Tech Stack:** Deno Edge Functions (`npm:@anthropic-ai/sdk`, `npm:zod`), Supabase Postgres, Expo React Native app, app tests with `node --test`, Edge tests with `deno test`.

**Spec:** `docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md` (section "12b: the AI fallback", revised 2026-09-27)

## Global Constraints

- Model: `claude-haiku-4-5` exactly. **No `output_config.effort`** (Haiku 4.5 rejects it) and **no `thinking`** — classification needs neither.
- Pins: `npm:@anthropic-ai/sdk@0.128.0` and `npm:zod@4.6.5`. The SDK is 0.x, so it is pinned to the exact version rather than a major, unlike the repo's `@supabase/supabase-js@2`; the SDK accepts zod `^3.25 || ^4`.
- The reply is constrained with `client.messages.parse()` and `output_config: { format: zodOutputFormat(schema) }`. Never parse prose.
- The model sees only: merchant name, raw description, amount, Plaid's two codes, and the built-in category list. **Never** an account, a balance, a user id or a herd id.
- Only built-in categories are offered and only a slug we offered is accepted. A custom category is never an AI answer.
- `aiAllowed(herd)` is the single server-side seam a subscription check will later occupy. It returns `true` for everyone today. The gate is never in the client.
- `profiles.ai_categorize boolean not null default false` — off until a user asks.
- At most **50 uncached rows per sync**. Cache hits are free and do not count against it.
- Any AI failure is swallowed: rows keep the category they already have, and the next sync may retry.
- `category_source = 'ai'` on a row the model set; `resolveCategory`'s existing `ai` source value is reused, and a manual row is never touched.
- New tables need RLS, herd policies where applicable, and explicit grants — a new table is unreachable from the app until granted.
- App pure logic: `npm test` (`node --test src/lib/*.test.ts`), `/// <reference types="node" />` at the top of each test, imports only `import type` or relative `./x.ts`.
- Edge Function logic: `npx -y deno test supabase/functions/_shared/`.
- Run `npm run typecheck && npx expo lint` in `apps/mobile` before every app commit; `node scripts/rls-check.mjs` after any migration.
- Branch `pedro-12b` (already created from origin/master, upstream unset). Never commit to master.

## Review Focus

1. **The model returns a slug we never offered, or a duplicate id** — the row must keep its existing category rather than take a bad one (Task 1 test).
2. **A transaction whose merchant name is empty** — it must still be sent (the raw description carries the meaning) and must not collide in the cache with every other blank merchant (Task 1 test).
3. **No `ANTHROPIC_API_KEY` set** — sync must complete normally with the AI pass skipped, not throw (Task 3 test).
4. **A herd mate's private account** — a private row's merchant must not be written into the global cache, where another herd would see it (Task 2 test + Task 3 wiring).
5. **The same merchant twice in one batch** — it must cost one model answer, not two, and both rows must get it (Task 1 test).

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/ai.ts` (new) | Pure: `aiAllowed`, `cacheKeyFor`, `buildAskList`, `applyAnswers`, the Zod reply schema, and `askClaude` (the one impure function, injected everywhere else) |
| `supabase/functions/_shared/ai.test.ts` (new) | Its tests, with a fake model |
| `supabase/migrations/20261005120000_phase12b_ai_fallback.sql` (new) | `profiles.ai_categorize`, `ai_category_cache`, grants, RLS |
| `supabase/functions/_shared/sync.ts` | The second pass after the upsert |
| `apps/mobile/src/lib/queries.ts` | `ai_categorize` on `Profile`, `useSetAiCategorize` |
| `apps/mobile/src/app/(tabs)/settings.tsx` | The switch and its caption |
| `scripts/rls-check.mjs` | Cache is server-only; the switch is self-only |

---

### Task 1: `ai.ts` — the prompt, the cache key, and the reply

**Files:**
- Create: `supabase/functions/_shared/ai.ts`
- Create: `supabase/functions/_shared/ai.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type AiRow = { id: string; merchant_key: string; name: string; merchant_name: string | null; amount: number; pfc_primary: string | null; pfc_detailed: string | null; is_private: boolean }`
  - `type AiCategory = { id: string; slug: string; name: string; parent_name: string | null }`
  - `type AiAnswer = { key: string; slug: string }`
  - `type AskFn = (rows: AiRow[], categories: AiCategory[]) => Promise<AiAnswer[]>`
  - `const AI_MAX_PER_SYNC = 50`
  - `cacheKeyFor(row: AiRow): string`
  - `aiAllowed(herdId: string): boolean`
  - `buildAskList(rows: AiRow[], cached: Map<string, string>): { ask: AiRow[]; resolved: Map<string, string> }`
  - `applyAnswers(rows: AiRow[], answers: AiAnswer[], categories: AiCategory[]): { updates: { id: string; category_id: string }[]; cacheable: { key: string; category_id: string }[] }`

- [ ] **Step 1: Write the failing test** (`ai.test.ts`)

```ts
import { assertEquals } from 'jsr:@std/assert';

import {
  AI_MAX_PER_SYNC,
  type AiCategory,
  type AiRow,
  aiAllowed,
  applyAnswers,
  buildAskList,
  cacheKeyFor,
} from './ai.ts';

const CATS: AiCategory[] = [
  { id: 'c-groceries', slug: 'groceries', name: 'Groceries', parent_name: 'Food & Dining' },
  { id: 'c-fuel', slug: 'gas', name: 'Gas', parent_name: 'Transportation' },
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

Deno.test('aiAllowed lets every herd through for now — the seam a subscription check will fill', () => {
  assertEquals(aiAllowed('any-herd-id'), true);
});

Deno.test('the per-sync cap is 50', () => {
  assertEquals(AI_MAX_PER_SYNC, 50);
});

Deno.test('cacheKeyFor groups a merchant by direction and amount band, not by exact amount', () => {
  // $48 and $52 are the same kind of purchase; the band is what makes the cache pay.
  assertEquals(cacheKeyFor(row({ amount: -48.2 })), cacheKeyFor(row({ amount: -52 })));
  // Money in is a different question from money out.
  assertEquals(cacheKeyFor(row({ amount: 48.2 })) === cacheKeyFor(row({ amount: -48.2 })), false);
  // A $5 snack is not a $50 fill-up.
  assertEquals(cacheKeyFor(row({ amount: -4 })) === cacheKeyFor(row({ amount: -48 })), false);
});

Deno.test('a blank merchant keys on its own description, not on every other blank one', () => {
  const a = row({ id: 'a', merchant_key: '', merchant_name: null, name: 'SQ *BLUE BOTTLE' });
  const b = row({ id: 'b', merchant_key: '', merchant_name: null, name: 'POS DEBIT 88213' });
  assertEquals(cacheKeyFor(a) === cacheKeyFor(b), false);
});

Deno.test('buildAskList answers from the cache and only asks about the rest', () => {
  const cached = new Map([[cacheKeyFor(row()), 'c-fuel']]);
  const other = row({ id: 't2', merchant_key: 'lidl', merchant_name: 'Lidl', name: 'LIDL 220', amount: -31 });
  const { ask, resolved } = buildAskList([row(), other], cached);
  assertEquals(ask.map((r) => r.id), ['t2']);
  assertEquals(resolved.get('t1'), 'c-fuel');
});

Deno.test('the same merchant twice in one batch is asked about once, and both rows get the answer', () => {
  const a = row({ id: 'a' });
  const b = row({ id: 'b', amount: -49 }); // same merchant, same band
  const { ask } = buildAskList([a, b], new Map());
  assertEquals(ask.length, 1);

  const { updates } = applyAnswers([a, b], [{ key: cacheKeyFor(a), slug: 'gas' }], CATS);
  assertEquals(updates.sort((x, y) => x.id.localeCompare(y.id)), [
    { id: 'a', category_id: 'c-fuel' },
    { id: 'b', category_id: 'c-fuel' },
  ]);
});

Deno.test('a slug we never offered is ignored, and the row keeps what it had', () => {
  const { updates, cacheable } = applyAnswers([row()], [{ key: cacheKeyFor(row()), slug: 'crypto-moonshots' }], CATS);
  assertEquals(updates, []);
  assertEquals(cacheable, []);
});

Deno.test('an answer for a key we did not ask about is ignored', () => {
  const { updates } = applyAnswers([row()], [{ key: 'some-other-key', slug: 'gas' }], CATS);
  assertEquals(updates, []);
});

Deno.test('a duplicated key takes the first answer and ignores the rest', () => {
  const key = cacheKeyFor(row());
  const { updates } = applyAnswers([row()], [{ key, slug: 'gas' }, { key, slug: 'groceries' }], CATS);
  assertEquals(updates, [{ id: 't1', category_id: 'c-fuel' }]);
});

Deno.test('a private row takes the answer but never reaches the global cache', () => {
  const secret = row({ id: 'p1', is_private: true });
  const { updates, cacheable } = applyAnswers([secret], [{ key: cacheKeyFor(secret), slug: 'gas' }], CATS);
  assertEquals(updates, [{ id: 'p1', category_id: 'c-fuel' }]);
  // Caching it would show another herd which merchants someone keeps private.
  assertEquals(cacheable, []);
});

Deno.test('a shared row is cacheable', () => {
  const { cacheable } = applyAnswers([row()], [{ key: cacheKeyFor(row()), slug: 'gas' }], CATS);
  assertEquals(cacheable, [{ key: cacheKeyFor(row()), category_id: 'c-fuel' }]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx -y deno test supabase/functions/_shared/ai.test.ts`
Expected: FAIL — `Cannot find module './ai.ts'`.

- [ ] **Step 3: Write the implementation** (`ai.ts`)

```ts
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
  cached: Map<string, string>,
): { ask: AiRow[]; resolved: Map<string, string> } {
  const resolved = new Map<string, string>();
  const ask: AiRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = cacheKeyFor(row);
    const hit = cached.get(key);
    if (hit) {
      resolved.set(row.id, hit);
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
 */
export function applyAnswers(
  rows: AiRow[],
  answers: AiAnswer[],
  categories: AiCategory[],
): { updates: { id: string; category_id: string }[]; cacheable: { key: string; category_id: string }[] } {
  const idBySlug = new Map(categories.map((c) => [c.slug, c.id]));
  const asked = new Set(rows.map(cacheKeyFor));

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
  return { updates, cacheable: [...cacheable].map(([key, category_id]) => ({ key, category_id })) };
}

const ReplySchema = z.object({
  answers: z.array(z.object({
    key: z.string().describe('the exact key given for the transaction'),
    slug: z.string().describe('the slug of the best category, from the list'),
  })),
});

/**
 * The one impure function. A failure throws; the caller swallows it, because a
 * missed category is never worth failing a sync over.
 */
export const askClaude: AskFn = async (rows, categories) => {
  const client = new Anthropic();
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
```

- [ ] **Step 4: Run the tests**

Run: `npx -y deno test supabase/functions/_shared/`
Expected: all PASS, the existing suites included.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/ai.ts supabase/functions/_shared/ai.test.ts
git commit -m "feat(sync): the AI fallback's prompt, cache key and reply handling (Phase 12b)"
```
(End every commit message with the `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` line.)

---

### Task 2: The migration — the switch and the global cache

**Files:**
- Create: `supabase/migrations/20261005120000_phase12b_ai_fallback.sql`
- Modify: `scripts/rls-check.mjs`

**Interfaces:**
- Produces: `profiles.ai_categorize boolean not null default false`; table `public.ai_category_cache (cache_key text primary key, category_id uuid not null references public.categories(id), created_at timestamptz not null default now())`.

- [ ] **Step 1: Add the failing RLS probes.** In `scripts/rls-check.mjs`, add to the `declare` list (after `my_cat uuid;`):

```sql
  ai_on boolean;
```

Add before the `-- Only the owner renames the herd.` line:

```sql
  -- Phase 12b: the AI cache is server-only, and the switch is your own.
  begin
    perform 1 from public.ai_category_cache limit 1;
    w := w || jsonb_build_object('read_ai_cache', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('read_ai_cache', 'denied');
  end;
  update public.profiles set ai_categorize = true where user_id = u;
  select ai_categorize into ai_on from public.profiles where user_id = u;
  w := w || jsonb_build_object('own_ai_switch', ai_on);
  if mate is not null then
    update public.profiles set ai_categorize = true where user_id = mate;
    get diagnostics n = row_count;
    w := w || jsonb_build_object('mates_ai_switch_rows', n);
  end if;
```

Add to `WRITE_EXPECT`:

```js
  read_ai_cache: 'denied',
  own_ai_switch: true,
  mates_ai_switch_rows: 0,
```

- [ ] **Step 2: Run to verify it fails**

Run: `node scripts/rls-check.mjs ccbd42ef-cba6-4f05-a100-a83a727255b2`
Expected: `FAIL ... no result`, with `relation "public.ai_category_cache" does not exist`.

- [ ] **Step 3: Write the migration**

```sql
-- Phase 12b: the AI fallback. An opt-in switch per user, and one global cache
-- of the model's answers.
--
-- The cache is deliberately global and has no herd_id: the model only ever sees
-- merchant-level text and the built-in category list, so an answer is correct
-- for every herd. That is the whole bargain — a merchant one subscriber pays to
-- resolve is then free, and already categorized, for everyone. Private rows are
-- kept out of it in code (applyAnswers), because which merchants someone keeps
-- private is not a fact other herds get to learn.
-- See docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md.

alter table public.profiles
  add column ai_categorize boolean not null default false;

grant update (ai_categorize) on public.profiles to authenticated;

create table public.ai_category_cache (
  -- merchant|direction|band, built by cacheKeyFor in _shared/ai.ts.
  cache_key text primary key,
  category_id uuid not null references public.categories (id),
  created_at timestamptz not null default now()
);

-- RLS on with no policy: deny-all to every client, reachable only by
-- service_role, exactly like plaid_tokens. No grants are issued on purpose.
alter table public.ai_category_cache enable row level security;
```

- [ ] **Step 4: Apply it to dev and verify**

Run: `npx supabase db push` (the CLI is linked to dev; answer `Y`).
Run: `node scripts/rls-check.mjs`
Expected: every line PASS, including `read_ai_cache denied`, `own_ai_switch true` and `mates_ai_switch_rows 0`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261005120000_phase12b_ai_fallback.sql scripts/rls-check.mjs
git commit -m "feat(db): the AI switch and the global answer cache (Phase 12b)"
```

---

### Task 3: Sync runs the pass

**Files:**
- Modify: `supabase/functions/_shared/sync.ts`
- Modify: `supabase/functions/_shared/ai.test.ts` (one more test)

**Interfaces:**
- Consumes: everything Task 1 produces; the Task 2 tables.
- Produces: `runAiPass(admin, item, ask?)` exported from `sync.ts` for the test; called at the end of the upsert block.

- [ ] **Step 1: Write the failing test.** Append to `ai.test.ts`:

```ts
import { hasAnthropicKey } from './ai.ts';

Deno.test('with no API key the pass is skipped rather than attempted', () => {
  const had = Deno.env.get('ANTHROPIC_API_KEY');
  Deno.env.delete('ANTHROPIC_API_KEY');
  try {
    // A sync on a project with no key must complete normally, not throw.
    assertEquals(hasAnthropicKey(), false);
  } finally {
    if (had !== undefined) Deno.env.set('ANTHROPIC_API_KEY', had);
  }
});

Deno.test('with an API key the pass is attempted', () => {
  const had = Deno.env.get('ANTHROPIC_API_KEY');
  Deno.env.set('ANTHROPIC_API_KEY', 'sk-ant-test');
  try {
    assertEquals(hasAnthropicKey(), true);
  } finally {
    if (had === undefined) Deno.env.delete('ANTHROPIC_API_KEY');
    else Deno.env.set('ANTHROPIC_API_KEY', had);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx -y deno test --allow-env supabase/functions/_shared/ai.test.ts`
Expected: FAIL — `ai.ts` has no export named `hasAnthropicKey`.

- [ ] **Step 3: Add `hasAnthropicKey` to `ai.ts`,** just above `askClaude`:

```ts
/** Whether a key is configured at all. Without one the pass is skipped silently. */
export function hasAnthropicKey(): boolean {
  return Boolean(Deno.env.get('ANTHROPIC_API_KEY'));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx -y deno test --allow-env supabase/functions/_shared/ai.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire sync.** In `_shared/sync.ts`, add the import:

```ts
import {
  AI_MAX_PER_SYNC,
  type AiRow,
  aiAllowed,
  applyAnswers,
  askClaude,
  type AskFn,
  buildAskList,
  cacheKeyFor,
  hasAnthropicKey,
} from './ai.ts';
```

Add this function just above `syncItem`:

```ts
/**
 * The AI fallback (12b), run after the upsert over the rows every other source
 * was unsure about. Never throws: a missed category is not worth failing a sync
 * over, and the next sync retries. `ask` is injected for tests.
 */
export async function runAiPass(
  admin: SupabaseClient,
  item: { id: string; user_id: string; herd_id: string },
  ask: AskFn = askClaude,
): Promise<number> {
  try {
    if (!hasAnthropicKey() || !aiAllowed(item.herd_id)) return 0;

    const { data: profile } = await admin
      .from('profiles').select('ai_categorize').eq('user_id', item.user_id).maybeSingle();
    if (!profile?.ai_categorize) return 0;

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
      .from('ai_category_cache').select('cache_key, category_id').in('cache_key', keys);
    const cached = new Map((cacheRows ?? []).map((c) => [c.cache_key as string, c.category_id as string]));

    const { data: categoryRows } = await admin
      .from('categories')
      .select('id, slug, name, parent_id')
      .is('herd_id', null)
      .not('parent_id', 'is', null);
    const { data: groupRows } = await admin
      .from('categories').select('id, name').is('herd_id', null).is('parent_id', null);
    const groupName = new Map((groupRows ?? []).map((g) => [g.id as string, g.name as string]));
    const categories = (categoryRows ?? [])
      .filter((c) => c.slug)
      .map((c) => ({
        id: c.id as string,
        slug: c.slug as string,
        name: c.name as string,
        parent_name: groupName.get(c.parent_id as string) ?? null,
      }));

    const { ask: toAsk, resolved } = buildAskList(rows, cached);
    let answers: { key: string; slug: string }[] = [];
    if (toAsk.length > 0) answers = await ask(toAsk.slice(0, AI_MAX_PER_SYNC), categories);
    const { updates, cacheable } = applyAnswers(rows, answers, categories);

    // Cache hits update rows too, and cost nothing.
    for (const [id, category_id] of resolved) updates.push({ id, category_id });

    for (const u of updates) {
      const { error } = await admin
        .from('transactions')
        .update({ category_id: u.category_id, category_source: 'ai' })
        .eq('id', u.id)
        // Re-checked at write time: a row set by hand meanwhile stays put.
        .eq('category_is_manual', false);
      if (error) throw error;
    }
    if (cacheable.length > 0) {
      await admin
        .from('ai_category_cache')
        .upsert(cacheable.map((c) => ({ cache_key: c.key, category_id: c.category_id })), { onConflict: 'cache_key' });
    }
    return updates.length;
  } catch (err) {
    console.warn(`ai pass skipped for item ${item.id}: ${describeError(err)}`);
    return 0;
  }
}
```

Then call it inside `syncItem`, immediately after the carried-payers loop and before the `if (removed.length > 0)` block:

```ts
      // 12b: last, over what nothing else could settle. Never throws.
      const aiSet = await runAiPass(admin, item);
      if (aiSet > 0) console.log(`item ${item.id}: AI categorized ${aiSet}`);
```

- [ ] **Step 6: Type-check and run the suites**

Run: `npx -y deno check supabase/functions/plaid-sync-transactions/index.ts supabase/functions/plaid-webhook/index.ts`
Expected: no errors.
Run: `npx -y deno test --allow-env supabase/functions/_shared/`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/ai.ts supabase/functions/_shared/ai.test.ts supabase/functions/_shared/sync.ts
git commit -m "feat(sync): run the AI fallback over what nothing else could settle (Phase 12b)"
```

---

### Task 4: The Settings switch

**Files:**
- Modify: `apps/mobile/src/lib/queries.ts` (`Profile` ~line 871, and a new mutation after `useSetDisplayName`)
- Modify: `apps/mobile/src/app/(tabs)/settings.tsx` (the Categories card)

**Interfaces:**
- Consumes: `profiles.ai_categorize` (Task 2).
- Produces: `useSetAiCategorize()` — a mutation taking `{ userId: string; enabled: boolean }`.

- [ ] **Step 1: Extend the profile query.** In `lib/queries.ts`, change the `Profile` type and its select:

```ts
export type Profile = { user_id: string; display_name: string; ai_categorize: boolean };
```
and in `useProfile`, change `.select('user_id, display_name')` to `.select('user_id, display_name, ai_categorize')`.

- [ ] **Step 2: Add the mutation,** after `useSetDisplayName`:

```ts
/**
 * The AI fallback switch (12b). Off by default: nothing reaches a model until
 * someone asks for it. Whether a herd may use it at all is decided server-side
 * in `aiAllowed`, never here.
 */
export function useSetAiCategorize() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ userId, enabled }: { userId: string; enabled: boolean }) => {
      const { error } = await supabase.from('profiles').update({ ai_categorize: enabled }).eq('user_id', userId);
      if (error) throw error;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
```

`['profile']` is the right key: `useProfile` uses `['profile', userId]`, and `useSetDisplayName` already invalidates the `['profile']` prefix the same way.

- [ ] **Step 3: Add the switch to Settings.** In `app/(tabs)/settings.tsx`, add `Switch` to the `react-native` import, add `Sparkles` to the `lucide-react-native` import, and add `useProfile, useSetAiCategorize` to the `@/lib/queries` import. Inside the component, add:

```tsx
  const { data: profile } = useProfile(session?.user.id);
  const setAiCategorize = useSetAiCategorize();
```

Then, inside the Categories `<Card>`, after the merchant-rules `<Pressable>`:

```tsx
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: Spacing.sm,
            paddingVertical: Spacing.xs,
          }}>
          <Sparkles size={20} color={colors.brand} strokeWidth={1.75} />
          <View style={{ flex: 1 }}>
            <AppText variant="label">Let AI sort the leftovers</AppText>
            <AppText variant="caption" tone="dim">
              Only for transactions nothing else could place. It sees the merchant, the amount and
              your bank&apos;s guess — never your balances, your accounts or who you are.
            </AppText>
          </View>
          <Switch
            value={profile?.ai_categorize ?? false}
            disabled={!session?.user.id || setAiCategorize.isPending}
            onValueChange={(enabled) => {
              if (session?.user.id) {
                setAiCategorize.mutate(
                  { userId: session.user.id, enabled },
                  { onError: () => Alert.alert('Could not change that', 'Check your connection and try again.') },
                );
              }
            }}
          />
        </View>
```

- [ ] **Step 4: Typecheck, lint, test**

Run (in `apps/mobile`): `npm run typecheck && npx expo lint && npm test`
Expected: no errors, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/queries.ts "apps/mobile/src/app/(tabs)/settings.tsx"
git commit -m "feat(app): a switch for the AI fallback, off by default (Phase 12b)"
```

---

### Task 5: Deploy, demo, and docs

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/ops/production.md`

- [ ] **Step 1: Ask Pedro to set the key.** `ANTHROPIC_API_KEY` must be added in the Supabase dashboard for dev (Edge Functions → Secrets). Do not proceed past Step 3 without it; Steps 1–4 of the other tasks all work without one.

- [ ] **Step 2: Deploy to dev**

Run: `npx supabase functions deploy --use-api`
Expected: every function deployed.

- [ ] **Step 3: Confirm the switch is off and nothing calls out**

Run: `npx -y supabase@2.118.0 db query --linked -o csv "select count(*) filter (where ai_categorize) as on_count, count(*) as total from profiles"`
Expected: `on_count` is 0 — nothing reaches a model until someone opts in.

- [ ] **Step 4: Demo on the emulator**
  1. Settings → Categories → turn on "Let AI sort the leftovers".
  2. Confirm it stuck: `npx -y supabase@2.118.0 db query --linked -o csv "select ai_categorize from profiles where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2'"` → `t`.
  3. Count the candidates first: `npx -y supabase@2.118.0 db query --linked -o csv "select count(*) from transactions where category_is_manual = false and category_source in ('plaid','fallback') and (pfc_confidence is null or pfc_confidence in ('LOW','UNKNOWN'))"`.
  4. Pull to refresh on Home to trigger a sync.
  5. `npx -y supabase@2.118.0 db query --linked -o csv "select count(*) from transactions where category_source = 'ai'"` → above 0.
  6. `npx -y supabase@2.118.0 db query --linked -o csv "select count(*) from ai_category_cache"` → above 0.
  7. Sync again and confirm the cache is doing its job: the second run should add few or no cache rows.
  8. `node scripts/emu.mjs logs` → no JS errors. Open a changed transaction: "Set by: AI".
  9. `node scripts/cat-quality.mjs` → an `ai` row appears.

- [ ] **Step 5: Docs**
  - **CLAUDE.md**, after the "Learning from fixes" bullet:
    ```markdown
    - **The AI fallback** (Phase 12b). Opt-in per user (`profiles.ai_categorize`, off by default) and
      only over rows nothing else could settle. `_shared/ai.ts` is pure except `askClaude`
      (`claude-haiku-4-5`, `messages.parse` with a Zod output format; no `effort`, no thinking —
      Haiku 4.5 rejects the first and does not need the second). `runAiPass` in `_shared/sync.ts`
      never throws: a missed category is not worth failing a sync over. `ai_category_cache` is GLOBAL
      and has no `herd_id` — the model sees only merchant text and built-in categories, so one answer
      serves every herd — but a private account's row is never cached. `aiAllowed()` is the single
      server-side seam a subscription check will occupy; AI is meant to be a subscriber feature.
      Needs the `ANTHROPIC_API_KEY` secret; without it the pass is skipped silently.
    ```
  - **README.md**: change the Phase 12 line to `  - ✅ **12b** — an opt-in AI pass over the transactions nothing else could place, with a shared answer cache` and leave 12c listed as next.
  - **docs/ops/production.md**, under Secrets: add ``ANTHROPIC_API_KEY`` to the list of secrets production needs, noting the AI pass is skipped without it.

- [ ] **Step 6: Final checks**

Run: `npx -y deno test --allow-env supabase/functions/_shared/`, then (in `apps/mobile`) `npm run typecheck && npx expo lint && npm test`, then `node scripts/rls-check.mjs`
Expected: everything PASS.

- [ ] **Step 7: Commit, then open the PR**

```bash
git add CLAUDE.md README.md docs/ops/production.md docs/superpowers/plans/2026-09-27-phase-12b-ai-fallback.md
git commit -m "docs: Phase 12b, the AI fallback"
git push -u origin pedro-12b
gh pr create --base master --title "Phase 12b: an opt-in AI pass over what nothing else could place" --body-file <file>
```
The PR body says what changed, how it was tested, the measured cost, and "After merge: `db push` on production, set `ANTHROPIC_API_KEY` there, and deploy all functions except plaid-sandbox". It ends with the Claude Code attribution line. Do not merge: Pedro merges.
