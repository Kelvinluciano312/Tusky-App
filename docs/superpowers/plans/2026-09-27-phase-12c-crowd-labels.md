# Phase 12c: crowd labels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When at least 3 people who opted in agree on a merchant's category at a given direction and amount band, every Tusky user gets that category on new transactions. The review card flags it as "Tusky guessed · from other Tusky users".

**Architecture:** Contributions are written by a `security definer` trigger on `transactions`, so neither the app nor any Edge Function ever names a contributor. The trigger fires when a user who has consented picks a category by hand or accepts a guess in review. A contributor is an HMAC of the user id, keyed with a pepper kept in Supabase Vault. The pool, `community_labels`, has no user, herd or account column and no client grants. Sync reads vote tallies through a service-role-only SQL function. A pure module, `_shared/crowd.ts`, turns the tallies into answers: at least 3 contributors, and at least 70% agreement. The answer feeds a new `community` slot in `resolveCategory`, between `learned` and `ai`. The amount bands move into `crowd.ts`, and 12b's cache key imports them from there, so the two stay one definition.

**Tech Stack:** Supabase Postgres (pgcrypto `extensions.hmac`, `vault.decrypted_secrets`), Deno Edge Functions, Expo React Native app (`@react-native-async-storage/async-storage`, already a dependency). App tests run with `node --test`, Edge tests with `deno test`.

**Spec:** `docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md`, section "12c: crowd labels". Read "The resolver" and 12b's revision note too.

## Decisions this plan makes where the spec is silent

These are for Pedro to confirm when reviewing the plan.

1. **Resolver order: `rule > learned > community > ai > plaid > fallback`.** This follows the spec's list. `ai` already sits above every Plaid code (12b's note in `categorize.ts`), so `community` goes directly above `ai`.
2. **A community answer is sticky, like an AI answer.** A row whose `category_source` is already `community` keeps that category through a Plaid modify (sync) and through a re-resolve (`planReresolve`). This does not stop the herd's own `rule` or `learned` from winning. Consequence: rows synced before a merchant reaches the threshold get the answer only when Plaid next sends them. There is no backfill sweep.
3. **Private-account rows never contribute.** This matches 12b, which keeps private rows out of the global AI cache.
4. **Only the user's own action contributes.** The contributor is `auth.uid()`. Service-role writes, such as a rule applied by `set-merchant-rule`, sync or `apply-learning`, have no `auth.uid()` and contribute nothing. Choosing "Always" therefore contributes only when the tapped row was also set by hand. The row the user tapped still counts through `once()`.
5. **"Uncategorized" never contributes.** A custom category contributes its group, as the spec says.
6. **Consent is written through one RPC, `set_consent(kind, granted)`.** The app can only read its own `consents` rows. Withdrawing marks the row withdrawn and deletes that user's contributions in one transaction. Consent history is kept: granting again inserts a new row. Deleting a user (a cascade from `auth.users`) also deletes their contributions.
7. **Lookup falls back from entity id to normalized name.** A row with a `merchant_entity_id` uses the entity's answer, and uses the `k:<merchant_key>` answer when the entity has none. A contribution is stored under the entity id if the row has one, otherwise under `k:<merchant_key>`, as the spec says.
8. **The one-time prompt counts fixes per device** in AsyncStorage, per user. The prompt is asked once. After that, the Settings switch is the only way in.
9. **The spec's `credit_ledger` check is dropped.** 12b removed the ledger. `rls-check` checks `consents` and `community_labels` instead.

## Global Constraints

- `community_labels` has **no** `user_id`, `herd_id` or `account_id` column, and **no** client grants. RLS is on with no policy, like `ai_category_cache`.
- `contributor = encode(extensions.hmac(user_id::text, <label_pepper>, 'sha256'), 'hex')`. The pepper is the Vault secret named exactly `label_pepper`. It is created by SQL on each project and **never** appears in the repo, a migration, chat or a log.
- `merchant = coalesce(merchant_entity_id, 'k:' || merchant_key)`. Both columns are treated as empty when `''`.
- Bands: [0, 5), [5, 15), [15, 50), [50, 150), [150, 500), 500+ → `0..5`, on the absolute amount. Direction: `amount > 0` is `in`, anything else (including 0) is `out`. The SQL twin `private.amount_band` must agree with `amountBand` in `_shared/crowd.ts`. Change them together.
- The table is unique on `(contributor, merchant, direction, amount_band)`. The latest choice wins (upsert).
- Serve a band only at **≥ 3 contributors and ≥ 70% agreement**. Below 3, nothing is served.
- The contribution trigger **never** blocks the user's change. Every failure, including a missing pepper, is caught and raised only as a `warning`.
- A contribution's `category_id` is always built-in: a custom category contributes its `parent_id`.
- `cacheKeyFor` output (12b) must not change byte-for-byte. Live cache rows are keyed by it.
- Loading community tallies in sync never fails a sync. On error, log and treat as no answers.
- New tables need RLS and explicit grants. New functions in `private` get `revoke execute … from public`. New functions in `public` get explicit `grant execute`.
- App pure logic: `npm test`, with `/// <reference types="node" />` at the top of each test, importing only `import type` or relative `./x.ts` paths.
- Edge logic: `npx -y deno test supabase/functions/_shared/`.
- `npm run typecheck && npx expo lint` in `apps/mobile` before every app commit. Run `node scripts/rls-check.mjs` after the migration.
- Branch `pedro-12c`, from `origin/master`. Never commit to master. Open a PR and never merge it: Pedro merges.
- Production: `db push`, the pepper and function deploys each wait for Pedro's go-ahead, and each names `--project-ref awiwcgrisyzimzxgddxu`.

## Review Focus

1. **The pepper is missing on a project.** A user's category fix must still save, with no contribution and no error in the app. (Task 4: `fix_without_pepper` probe.)
2. **One bank sends an entity id for a merchant and another does not.** The row with the entity id must still get the name-keyed crowd answer when the entity has none. (Task 1: `communityCategory` fallback test.)
3. **A user fixes a row into a custom category.** The pool must record the custom category's built-in group, never the custom id, which would mean nothing to another herd. (Task 4: `crowd_custom_is_group` probe.)
4. **An amount exactly on a band edge ($5.00, $500.00, a $0 row).** SQL and TypeScript must put it in the same band, or tallies are read from the wrong bucket. (Task 1 edge tests, and Task 3's parity query.)
5. **Withdraw, then opt in again.** Withdrawing must delete every contribution. Granting again must succeed despite the old consent row: the partial unique index, not a plain one. (Task 4: `crowd_withdraw_forgets` and `crowd_regrant` probes.)

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/functions/_shared/crowd.ts` (new) | Pure: `CROWD` thresholds, `amountBand`, `directionOf`, `crowdMerchants`, `crowdKey`, `communityAnswers`, `communityCategory` |
| `supabase/functions/_shared/crowd.test.ts` (new) | Its tests |
| `supabase/functions/_shared/ai.ts` | `cacheKeyFor` takes its band from `crowd.ts` (no behaviour change) |
| `supabase/functions/_shared/categorize.ts` | `community` source in `resolveCategory` |
| `supabase/functions/_shared/rules.ts` | `planReresolve` keeps a community answer |
| `supabase/functions/_shared/sync.ts` | `loadCommunity`; the `community` source in `syncItem` |
| `supabase/migrations/20261006120000_phase12c_crowd_labels.sql` (new) | `consents`, `community_labels`, band and contributor helpers, the contribution trigger, `set_consent`, `community_tallies` |
| `scripts/rls-check.mjs` | Crowd probes |
| `apps/mobile/src/lib/queries.ts` | `useCrowdConsent`, `useSetCrowdConsent` |
| `apps/mobile/src/app/(tabs)/settings.tsx` | The switch |
| `apps/mobile/src/lib/crowd-prompt.ts` (new) + `.test.ts` | Pure: when the one-time prompt is due |
| `apps/mobile/src/hooks/use-crowd-prompt.ts` (new) | Stores the fix count and shows the prompt |
| `apps/mobile/src/hooks/use-category-choice.ts` | Counts a fix |
| `docs/ops/production.md`, `CLAUDE.md`, the spec, a handoff | Docs |

---

### Task 0: Branch

- [ ] **Step 1:** `git fetch origin && git switch -c pedro-12c origin/master`
- [ ] **Step 2:** Copy this plan onto the branch (it was written on master's working tree), then run `git add docs/superpowers/plans/2026-09-27-phase-12c-crowd-labels.md && git commit -m "docs: Phase 12c implementation plan"`, with the Co-Authored-By trailer.

---

### Task 1: `crowd.ts` — bands, merchants and the threshold

**Files:**
- Create: `supabase/functions/_shared/crowd.ts`
- Create: `supabase/functions/_shared/crowd.test.ts`
- Modify: `supabase/functions/_shared/ai.ts` (remove `BANDS`/`bandOf`; import `amountBand`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const CROWD = { MIN_CONTRIBUTORS: 3, MIN_SHARE: 0.7 }`
  - `amountBand(amount: number): number` (0..5)
  - `directionOf(amount: number): 'in' | 'out'`
  - `crowdMerchants(entityId: string | null | undefined, merchantKey: string): string[]` (most specific first, may be empty)
  - `type Tally = { merchant: string; direction: 'in' | 'out'; amount_band: number; category_id: string; votes: number }`
  - `crowdKey(merchant: string, direction: 'in' | 'out', band: number): string`
  - `communityAnswers(tallies: Tally[]): Map<string, string>` (crowdKey → category_id)
  - `communityCategory(answers: Map<string, string>, entityId: string | null | undefined, merchantKey: string, amount: number): string | null`

- [ ] **Step 1: Write the failing tests** in `crowd.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert';

import {
  amountBand,
  communityAnswers,
  communityCategory,
  crowdKey,
  crowdMerchants,
  directionOf,
  type Tally,
} from './crowd.ts';

Deno.test('amountBand puts each edge in the band above it, by magnitude', () => {
  assertEquals(amountBand(0), 0);
  assertEquals(amountBand(-4.99), 0);
  assertEquals(amountBand(-5), 1);
  assertEquals(amountBand(14.99), 1);
  assertEquals(amountBand(15), 2);
  assertEquals(amountBand(-50), 3);
  assertEquals(amountBand(150), 4);
  assertEquals(amountBand(-499.99), 4);
  assertEquals(amountBand(500), 5);
  assertEquals(amountBand(-12000), 5);
});

Deno.test('directionOf: only a positive amount is money in', () => {
  assertEquals(directionOf(12), 'in');
  assertEquals(directionOf(-12), 'out');
  assertEquals(directionOf(0), 'out');
});

Deno.test('crowdMerchants tries the entity id first, then the normalized name', () => {
  assertEquals(crowdMerchants('ent_1', 'shell'), ['ent_1', 'k:shell']);
  assertEquals(crowdMerchants(null, 'shell'), ['k:shell']);
  assertEquals(crowdMerchants('', 'shell'), ['k:shell']);
  // A name with no letters has an empty key and matches nobody else's.
  assertEquals(crowdMerchants(null, ''), []);
  assertEquals(crowdMerchants('ent_1', ''), ['ent_1']);
});

const t = (category_id: string, votes: number, over: Partial<Tally> = {}): Tally => ({
  merchant: 'k:shell', direction: 'out', amount_band: 2, category_id, votes, ...over,
});

Deno.test('communityAnswers serves a band only at 3 contributors and 70% agreement', () => {
  const key = crowdKey('k:shell', 'out', 2);
  // 3 of 3: served.
  assertEquals(communityAnswers([t('gas', 3)]).get(key), 'gas');
  // 2 contributors, even unanimous: never served — one person's label must not show through.
  assertEquals(communityAnswers([t('gas', 2)]).has(key), false);
  // 2 of 3 is 67%: below the bar.
  assertEquals(communityAnswers([t('gas', 2), t('snacks', 1)]).has(key), false);
  // 7 of 10 is exactly 70%: served.
  assertEquals(communityAnswers([t('gas', 7), t('snacks', 3)]).get(key), 'gas');
  // A tie never wins.
  assertEquals(communityAnswers([t('gas', 3), t('snacks', 3)]).has(key), false);
});

Deno.test('communityAnswers keeps bands and directions apart', () => {
  const answers = communityAnswers([
    t('snacks', 3, { amount_band: 0 }),
    t('gas', 3, { amount_band: 2 }),
    t('refund', 3, { direction: 'in', amount_band: 2 }),
  ]);
  assertEquals(answers.get(crowdKey('k:shell', 'out', 0)), 'snacks');
  assertEquals(answers.get(crowdKey('k:shell', 'out', 2)), 'gas');
  assertEquals(answers.get(crowdKey('k:shell', 'in', 2)), 'refund');
});

Deno.test('communityCategory falls back to the name when the entity id has no answer', () => {
  const answers = communityAnswers([t('gas', 3)]);
  assertEquals(communityCategory(answers, 'ent_unknown', 'shell', -22), 'gas');
  // The entity's own answer wins when it has one.
  const both = communityAnswers([t('gas', 3), t('fuel', 3, { merchant: 'ent_1' })]);
  assertEquals(communityCategory(both, 'ent_1', 'shell', -22), 'fuel');
  // Wrong band, wrong direction, blank merchant: nothing.
  assertEquals(communityCategory(answers, null, 'shell', -3), null);
  assertEquals(communityCategory(answers, null, 'shell', 22), null);
  assertEquals(communityCategory(answers, null, '', -22), null);
});
```

- [ ] **Step 2:** Run `npx -y deno test supabase/functions/_shared/crowd.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `crowd.ts`:**

```ts
/**
 * Crowd labels (Phase 12c). Pure: callers load the tallies.
 *
 * Users who opt in contribute their category choices to a shared pool
 * (community_labels), keyed by merchant, direction and amount band and never by
 * who they are. A band is served to everyone only once enough distinct people
 * agree, so no single person's choice is ever visible through another user's
 * category.
 */

export const CROWD = {
  /** Fewer distinct contributors than this in a band serve nothing. */
  MIN_CONTRIBUTORS: 3,
  /** The winning category's share of the band's contributors. */
  MIN_SHARE: 0.7,
} as const;

/**
 * Amount band edges, on the absolute amount: [0,5) [5,15) [15,50) [50,150)
 * [150,500) 500+. Shared with 12b's AI cache key. The SQL twin is
 * private.amount_band: change both together.
 */
const BANDS = [5, 15, 50, 150, 500];

export function amountBand(amount: number): number {
  const magnitude = Math.abs(amount);
  const index = BANDS.findIndex((edge) => magnitude < edge);
  return index === -1 ? BANDS.length : index;
}

export function directionOf(amount: number): 'in' | 'out' {
  return amount > 0 ? 'in' : 'out';
}

/**
 * The pool keys a row can match, most specific first: Plaid's entity id, then
 * the normalized name. Entity ids are sparse, so the name is the common case.
 */
export function crowdMerchants(entityId: string | null | undefined, merchantKey: string): string[] {
  const out: string[] = [];
  if (entityId) out.push(entityId);
  if (merchantKey) out.push(`k:${merchantKey}`);
  return out;
}

export type Tally = {
  merchant: string;
  direction: 'in' | 'out';
  amount_band: number;
  category_id: string;
  /** Distinct contributors: the pool holds one row per contributor and band. */
  votes: number;
};

export function crowdKey(merchant: string, direction: 'in' | 'out', band: number): string {
  return `${merchant}|${direction}|${band}`;
}

/** The bands the crowd agrees on, as crowdKey → category id. */
export function communityAnswers(tallies: Tally[]): Map<string, string> {
  const byKey = new Map<string, { total: number; best: string | null; most: number; tied: boolean }>();
  for (const t of tallies) {
    const key = crowdKey(t.merchant, t.direction, t.amount_band);
    const s = byKey.get(key) ?? { total: 0, best: null, most: 0, tied: false };
    s.total += t.votes;
    if (t.votes > s.most) Object.assign(s, { best: t.category_id, most: t.votes, tied: false });
    else if (t.votes === s.most) s.tied = true;
    byKey.set(key, s);
  }
  const answers = new Map<string, string>();
  for (const [key, s] of byKey) {
    if (s.best && !s.tied && s.total >= CROWD.MIN_CONTRIBUTORS && s.most >= CROWD.MIN_SHARE * s.total) {
      answers.set(key, s.best);
    }
  }
  return answers;
}

/** The crowd's category for one row, or null. */
export function communityCategory(
  answers: Map<string, string>,
  entityId: string | null | undefined,
  merchantKey: string,
  amount: number,
): string | null {
  const direction = directionOf(amount);
  const band = amountBand(amount);
  for (const merchant of crowdMerchants(entityId, merchantKey)) {
    const hit = answers.get(crowdKey(merchant, direction, band));
    if (hit) return hit;
  }
  return null;
}
```

- [ ] **Step 4: Point `ai.ts` at the shared bands.** In `supabase/functions/_shared/ai.ts`, delete the `BANDS` constant (with its comment) and the `bandOf` function. Add `import { amountBand } from './crowd.ts';` below the zod imports. In `cacheKeyFor`, replace `${bandOf(row.amount)}` with `${amountBand(row.amount)}`. The output string is identical, because `String(n)` and a template interpolation of a number match.

- [ ] **Step 5:** Run `npx -y deno test supabase/functions/_shared/`. Expected: all PASS, including the existing `ai.test.ts` `cacheKeyFor` tests unchanged.

- [ ] **Step 6: Commit:** `git add supabase/functions/_shared/crowd.ts supabase/functions/_shared/crowd.test.ts supabase/functions/_shared/ai.ts && git commit -m "feat(sync): crowd label bands, merchants and threshold (Phase 12c)"`

---

### Task 2: A `community` slot in the resolver

**Files:**
- Modify: `supabase/functions/_shared/categorize.ts` (`resolveCategory`)
- Modify: `supabase/functions/_shared/categorize.test.ts`
- Modify: `supabase/functions/_shared/rules.ts` (`planReresolve`)
- Modify: `supabase/functions/_shared/rules.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `resolveCategory(sources: { rule?, learned?, community?: string | null, ai?, detailed?, primary? }, maps, fallbackId)`. The order is `rule > learned > community > ai > plaid > fallback`. `planReresolve` passes `community: row.category_source === 'community' ? row.category_id : null`.

- [ ] **Step 1: Write the failing tests.** Append to `categorize.test.ts`:

```ts
Deno.test('resolveCategory precedence around community: learned > community > ai > plaid', () => {
  const plaid = { detailed: 'FOOD_AND_DRINK_COFFEE', primary: 'FOOD_AND_DRINK' };
  assertEquals(
    resolveCategory({ rule: 'cat-rule', community: 'cat-crowd', ...plaid }, MAPS, FALLBACK),
    { categoryId: 'cat-rule', source: 'rule' },
  );
  assertEquals(
    resolveCategory({ learned: 'cat-learned', community: 'cat-crowd', ...plaid }, MAPS, FALLBACK),
    { categoryId: 'cat-learned', source: 'learned' },
  );
  assertEquals(
    resolveCategory({ community: 'cat-crowd', ai: 'cat-ai', ...plaid }, MAPS, FALLBACK),
    { categoryId: 'cat-crowd', source: 'community' },
  );
  assertEquals(
    resolveCategory({ community: 'cat-crowd', ...plaid }, MAPS, FALLBACK),
    { categoryId: 'cat-crowd', source: 'community' },
  );
  assertEquals(resolveCategory({ community: 'cat-crowd' }, MAPS, FALLBACK), { categoryId: 'cat-crowd', source: 'community' });
  // A null community answer is no answer.
  assertEquals(resolveCategory({ community: null, ...plaid }, MAPS, FALLBACK), { categoryId: 'cat-coffee', source: 'plaid' });
});
```

Append to `rules.test.ts`. It uses that file's existing `row(id, pfc_detailed, pfc_primary, category_id, category_source)` helper and `MAPS`:

```ts
Deno.test('planReresolve keeps a community answer, but the herd\'s own rule still wins', () => {
  const crowdRow = row('r-crowd', 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', 'TRANSPORTATION', 'cat-crowd', 'community');
  // No rule, no labels: the crowd's answer stands, even over a confident Plaid code.
  assertEquals(planReresolve([crowdRow], null, [], MAPS, 'cat-none'), []);
  // A rule outranks it.
  assertEquals(planReresolve([crowdRow], 'cat-rule', [], MAPS, 'cat-none'), [
    { category_id: 'cat-rule', category_source: 'rule', ids: ['r-crowd'] },
  ]);
});
```

- [ ] **Step 2:** Run `npx -y deno test supabase/functions/_shared/categorize.test.ts supabase/functions/_shared/rules.test.ts`. Expected: FAIL. `community` is ignored, and the crowd row falls to Plaid.

- [ ] **Step 3: Implement.** In `categorize.ts`, add `community?: string | null;` to the `sources` type, after `learned`, with the doc comment `/** The crowd's answer (12c), or one it already gave this row. */`. Add this after the `learned` line:

```ts
  if (sources.community) return { categoryId: sources.community, source: 'community' };
```

Replace the doc comment's sentence "12c slots `community` in here." with: "then the crowd's answer (12c), ".

In `rules.ts` `planReresolve`, after the `learned:` line, add:

```ts
        // A crowd answer stands, like an AI one: re-resolving must not take back
        // a category the user was already shown. The herd's own rule or fixes
        // still outrank it.
        community: row.category_source === 'community' ? row.category_id : null,
```

- [ ] **Step 4:** Run `npx -y deno test supabase/functions/_shared/`. Expected: all PASS.

- [ ] **Step 5: Commit:** `git add supabase/functions/_shared/categorize.ts supabase/functions/_shared/categorize.test.ts supabase/functions/_shared/rules.ts supabase/functions/_shared/rules.test.ts && git commit -m "feat(sync): the resolver's community source, above ai and Plaid (Phase 12c)"`

---

### Task 3: The migration — consent, the pool, and the contribution trigger

**Files:**
- Create: `supabase/migrations/20261006120000_phase12c_crowd_labels.sql`

**Interfaces:**
- Produces:
  - Tables `public.consents`, `public.community_labels`
  - `private.amount_band(numeric) → smallint`
  - `private.label_contributor(uuid) → text` (null without a pepper)
  - `private.forget_crowd_labels(uuid)`
  - `public.set_consent(p_kind text, p_granted boolean) → void` (authenticated)
  - `public.community_tallies(p_merchants text[]) → table (merchant text, direction text, amount_band smallint, category_id uuid, votes int)` (service_role only)
  - Trigger `ae_transactions_crowd_label`

- [ ] **Step 1: Write the migration:**

```sql
-- Phase 12c: crowd labels. Users who opt in contribute their category choices
-- to a shared pool; a merchant's band is served to everyone once 3 distinct
-- contributors agree at 70%. The pool holds no user, herd or account: a
-- contributor is an HMAC of the user id under a pepper kept in Vault
-- ('label_pepper', created by SQL per project, never in the repo), which gives
-- one vote per person and lets withdrawal find their rows.
-- See docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md.

-- ── Consent ────────────────────────────────────────────────────────────────
-- A record, not a flag: granting again after a withdrawal adds a row.
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('crowd_labels')),
  granted_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
create unique index consents_one_active on public.consents (user_id, kind) where withdrawn_at is null;

alter table public.consents enable row level security;
create policy consents_own_select on public.consents
  for select to authenticated using (user_id = (select auth.uid()));
-- Reads only: every write goes through set_consent, so withdrawing and
-- forgetting happen in one transaction.
grant select on public.consents to authenticated;

-- ── The pool ───────────────────────────────────────────────────────────────
create table public.community_labels (
  contributor text not null,
  -- Plaid's merchant_entity_id, or 'k:' || merchant_key.
  merchant text not null,
  direction text not null check (direction in ('in', 'out')),
  -- private.amount_band / amountBand in _shared/crowd.ts.
  amount_band smallint not null check (amount_band between 0 and 5),
  -- Plaid's guess beside the person's choice, for measuring.
  pfc_detailed text,
  -- Always built-in: a custom category contributes its group.
  category_id uuid not null references public.categories (id) on delete cascade,
  created_on date not null default current_date,
  primary key (contributor, merchant, direction, amount_band)
);
create index community_labels_merchant on public.community_labels (merchant);

-- RLS on with no policy and no grants: deny-all to every client, reachable only
-- by service_role and by the security definer functions below.
alter table public.community_labels enable row level security;

-- ── Helpers ────────────────────────────────────────────────────────────────
-- SQL twin of amountBand in _shared/crowd.ts: change both together.
create function private.amount_band(p_amount numeric)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case
    when abs(p_amount) < 5 then 0
    when abs(p_amount) < 15 then 1
    when abs(p_amount) < 50 then 2
    when abs(p_amount) < 150 then 3
    when abs(p_amount) < 500 then 4
    else 5
  end::smallint
$$;

-- Null when the pepper is missing: callers then contribute and forget nothing.
create function private.label_contributor(p_user uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select encode(extensions.hmac(p_user::text, s.decrypted_secret, 'sha256'), 'hex')
  from vault.decrypted_secrets s
  where s.name = 'label_pepper'
$$;

create function private.forget_crowd_labels(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.community_labels where contributor = private.label_contributor(p_user)
$$;

revoke execute on function private.amount_band(numeric) from public;
revoke execute on function private.label_contributor(uuid) from public;
revoke execute on function private.forget_crowd_labels(uuid) from public;

-- ── Contributing ───────────────────────────────────────────────────────────
-- After a user's own choice: a category picked or changed by hand, or a guess
-- accepted in review. Only the acting user (auth.uid()) contributes, so
-- service-role writes (sync, rules, apply-learning) never do. Nothing here may
-- block the user's change: every failure is a warning.
create function private.contribute_crowd_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  who text;
  merchant text;
  cat uuid;
begin
  begin
    if uid is null then return null; end if;
    if not (
      (new.category_is_manual
        and (not old.category_is_manual or new.category_id is distinct from old.category_id))
      or (old.reviewed_at is null and new.reviewed_at is not null
        and new.category_source in ('learned', 'community', 'ai'))
    ) then
      return null;
    end if;
    if not exists (
      select 1 from public.consents c
      where c.user_id = uid and c.kind = 'crowd_labels' and c.withdrawn_at is null
    ) then
      return null;
    end if;
    -- Which merchants someone keeps private is not a fact the crowd gets to learn.
    if exists (select 1 from public.accounts a where a.id = new.account_id and a.is_private) then
      return null;
    end if;
    merchant := coalesce(nullif(new.merchant_entity_id, ''), 'k:' || nullif(new.merchant_key, ''));
    if merchant is null then return null; end if;
    select case when c.herd_id is null then c.id else c.parent_id end into cat
      from public.categories c where c.id = new.category_id;
    if cat is null or exists (
      select 1 from public.categories c where c.id = cat and c.slug = 'uncategorized'
    ) then
      return null;
    end if;
    who := private.label_contributor(uid);
    if who is null then return null; end if;

    insert into public.community_labels
      (contributor, merchant, direction, amount_band, pfc_detailed, category_id, created_on)
    values
      (who, merchant, case when new.amount > 0 then 'in' else 'out' end,
       private.amount_band(new.amount), new.pfc_detailed, cat, current_date)
    on conflict (contributor, merchant, direction, amount_band) do update
      set category_id = excluded.category_id,
          pfc_detailed = excluded.pfc_detailed,
          created_on = excluded.created_on;
  exception when others then
    raise warning 'crowd label skipped: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function private.contribute_crowd_label() from public;

-- "ae_": after ad_transactions_category_source has stamped the source.
create trigger ae_transactions_crowd_label
  after update of category_id, category_is_manual, reviewed_at on public.transactions
  for each row execute function private.contribute_crowd_label();

-- Deleting a user cascades their consents; their contributions go with them.
create function private.consents_forget_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.forget_crowd_labels(old.user_id);
  return null;
end;
$$;
revoke execute on function private.consents_forget_on_delete() from public;

create trigger consents_forget_on_delete
  after delete on public.consents
  for each row execute function private.consents_forget_on_delete();

-- ── The app's one write ────────────────────────────────────────────────────
create function public.set_consent(p_kind text, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not signed in'; end if;
  if p_kind is distinct from 'crowd_labels' then raise exception 'unknown consent kind'; end if;
  if p_granted then
    insert into public.consents (user_id, kind) values (uid, p_kind)
      on conflict (user_id, kind) where withdrawn_at is null do nothing;
  else
    update public.consents set withdrawn_at = now()
      where user_id = uid and kind = p_kind and withdrawn_at is null;
    perform private.forget_crowd_labels(uid);
  end if;
end;
$$;

revoke execute on function public.set_consent(text, boolean) from public, anon;
grant execute on function public.set_consent(text, boolean) to authenticated;

-- ── Reading, server-only ───────────────────────────────────────────────────
-- Votes per band and category for these merchants. The threshold is applied in
-- _shared/crowd.ts (communityAnswers), where it is tested.
create function public.community_tallies(p_merchants text[])
returns table (merchant text, direction text, amount_band smallint, category_id uuid, votes int)
language sql
stable
set search_path = ''
as $$
  select l.merchant, l.direction, l.amount_band, l.category_id, count(*)::int
  from public.community_labels l
  where l.merchant = any (p_merchants)
  group by 1, 2, 3, 4
$$;

revoke execute on function public.community_tallies(text[]) from public, anon, authenticated;
grant execute on function public.community_tallies(text[]) to service_role;
```

- [ ] **Step 2: Create the dev pepper.** Run this once, on dev only. The CLI is linked to dev. Check first with `cat supabase/.temp/project-ref`, which must print `ifibrsgqdibcomzxencf`:

```sh
npx -y supabase@2.118.0 db query --linked -o csv "select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'label_pepper', 'HMAC pepper for community_labels.contributor (Phase 12c)') is not null as created"
```

Expected: `created` `t`. Never print the secret.

- [ ] **Step 3:** `npx -y supabase@2.118.0 db push`. Expected: applies `20261006120000_phase12c_crowd_labels.sql`.

- [ ] **Step 4: Check the band twin and the pepper:**

```sh
npx -y supabase@2.118.0 db query --linked -o csv "select string_agg(private.amount_band(x)::text, ',' order by o) as bands, (private.label_contributor('00000000-0000-0000-0000-000000000000') is not null) as pepper_ok from unnest(array[0, -4.99, -5, 14.99, 15, -50, 150, -499.99, 500, -12000]::numeric[]) with ordinality as u(x, o)"
```

Expected: `bands` = `0,0,1,1,2,3,4,4,5,5`, the same sequence as Task 1's `amountBand` test, and `pepper_ok` = `t`.

- [ ] **Step 5: Commit:** `git add supabase/migrations/20261006120000_phase12c_crowd_labels.sql && git commit -m "feat(db): consent, the crowd label pool and its contribution trigger (Phase 12c)"`

---

### Task 4: Prove it in `rls-check.mjs`

**Files:**
- Modify: `scripts/rls-check.mjs`

- [ ] **Step 1: Declare the probe variables.** Add these to the `declare` list, after `budgets_before int;`:

```sql
  crowd_cat uuid;
  crowd_expected boolean;
  custom_cat uuid;
```

- [ ] **Step 2: Keep `other_cat` off "uncategorized"**, which never contributes. In the existing `select c.id into other_cat …` add `and c.slug is distinct from 'uncategorized'` to its `where`.

- [ ] **Step 3: Add the crowd section**, directly before the final `reset role;`, the one followed by the Phase 13 "as the admin again" check. It runs as the user, switches to admin to inspect the pool, and switches back:

```sql
  -- Phase 12c: the pool and consents are nobody's to read, and consent is your own.
  begin
    perform 1 from public.community_labels limit 1;
    w := w || jsonb_build_object('read_community_labels', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('read_community_labels', 'denied');
  end;
  begin
    perform public.community_tallies(array['k:test']);
    w := w || jsonb_build_object('call_community_tallies', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('call_community_tallies', 'denied');
  end;
  begin
    insert into public.consents (user_id, kind) values (u, 'crowd_labels');
    w := w || jsonb_build_object('insert_consent_directly', 'allowed');
  exception when insufficient_privilege then
    w := w || jsonb_build_object('insert_consent_directly', 'denied');
  end;
  if mate is not null then
    w := w || jsonb_build_object('mates_consents_visible',
      (select count(*) from public.consents where user_id = mate));
  end if;
  perform public.set_consent('crowd_labels', true);
  w := w || jsonb_build_object('own_consent_granted',
    (select count(*) = 1 from public.consents where user_id = u and withdrawn_at is null));
  if auto_tx is not null then
    select c.id into crowd_cat from public.categories c
      where c.herd_id is null and c.parent_id is null and c.slug is distinct from 'uncategorized'
        and c.id is distinct from (select category_id from public.transactions where id = auto_tx)
      order by c.id desc limit 1;
    update public.transactions set category_id = crowd_cat, category_is_manual = true where id = auto_tx;
    reset role;
    -- Contributes unless the row's account is private or its merchant is blank.
    select not a.is_private and coalesce(nullif(t.merchant_entity_id, ''), nullif(t.merchant_key, '')) is not null
      into crowd_expected
      from public.transactions t join public.accounts a on a.id = t.account_id where t.id = auto_tx;
    w := w || jsonb_build_object('crowd_contributed_as_expected',
      (select count(*) > 0 from public.community_labels
         where contributor = private.label_contributor(u) and category_id = crowd_cat) = crowd_expected);
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    -- A custom category contributes its group, never its own id.
    insert into public.categories (name, parent_id, icon, color)
      values ('RLS crowd probe', crowd_cat, 'tag', '#888888') returning id into custom_cat;
    update public.transactions set category_id = custom_cat where id = auto_tx;
    reset role;
    w := w || jsonb_build_object('crowd_custom_is_group',
      not exists (select 1 from public.community_labels where category_id = custom_cat));
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
  end if;
  -- Withdrawing forgets everything this user contributed; granting again works.
  perform public.set_consent('crowd_labels', false);
  perform public.set_consent('crowd_labels', true);
  w := w || jsonb_build_object('crowd_regrant',
    (select count(*) = 2 from public.consents where user_id = u));
  perform public.set_consent('crowd_labels', false);
  reset role;
  w := w || jsonb_build_object('crowd_withdraw_forgets',
    not exists (select 1 from public.community_labels where contributor = private.label_contributor(u)));
  -- A missing pepper must never block a fix. Only when this login may touch the
  -- vault; otherwise the probe is left out (and so not checked).
  if auto_tx is not null then
    begin
      delete from vault.secrets where name = 'label_pepper';
      perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      perform public.set_consent('crowd_labels', true);
      begin
        update public.transactions set category_id = other_cat where id = auto_tx;
        w := w || jsonb_build_object('fix_without_pepper', 'allowed');
      exception when others then
        w := w || jsonb_build_object('fix_without_pepper', 'denied');
      end;
      reset role;
    exception when insufficient_privilege then
      reset role;
    end;
  end if;
```

If `categories` needs other columns on insert, adjust the probe insert to match what the app's `useCreateCategory` sends. Check `apps/mobile/src/lib/queries.ts`, `useCreateCategory`. The `crowd_regrant` count of 2 assumes the user had no consent rows before the block. If one of the test users has opted in on dev, compare against their count before the block instead.

- [ ] **Step 4: Expect the results.** Add to `WRITE_EXPECT`:

```js
  read_community_labels: 'denied',
  call_community_tallies: 'denied',
  insert_consent_directly: 'denied',
  mates_consents_visible: 0,
  own_consent_granted: true,
  crowd_contributed_as_expected: true,
  crowd_custom_is_group: true,
  crowd_regrant: true,
  crowd_withdraw_forgets: true,
  fix_without_pepper: 'allowed',
```

`mates_consents_visible` is only meaningful when the mate has a consent row. Before the role switch (where `mate` is selected, as admin), add `if mate is not null then insert into public.consents (user_id, kind) values (mate, 'crowd_labels') on conflict do nothing; end if;`. The block rolls back.

- [ ] **Step 5:** Run `node scripts/rls-check.mjs`. Expected: `all PASS`. Then run `node scripts/rls-check.mjs --join <kel> <pedro>` with the two test user ids. Expected: `all PASS`. If `fix_without_pepper` is absent from the output, the login cannot touch the vault. Say so in the handoff. The trigger's exception block is then covered by review only.

- [ ] **Step 6: Commit:** `git add scripts/rls-check.mjs && git commit -m "test(rls): the crowd pool is server-only and consent is yours (Phase 12c)"`

---

### Task 5: Sync serves the crowd

**Files:**
- Modify: `supabase/functions/_shared/sync.ts`
- Modify: `supabase/functions/_shared/sync.test.ts`

**Interfaces:**
- Consumes: `communityAnswers`, `communityCategory`, `crowdMerchants`, `type Tally` (Task 1); `community` source (Task 2); `community_tallies` (Task 3).
- Produces: `loadCommunity(admin: SupabaseClient, merchants: string[]): Promise<Map<string, string>>`. It never throws.

- [ ] **Step 1: Test `loadCommunity`'s contract.** Append to `sync.test.ts` (import `loadCommunity` from `./sync.ts`, and `type SupabaseClient` from `npm:@supabase/supabase-js@2` if not already imported):

```ts
Deno.test('loadCommunity never throws: a failed read means no crowd answers', async () => {
  const admin = { rpc: () => Promise.resolve({ data: null, error: { message: 'boom' } }) } as unknown as SupabaseClient;
  assertEquals((await loadCommunity(admin, ['k:shell'])).size, 0);
});

Deno.test('loadCommunity applies the threshold to what the database tallied', async () => {
  const admin = {
    rpc: () => Promise.resolve({
      data: [{ merchant: 'k:shell', direction: 'out', amount_band: 2, category_id: 'gas', votes: 3 }],
      error: null,
    }),
  } as unknown as SupabaseClient;
  assertEquals((await loadCommunity(admin, ['k:shell'])).get('k:shell|out|2'), 'gas');
});
```

Run `npx -y deno test supabase/functions/_shared/sync.test.ts`. Expected: FAIL, `loadCommunity` is not exported.

- [ ] **Step 2: Implement `loadCommunity`** in `sync.ts`, below `loadLabels`:

```ts
/**
 * Merchants per community_tallies call. Each returns at most 12 bands
 * (6 bands × 2 directions) × the categories voted for, so 25 stays well under
 * PostgREST's max_rows (1000), which would otherwise cut the answer silently.
 */
const CROWD_MERCHANT_CHUNK = 25;

/**
 * The crowd's answers (12c) for these pool merchants, as crowdKey → category.
 * Never throws: the crowd is a bonus, and a sync is never worth failing over it.
 */
export async function loadCommunity(
  admin: SupabaseClient,
  merchants: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(merchants.filter(Boolean))];
  const tallies: Tally[] = [];
  try {
    for (let i = 0; i < unique.length; i += CROWD_MERCHANT_CHUNK) {
      const { data, error } = await admin.rpc('community_tallies', {
        p_merchants: unique.slice(i, i + CROWD_MERCHANT_CHUNK),
      });
      if (error) throw new Error(error.message);
      tallies.push(...((data ?? []) as Tally[]));
    }
  } catch (err) {
    console.warn(`crowd labels skipped: ${describeError(err)}`);
    return new Map();
  }
  return communityAnswers(tallies);
}
```

Add the import: `import { communityAnswers, communityCategory, crowdMerchants, type Tally } from './crowd.ts';`.

- [ ] **Step 3: Wire it into `syncItem`.** Directly after the `labelsByMerchant` line, add:

```ts
      // What the crowd agrees on (12c) for the merchants in this batch.
      const communityByKey = await loadCommunity(
        admin,
        upserts.flatMap((t) => crowdMerchants(t.merchant_entity_id, merchantKeyOf(t))),
      );
```

In the `resolveCategory` sources object, between `learned:` and `ai:`, add:

```ts
              // The crowd (12c). An answer it already gave this row stands, like an AI one.
              community: existing?.category_source === 'community'
                ? existing.category_id
                : communityCategory(communityByKey, t.merchant_entity_id, merchantKey, toSignedAmount(t.amount)),
```

- [ ] **Step 4:** Run `npx -y deno test supabase/functions/_shared/` and `npx -y deno check supabase/functions/plaid-sync-transactions/index.ts supabase/functions/plaid-webhook/index.ts supabase/functions/apply-learning/index.ts supabase/functions/set-merchant-rule/index.ts`. Expected: all PASS, no type errors.

- [ ] **Step 5: Deploy to dev:** `npx -y supabase@2.118.0 functions deploy plaid-sync-transactions plaid-webhook apply-learning set-merchant-rule --use-api`. All four import `_shared`, which changed.

- [ ] **Step 6: Commit:** `git add supabase/functions/_shared/sync.ts supabase/functions/_shared/sync.test.ts && git commit -m "feat(sync): new transactions take the crowd's category (Phase 12c)"`

---

### Task 6: The Settings switch

**Files:**
- Modify: `apps/mobile/src/lib/queries.ts`
- Modify: `apps/mobile/src/app/(tabs)/settings.tsx`

**Interfaces:**
- Produces: `useCrowdConsent(userId: string | undefined)` → `UseQueryResult<boolean>` (key `['consent', 'crowd_labels', userId]`), and `useSetCrowdConsent()` → mutation taking `granted: boolean`. Task 7 uses both.

- [ ] **Step 1: Add the hooks** to `queries.ts`, after `useSetAiCategorize`:

```ts
/**
 * Crowd labels (12c): whether this user shares their category choices, with
 * no name attached, to the pool every Tusky user benefits from. Written only
 * through `set_consent`, which deletes what they shared when they withdraw.
 */
export function useCrowdConsent(userId: string | undefined) {
  return useQuery({
    queryKey: ['consent', 'crowd_labels', userId],
    enabled: !!userId,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('consents')
        .select('id')
        .eq('user_id', userId!)
        .eq('kind', 'crowd_labels')
        .is('withdrawn_at', null)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });
}

export function useSetCrowdConsent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (granted: boolean) => {
      const { error } = await supabase.rpc('set_consent', { p_kind: 'crowd_labels', p_granted: granted });
      if (error) throw error;
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['consent'] }),
  });
}
```

- [ ] **Step 2: Add the switch** in `settings.tsx`, directly after the AI switch's `</View>` and inside the same `Card`. Import `useCrowdConsent, useSetCrowdConsent` from `@/lib/queries`, and `UsersRound` from `lucide-react-native` (`Users` is already used for the herd row). Add `const { data: crowdOn } = useCrowdConsent(session?.user.id);` and `const setCrowd = useSetCrowdConsent();` next to `setAiCategorize`:

```tsx
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: Spacing.sm,
            paddingVertical: Spacing.xs,
          }}>
          <UsersRound size={20} color={colors.brand} strokeWidth={1.75} />
          <View style={{ flex: 1 }}>
            <AppText variant="label">Share my fixes, anonymously</AppText>
            <AppText variant="caption" tone="dim">
              When you fix a category, the merchant and your choice join a pool that helps
              every Tusky user. Never your name, your accounts or exact amounts. A category comes
              from the pool only once three people agree. Turning this off deletes what you
              shared.
            </AppText>
          </View>
          <Switch
            accessibilityLabel="Share my fixes, anonymously"
            trackColor={{ false: colors.elevated, true: colors.brand }}
            value={crowdOn ?? false}
            disabled={!session?.user.id || setCrowd.isPending}
            onValueChange={(granted) =>
              setCrowd.mutate(granted, {
                onError: () => Alert.alert('Could not change that', 'Check your connection and try again.'),
              })
            }
          />
        </View>
```

- [ ] **Step 3:** In `apps/mobile`, run `npm run typecheck && npx expo lint`. Expected: clean.

- [ ] **Step 4: Check it on the emulator.** Start Metro if it is not running. Then:

```sh
node scripts/emu.mjs tap "Settings"
node scripts/emu.mjs ui | grep -i "share my fixes"
node scripts/emu.mjs tap "Share my fixes, anonymously"
npx -y supabase@2.118.0 db query --linked -o csv "select count(*) as active from public.consents where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2' and withdrawn_at is null"
```

Expected: `active` = 1. Tap again. Expected: `active` = 0, and one row with `withdrawn_at` set.

- [ ] **Step 5: Commit:** `git add apps/mobile/src/lib/queries.ts "apps/mobile/src/app/(tabs)/settings.tsx" && git commit -m "feat(app): a switch to share fixes with the crowd, off by default (Phase 12c)"`

---

### Task 7: The one-time prompt after a third fix

**Files:**
- Create: `apps/mobile/src/lib/crowd-prompt.ts`
- Create: `apps/mobile/src/lib/crowd-prompt.test.ts`
- Create: `apps/mobile/src/hooks/use-crowd-prompt.ts`
- Modify: `apps/mobile/src/hooks/use-category-choice.ts`

**Interfaces:**
- Consumes: `useCrowdConsent`, `useSetCrowdConsent` (Task 6).
- Produces: `useCrowdPrompt(): () => void` (call once per completed fix).

- [ ] **Step 1: Write the failing test** `crowd-prompt.test.ts`:

```ts
/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { afterFix, parsePromptState } from './crowd-prompt.ts';

test('the prompt comes on the third fix, once', () => {
  let state = parsePromptState(null);
  let r = afterFix(state, false);
  assert.equal(r.ask, false);
  r = afterFix(r.state, false);
  assert.equal(r.ask, false);
  r = afterFix(r.state, false);
  assert.equal(r.ask, true);
  state = r.state;
  // Asked once: never again, whatever they answered.
  assert.equal(afterFix(state, false).ask, false);
});

test('someone already sharing is never asked', () => {
  let r = afterFix(parsePromptState(null), true);
  r = afterFix(r.state, true);
  r = afterFix(r.state, true);
  assert.equal(r.ask, false);
});

test('a stored state that is missing or garbled starts over', () => {
  assert.deepEqual(parsePromptState(null), { fixes: 0, asked: false });
  assert.deepEqual(parsePromptState('not json'), { fixes: 0, asked: false });
  assert.deepEqual(parsePromptState('{"fixes":2,"asked":false}'), { fixes: 2, asked: false });
});
```

- [ ] **Step 2:** In `apps/mobile`, run `npm test`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `crowd-prompt.ts`:**

```ts
/** The crowd-label prompt (12c): asked once, after a user's third fix. Pure. */

export const CROWD_PROMPT_AFTER = 3;

export type PromptState = { fixes: number; asked: boolean };

export function parsePromptState(raw: string | null): PromptState {
  try {
    const s = raw ? JSON.parse(raw) : null;
    if (s && typeof s.fixes === 'number' && typeof s.asked === 'boolean') return { fixes: s.fixes, asked: s.asked };
  } catch {
    // fall through: start over
  }
  return { fixes: 0, asked: false };
}

/** Count one fix, and say whether to ask now. */
export function afterFix(state: PromptState, consented: boolean): { state: PromptState; ask: boolean } {
  const fixes = state.fixes + 1;
  const ask = !state.asked && !consented && fixes >= CROWD_PROMPT_AFTER;
  return { state: { fixes, asked: state.asked || ask }, ask };
}
```

- [ ] **Step 4: Implement `use-crowd-prompt.ts`:**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert } from 'react-native';

import { afterFix, parsePromptState } from '@/lib/crowd-prompt';
import { useCrowdConsent, useSetCrowdConsent } from '@/lib/queries';
import { useSession } from '@/lib/session';

/**
 * Call after each category fix. On the third, once, asks whether to share
 * fixes with the crowd. Counted per device and user: a nudge, not a record.
 * Storage failures are ignored; the Settings switch is always there.
 */
export function useCrowdPrompt() {
  const { session } = useSession();
  const userId = session?.user.id;
  const { data: consented } = useCrowdConsent(userId);
  const setConsent = useSetCrowdConsent();

  return () => {
    if (!userId) return;
    const key = `crowd-prompt:${userId}`;
    void (async () => {
      try {
        const { state, ask } = afterFix(parsePromptState(await AsyncStorage.getItem(key)), consented ?? false);
        await AsyncStorage.setItem(key, JSON.stringify(state));
        if (!ask) return;
        Alert.alert(
          'Help Tusky get smarter?',
          'Share your category fixes, with no name attached, so everyone’s transactions sort themselves. ' +
            'You can turn this off in Settings, which deletes what you shared.',
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Share',
              onPress: () =>
                setConsent.mutate(true, {
                  onError: () => Alert.alert('Could not change that', 'Check your connection and try again.'),
                }),
            },
          ],
        );
      } catch {
        // A nudge is not worth an error.
      }
    })();
  };
}
```

- [ ] **Step 5: Count fixes** in `use-category-choice.ts`. Import `useCrowdPrompt` from `@/hooks/use-crowd-prompt`, and add `const noteFix = useCrowdPrompt();` next to `setRule`. Change `once` to:

```ts
    const once = () =>
      setCategory.mutate({ transactionId: t.id, categoryId: next.id }, { onSuccess: noteFix });
```

A rule's success is not counted. It changes rows through a service-role function, which never contributes, so asking to share after it would promise something it does not do.

- [ ] **Step 6:** In `apps/mobile`, run `npm test && npm run typecheck && npx expo lint`. Expected: all PASS, clean.

- [ ] **Step 7: Check it on the emulator:** with the switch off, fix three transactions via "Just this one". Expected: the third shows "Help Tusky get smarter?". Tap Share, then check `consents` as in Task 6 Step 4. Fix a fourth. Expected: no prompt.

- [ ] **Step 8: Commit:** `git add apps/mobile/src/lib/crowd-prompt.ts apps/mobile/src/lib/crowd-prompt.test.ts apps/mobile/src/hooks/use-crowd-prompt.ts apps/mobile/src/hooks/use-category-choice.ts && git commit -m "feat(app): ask once, after a third fix, whether to share with the crowd (Phase 12c)"`

---

### Task 8: End to end on dev, docs, PR

**Files:**
- Modify: `docs/ops/production.md`, `CLAUDE.md`, the Phase 12 spec
- Create: `docs/superpowers/plans/2026-09-27-phase-12c-handoff.md`

- [ ] **Step 1: A contribution from a real fix.** With the switch on as the test user, fix one non-private transaction in the app. Then run:

```sh
npx -y supabase@2.118.0 db query --linked -o csv "select merchant, direction, amount_band, category_id from public.community_labels where contributor = private.label_contributor('ccbd42ef-cba6-4f05-a100-a83a727255b2')"
```

Expected: one row for that merchant, with the category's group if the category was custom. Accept a "Tusky guessed" card in `/review`. Expected: a second row, or the same row updated if it is the same band.

- [ ] **Step 2: The crowd serves a category (dev only).** Two real contributors are not enough, so seed two fake ones for the merchant and band from Step 1. `demo-*` never collides with a real HMAC, which is 64 hex characters:

```sh
npx -y supabase@2.118.0 db query --linked -o csv "insert into public.community_labels (contributor, merchant, direction, amount_band, category_id) select 'demo-' || g, merchant, direction, amount_band, category_id from public.community_labels, generate_series(1, 2) g where contributor = private.label_contributor('ccbd42ef-cba6-4f05-a100-a83a727255b2') limit 2 returning merchant"
```

Community answers apply to rows sync writes. To make sync rewrite existing rows on dev, clear the Item's cursor, which re-pulls 90 days as `added`. Then sync from the app (pull to refresh on Home), and run `node scripts/seed-review.mjs`:

```sh
npx -y supabase@2.118.0 db query --linked -o csv "update public.plaid_items set sync_cursor = null where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2' and status = 'active' returning id"
```

Expected: that merchant's other non-manual rows in the same band now have `category_source = 'community'`. Their review card says "Tusky guessed · from other Tusky users". Check with:

```sh
npx -y supabase@2.118.0 db query --linked -o csv "select category_source, count(*) as n from public.transactions where user_id = 'ccbd42ef-cba6-4f05-a100-a83a727255b2' group by 1"
```

Then clean up: `delete from public.community_labels where contributor like 'demo-%'`. Also run `node scripts/cat-quality.mjs`. Expected: a `community` line.

- [ ] **Step 3: Withdraw.** Turn the switch off. Expected: the Step 1 query returns no rows.

- [ ] **Step 4: Docs.**
  - `docs/ops/production.md`, under "Secrets", add: "**`label_pepper` (Vault, Phase 12c).** The HMAC key for `community_labels.contributor`, created once per project by SQL, never in the repo or chat: `select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'label_pepper', 'HMAC pepper for community_labels.contributor (Phase 12c)');`. Without it, contributions are silently skipped. Never rotate it: every contributor would split into two, and withdrawal could no longer find their old rows."
  - `CLAUDE.md` Conventions, after "The AI fallback": add a **Crowd labels (Phase 12c)** bullet. Say that contributions are written only by `ae_transactions_crowd_label`, for the acting user with active `crowd_labels` consent. Say that the pool has no user, herd or account and no client grants. Say that the contributor is an HMAC under the Vault `label_pepper`. Say that serving needs ≥3 contributors at ≥70% (`_shared/crowd.ts`). Say that `private.amount_band` is the SQL twin of `amountBand`, which 12b's cache key shares. Say that a community answer is sticky like an AI one, and that consent is written only through `set_consent`. Update the resolver order to "manual > rule > learned > community > ai > Plaid detailed > …".
  - The spec, under 12c's rls-check list, replace the `credit_ledger` line with "no member can read another user's `consents`, or write one except through `set_consent`". Add Decisions 2, 4 and 7 from this plan to "Known and accepted".
  - README Status: mark 12c done, pending merge.
- [ ] **Step 5: Handoff** `docs/superpowers/plans/2026-09-27-phase-12c-handoff.md`: what shipped, the verification results (rls-check output, including whether `fix_without_pepper` ran), and the production steps that wait for Pedro. The steps are: create the pepper, run `db push --project-ref awiwcgrisyzimzxgddxu`, and deploy the four functions.
- [ ] **Step 6: Final checks:** `npx -y deno test supabase/functions/_shared/`; in `apps/mobile`, `npm test && npm run typecheck && npx expo lint`; `node scripts/rls-check.mjs`. Expected: all PASS.
- [ ] **Step 7: Commit and PR:** `git add docs CLAUDE.md README.md && git commit -m "docs: Phase 12c, crowd labels"`, then `git push -u origin pedro-12c` and `gh pr create --repo Kelvinluciano312/Tusky-App --base master --head pedro-12c --title "Phase 12c: crowd labels"`. The body gets the summary, the verification, the production steps and the Claude Code footer. Do not merge.

---

## Self-review

- **Spec coverage:**
  - Consent table and kind: Task 3.
  - Settings switch: Task 6. One-time prompt after the third fix: Task 7.
  - Withdrawal deletes contributions: Tasks 3 and 4.
  - Pool columns, HMAC contributor, entity-or-name merchant, bands shared with 12b: Tasks 1 and 3.
  - Custom → group, unique key with latest winning, no client grants: Tasks 3 and 4.
  - `security definer` trigger on manual change and review-accept that never blocks: Tasks 3 and 4.
  - Pepper by SQL plus a production doc step: Tasks 3 and 8.
  - Sync reads with the 3-contributor / 70% threshold: Tasks 1 and 5.
  - rls-check items: Task 4, with `credit_ledger` dropped per 12b.
  - Resolver precedence tests: Task 2. Community threshold test: Task 1.
  - Everyone benefits whether or not they contribute: reading needs no consent (Task 5).
- **Types:** `Tally` fields match `community_tallies`' columns. The one difference is that SQL returns `direction` as text, and the cast to `Tally` relies on the check constraint. `crowdKey` is used by both `communityAnswers` and `communityCategory`. `loadCommunity` returns the same map `communityCategory` reads.
