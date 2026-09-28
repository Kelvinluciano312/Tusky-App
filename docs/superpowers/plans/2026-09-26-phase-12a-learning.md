# Phase 12a: learning from your own fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tusky learns each herd's category fixes per merchant (separated by amount and direction), applies them to new and still-unreviewed transactions, flags them as "Tusky guessed" in review, and records every category's source so quality can be measured.

**Architecture:** The pure resolver in `_shared/categorize.ts` gains a `learned` source and now returns `{ categoryId, source }`. A new pure module, `_shared/learn.ts`, turns a merchant's labels (manual rows, plus accepted guesses) into a category. Three paths share it: sync (new rows), `set-merchant-rule` (re-resolve on a rule change) and a new `apply-learning` Edge Function (after a fix). A database trigger stamps `category_source = 'manual'`, and `corrected_from`, whenever a user picks a category. The app reads the column to show the flag.

**Tech Stack:** Supabase Postgres (migrations, plpgsql triggers), Deno Edge Functions (`npm:@supabase/supabase-js@2`, `jsr:@std/assert` tests), Expo SDK 57 / React Native app (TanStack Query, `node --test`).

**Spec:** `docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md` (sections "The resolver", "`transactions.category_source` and `corrected_from`", "12a").

## Global Constraints

- Precedence: manual > rule > learned > plaid (detailed, then primary) > fallback. `community` and `ai` are 12b and 12c. They are **not** built here, but the type lists them.
- `category_source` values, exactly: `manual | rule | learned | community | ai | plaid | fallback`.
- Label = a herd transaction with the same `merchant_key` that is manual, OR has source `learned|community|ai` and `reviewed_at` set.
- Learning constants: the 10 most recent labels of the same direction, at least 2 labels, K = 5 nearest on `log(1 + |amount|)`, and a winner with ≥ 2 votes and ≥ ⅔ of the neighbours.
- A manual category is never overwritten (`pickCategory`, plus a `.eq('category_is_manual', false)` re-check on every write).
- `apply-learning` touches only rows that are non-manual AND `reviewed_at is null`.
- Sync's bulk upsert: every row carries `category_source` (the key-union rule in CLAUDE.md).
- The client never writes `category_source` or `corrected_from`: no update grant. The table-level `select` grant already covers reading them.
- A failed `apply-learning` call never fails the user's category change.
- App test files start with `/// <reference types="node" />`, and import only by relative `./x.ts` path.
- Run `npm run typecheck && npx expo lint` (in `apps/mobile`) before every app commit.
- Branch `pedro-12` (already created from origin/master, upstream unset). Never commit to master.

## Review Focus

1. **A herd mate's private account.** Its fixes must not teach guesses on other members' rows: `usableLabels` (Task 3 test).
2. **A refund at a merchant you fixed.** It is money in and must not take the purchase's category: direction filter (Task 3 test).
3. **One-category merchant, far-off amount** (e.g. a $300 gift card at your coffee shop). No guess, rather than a wrong one: `MAX_DISTANCE` (Task 3 test).
4. **Rows already reviewed.** They never change after a fix: the query and the write re-check in `apply-learning` (Task 6, verified in the Task 8 demo).
5. **A rule and learning disagree.** The rule wins, and removing the rule falls back to learned, not Plaid (Task 4 test).

---

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20261002120000_phase12a_category_source.sql` (new) | Columns, backfill, the stamping trigger |
| `supabase/functions/_shared/categorize.ts` | `CategorySource`, `Resolved`, `resolveCategory`, `pickCategory` (replace `resolveCategoryId`/`pickCategoryId`) |
| `supabase/functions/_shared/learn.ts` (new) | Pure learning: `Label`, `LEARN`, `GUESSED_SOURCES`, `usableLabels`, `learnedCategory` |
| `supabase/functions/_shared/rules.ts` | `planReresolve` takes labels and returns sources |
| `supabase/functions/_shared/sync.ts` | `loadLabels` (I/O), sync wiring |
| `supabase/functions/set-merchant-rule/index.ts` | Passes labels, writes `category_source` |
| `supabase/functions/apply-learning/index.ts` (new) | Re-resolves a merchant's unreviewed rows after a fix |
| `apps/mobile/src/lib/category-source.ts` (new) | `guessHint`, `setBy` copy |
| `apps/mobile/src/lib/queries.ts` | `category_source` on `Transaction`, calls `apply-learning` |
| `apps/mobile/src/components/review-card.tsx`, `apps/mobile/src/app/transaction/[id].tsx` | The flag and the "Set by" line |
| `scripts/rls-check.mjs`, `scripts/cat-quality.mjs` (new) | Guarantees and the quality number |

---

### Task 1: Migration — `category_source`, `corrected_from`, the trigger

**Files:**
- Create: `supabase/migrations/20261002120000_phase12a_category_source.sql`
- Modify: `scripts/rls-check.mjs` (block declarations, write probes, `WRITE_EXPECT`)

**Interfaces:**
- Produces: `transactions.category_source text not null`, `transactions.corrected_from text null`, trigger `ad_transactions_category_source`.

- [ ] **Step 1: Add the failing RLS probes.** In `scripts/rls-check.mjs`, inside `block()`:

Add to the `declare` list (after `mate uuid;`):
```sql
  auto_tx uuid;
  auto_src text;
  other_cat uuid;
```

Add after the line `select user_id into mate from public.herd_members where herd_id = h and user_id <> u limit 1;`:
```sql
  -- Phase 12a: a row Tusky categorized, and a built-in category it is not in.
  select id, category_source into auto_tx, auto_src from public.transactions
    where account_id = any (v) and not category_is_manual limit 1;
  select c.id into other_cat from public.categories c
    where c.herd_id is null and c.parent_id is null
      and c.id is distinct from (select category_id from public.transactions where id = auto_tx)
    limit 1;
```

Add before the `-- Only the owner renames the herd.` line:
```sql
  -- Phase 12a: only the trigger writes where a category came from.
  if own_tx is not null then
    begin
      update public.transactions set category_source = 'ai' where id = own_tx;
      w := w || jsonb_build_object('update_category_source', 'allowed');
    exception when insufficient_privilege then
      w := w || jsonb_build_object('update_category_source', 'denied');
    end;
  end if;
  -- A hand-picked category is stamped manual, and remembers which source it corrected.
  if auto_tx is not null and other_cat is not null then
    update public.transactions set category_id = other_cat, category_is_manual = true where id = auto_tx;
    w := w || jsonb_build_object('correction_recorded',
      (select category_source = 'manual' and corrected_from = auto_src from public.transactions where id = auto_tx));
  end if;
```

Add to `WRITE_EXPECT`:
```js
  update_category_source: 'denied',
  correction_recorded: true,
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node scripts/rls-check.mjs ccbd42ef-cba6-4f05-a100-a83a727255b2`
Expected: `FAIL ... no result`, with an error that column `category_source` does not exist.

- [ ] **Step 3: Write the migration**

```sql
-- Phase 12a: where each transaction's category came from, and which source a
-- user's fix corrected. Sync and set-merchant-rule write category_source; this
-- trigger stamps 'manual' whenever a user picks a category, so the app's direct
-- update (useSetTransactionCategory) never names it. corrected_from is what the
-- quality measure (scripts/cat-quality.mjs) counts.
-- See docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md.

alter table public.transactions
  add column category_source text not null default 'plaid'
    check (category_source in ('manual', 'rule', 'learned', 'community', 'ai', 'plaid', 'fallback')),
  add column corrected_from text
    check (corrected_from in ('rule', 'learned', 'community', 'ai', 'plaid', 'fallback'));

-- Backfill before the trigger exists. corrected_from starts null: past fixes
-- never recorded what they replaced.
update public.transactions set category_source = 'manual' where category_is_manual;
update public.transactions t set category_source = 'rule'
  from public.merchant_rules r
  where not t.category_is_manual and r.herd_id = t.herd_id
    and r.merchant_key = t.merchant_key and r.category_id = t.category_id;
update public.transactions t set category_source = 'fallback'
  where not t.category_is_manual and t.category_source = 'plaid'
    and t.pfc_primary is null and t.pfc_detailed is null
    and t.category_id = (select id from public.categories where slug = 'uncategorized' and herd_id is null);

create function public.transactions_category_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.category_is_manual and (
    tg_op = 'INSERT' or not old.category_is_manual or new.category_id is distinct from old.category_id
  ) then
    -- A different category over one Tusky set is a correction of that source.
    if tg_op = 'UPDATE' and new.category_id is distinct from old.category_id and old.category_source <> 'manual' then
      new.corrected_from := old.category_source;
    end if;
    new.category_source := 'manual';
  end if;
  return new;
end;
$$;

-- "ad_": after aa_fill_herd_id, ab_transactions_paid_by and ac_transactions_split.
create trigger ad_transactions_category_source
  before insert or update of category_id, category_is_manual on public.transactions
  for each row execute function public.transactions_category_source();

-- No grant: authenticated already selects the whole table, and its update
-- grants are column-scoped, so neither new column is client-writable.
```

- [ ] **Step 4: Apply it to dev, and verify**

Run: `npx supabase db push` (the CLI is linked to dev; answer `Y`).
Run: `node scripts/rls-check.mjs`
Expected: every line PASS, including `update_category_source denied (want denied)` and `correction_recorded true (want true)`.
Run: `npx -y supabase@2.118.0 db query --linked -o csv "select category_source, count(*) from transactions group by 1 order by 1"`
Expected: rows for `manual` (5 on dev), `plaid` and possibly `rule`/`fallback`, with no nulls.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261002120000_phase12a_category_source.sql scripts/rls-check.mjs
git commit -m "feat(db): record where each category came from (Phase 12a)"
```
(End every commit message with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` line.)

---

### Task 2: The resolver returns a source, and sync writes it

**Files:**
- Modify: `supabase/functions/_shared/categorize.ts`
- Modify: `supabase/functions/_shared/categorize.test.ts`
- Modify: `supabase/functions/_shared/rules.ts` (call-site only; generalized in Task 4)
- Modify: `supabase/functions/_shared/sync.ts` (the upsert map, ~lines 243-278)

**Interfaces:**
- Consumes: the Task 1 column.
- Produces:
  - `type CategorySource = 'manual' | 'rule' | 'learned' | 'community' | 'ai' | 'plaid' | 'fallback'`
  - `type Resolved = { categoryId: string; source: CategorySource }`
  - `resolveCategory(sources: { rule?: string | null; learned?: string | null; detailed?: string | null; primary?: string | null }, maps: { detailed: CategoryMap; primary: CategoryMap }, fallbackId: string): Resolved`
  - `pickCategory(existing: ExistingCategory, incoming: Resolved): Resolved`
  - `resolveCategoryId` and `pickCategoryId` are removed.

- [ ] **Step 1: Rewrite the tests.** In `categorize.test.ts`, change the import to `import { pickCategory, resolveCategory, toSignedAmount } from './categorize.ts';`. Replace every `resolveCategoryId`/`pickCategoryId` test (keep the `toSignedAmount` tests unchanged) with:

```ts
Deno.test('resolveCategory prefers the detailed code', () => {
  assertEquals(
    resolveCategory({ detailed: 'FOOD_AND_DRINK_COFFEE', primary: 'FOOD_AND_DRINK' }, MAPS, FALLBACK),
    { categoryId: 'cat-coffee', source: 'plaid' },
  );
});

Deno.test('resolveCategory falls to the primary for an unmapped detailed code', () => {
  // e.g. FOOD_AND_DRINK_OTHER_FOOD_AND_DRINK lands on the group itself
  assertEquals(
    resolveCategory({ detailed: 'FOOD_AND_DRINK_VENDING_MACHINES', primary: 'FOOD_AND_DRINK' }, MAPS, FALLBACK),
    { categoryId: 'cat-food', source: 'plaid' },
  );
});

Deno.test('resolveCategory falls to the primary when there is no detailed code', () => {
  // Older rows can have pfc_detailed null.
  assertEquals(resolveCategory({ detailed: null, primary: 'INCOME' }, MAPS, FALLBACK), { categoryId: 'cat-income', source: 'plaid' });
});

Deno.test('resolveCategory falls back when nothing maps', () => {
  const fallback = { categoryId: FALLBACK, source: 'fallback' };
  assertEquals(resolveCategory({ primary: 'CRYPTO_MOONSHOTS' }, MAPS, FALLBACK), fallback);
  assertEquals(resolveCategory({}, MAPS, FALLBACK), fallback);
  assertEquals(resolveCategory({ detailed: undefined, primary: undefined }, MAPS, FALLBACK), fallback);
});

Deno.test('resolveCategory precedence: rule > learned > plaid > fallback', () => {
  const plaid = { detailed: 'FOOD_AND_DRINK_COFFEE', primary: 'FOOD_AND_DRINK' };
  assertEquals(resolveCategory({ rule: 'cat-rule', learned: 'cat-learned', ...plaid }, MAPS, FALLBACK), { categoryId: 'cat-rule', source: 'rule' });
  assertEquals(resolveCategory({ rule: 'cat-rule', primary: 'CRYPTO_MOONSHOTS' }, MAPS, FALLBACK), { categoryId: 'cat-rule', source: 'rule' });
  assertEquals(resolveCategory({ learned: 'cat-learned', ...plaid }, MAPS, FALLBACK), { categoryId: 'cat-learned', source: 'learned' });
  assertEquals(resolveCategory({ learned: 'cat-learned', primary: 'CRYPTO_MOONSHOTS' }, MAPS, FALLBACK), { categoryId: 'cat-learned', source: 'learned' });
  assertEquals(resolveCategory({ rule: null, learned: null, ...plaid }, MAPS, FALLBACK), { categoryId: 'cat-coffee', source: 'plaid' });
});

Deno.test('pickCategory keeps a manual override, as source manual', () => {
  assertEquals(
    pickCategory({ category_id: 'cat-user-chose', category_is_manual: true }, { categoryId: 'cat-food', source: 'learned' }),
    { categoryId: 'cat-user-chose', source: 'manual' },
  );
});

Deno.test('pickCategory takes the incoming category when not manual', () => {
  const incoming = { categoryId: 'cat-food', source: 'rule' } as const;
  assertEquals(pickCategory({ category_id: 'cat-old', category_is_manual: false }, incoming), incoming);
});

Deno.test('pickCategory takes the incoming category for a new transaction', () => {
  const incoming = { categoryId: 'cat-food', source: 'plaid' } as const;
  assertEquals(pickCategory(null, incoming), incoming);
});

Deno.test('pickCategory ignores a manual flag with no category set', () => {
  const incoming = { categoryId: 'cat-food', source: 'plaid' } as const;
  assertEquals(pickCategory({ category_id: null, category_is_manual: true }, incoming), incoming);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx -y deno test supabase/functions/_shared/categorize.test.ts`
Expected: FAIL. The module does not export `resolveCategory` or `pickCategory`.

- [ ] **Step 3: Implement.** In `categorize.ts`, replace `resolveCategoryId` and `pickCategoryId` (and their doc comments) with:

```ts
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
```

In `rules.ts`, change the import to `import { type CategoryMap, resolveCategory } from './categorize.ts';` and in `planReresolve`, replace the `const next = resolveCategoryId(...)` statement with:
```ts
    const next = resolveCategory(
      { rule: ruleCategoryId, detailed: row.pfc_detailed, primary: row.pfc_primary },
      maps,
      fallbackId,
    ).categoryId;
```

In `sync.ts`, change the import to `import { type CategoryMap, pickCategory, resolveCategory, toSignedAmount } from './categorize.ts';`. In the `.map((t) => {` of the upsert, replace the `const incoming = resolveCategoryId(...)` statement and the `const existing = ...` line with:
```ts
          const existing = existingFor.get(t.transaction_id) ?? null;
          const category = pickCategory(existing, resolveCategory(
            {
              rule: ruleByMerchant.get(normalizeMerchant(t.merchant_name ?? t.name)),
              detailed: t.personal_finance_category?.detailed,
              primary: t.personal_finance_category?.primary,
            },
            { detailed: detailedMap, primary: categoryMap },
            fallbackId,
          ));
```
and replace `category_id: pickCategoryId(existing, incoming),` with:
```ts
            category_id: category.categoryId,
            // Every row carries it: a bulk upsert sends the union of the rows' keys.
            category_source: category.source,
```
Also update the comment that says "resolveCategoryId's uncategorized fallback" to say "resolveCategory's". Do the same in `loadCategoryMaps`'s doc comment.

- [ ] **Step 4: Run the tests**

Run: `npx -y deno test supabase/functions/_shared/`
Expected: all PASS, including the unchanged `rules.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/categorize.ts supabase/functions/_shared/categorize.test.ts supabase/functions/_shared/rules.ts supabase/functions/_shared/sync.ts
git commit -m "feat(sync): the resolver says where a category came from (Phase 12a)"
```

---

### Task 3: `learn.ts` — a category from a merchant's labels

**Files:**
- Create: `supabase/functions/_shared/learn.ts`
- Create: `supabase/functions/_shared/learn.test.ts`

**Interfaces:**
- Produces:
  - `type Label = { amount: number; category_id: string; date: string; user_id: string; is_private: boolean }`
  - `const LEARN: { RECENT: 10; MIN_LABELS: 2; K: 5; MIN_VOTES: 2; MIN_SHARE: number; MAX_DISTANCE: number }`
  - `const GUESSED_SOURCES: readonly ['learned', 'community', 'ai']`
  - `usableLabels(labels: Label[], connectorId: string): Label[]`
  - `learnedCategory(labels: Label[], amount: number): string | null` (the amount is signed: positive = money in)

- [ ] **Step 1: Write the failing tests**

```ts
import { assertEquals } from 'jsr:@std/assert';

import { type Label, learnedCategory, usableLabels } from './learn.ts';

let day = 0;
/** A label; later calls are more recent. Amounts are signed: negative = money out. */
function label(amount: number, category_id: string, extra: Partial<Label> = {}): Label {
  day++;
  return { amount, category_id, date: `2026-09-${String(day).padStart(2, '0')}`, user_id: 'u1', is_private: false, ...extra };
}

Deno.test('learnedCategory needs at least two labels', () => {
  assertEquals(learnedCategory([], -5), null);
  assertEquals(learnedCategory([label(-5, 'coffee')], -5), null);
});

Deno.test('learnedCategory: two labels that agree win', () => {
  assertEquals(learnedCategory([label(-5, 'coffee'), label(-6, 'coffee')], -5.5), 'coffee');
});

Deno.test('learnedCategory separates one merchant by amount (gas station: snacks vs fuel)', () => {
  const labels = [label(-4, 'food'), label(-6, 'food'), label(-45, 'fuel'), label(-50, 'fuel')];
  assertEquals(learnedCategory(labels, -5), 'food');
  assertEquals(learnedCategory(labels, -48), 'fuel');
});

Deno.test('learnedCategory keeps money in and money out apart (a refund is not a purchase)', () => {
  const labels = [label(-5, 'coffee'), label(-6, 'coffee')];
  assertEquals(learnedCategory(labels, 5), null);
});

Deno.test('learnedCategory gives no guess for an amount far from every label', () => {
  // A $300 gift card at the coffee shop is not a $5 coffee.
  assertEquals(learnedCategory([label(-5, 'coffee'), label(-6, 'coffee')], -300), null);
});

Deno.test('learnedCategory gives no guess without a clear majority', () => {
  // 2 of 4 neighbours is under two thirds.
  assertEquals(learnedCategory([label(-5, 'coffee'), label(-5, 'food'), label(-6, 'coffee'), label(-6, 'food')], -5), null);
  // A tie of one each is also under the vote floor.
  assertEquals(learnedCategory([label(-5, 'coffee'), label(-5, 'food')], -5), null);
});

Deno.test('learnedCategory uses only the 10 most recent labels', () => {
  const old = Array.from({ length: 10 }, () => label(-5, 'coffee'));
  const recent = Array.from({ length: 10 }, () => label(-5, 'food'));
  assertEquals(learnedCategory([...old, ...recent], -5), 'food');
});

Deno.test('usableLabels drops another member\'s private-account labels, keeps your own', () => {
  const shared = label(-5, 'a', { user_id: 'mate' });
  const matePrivate = label(-5, 'b', { user_id: 'mate', is_private: true });
  const minePrivate = label(-5, 'c', { user_id: 'me', is_private: true });
  assertEquals(usableLabels([shared, matePrivate, minePrivate], 'me'), [shared, minePrivate]);
  assertEquals(usableLabels([shared, matePrivate, minePrivate], 'mate'), [shared, matePrivate]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx -y deno test supabase/functions/_shared/learn.test.ts`
Expected: FAIL, module `./learn.ts` not found.

- [ ] **Step 3: Implement `learn.ts`**

```ts
/**
 * Learning from a herd's own fixes (Phase 12a). Pure: callers load the labels.
 *
 * A label is a transaction with the same merchant_key that the user categorized
 * by hand, or whose guess (GUESSED_SOURCES) they accepted in review. Labels are
 * compared by amount on a log scale, so a $4 coffee sits near a $6 one and far
 * from a $50 fill-up: one merchant can teach two categories.
 */

/** The sources that are Tusky's guesses: accepting one in review makes it a label. */
export const GUESSED_SOURCES = ['learned', 'community', 'ai'] as const;

export const LEARN = {
  /** Only the most recent labels of the same direction count. */
  RECENT: 10,
  /** Fewer labels than this teach nothing. */
  MIN_LABELS: 2,
  /** How many nearest labels vote. */
  K: 5,
  /** The winner needs at least this many votes... */
  MIN_VOTES: 2,
  /** ...and at least this share of the voters. Over a half, so a tie never wins. */
  MIN_SHARE: 2 / 3,
  /** Labels further than 3x (or 1/3) the amount do not vote. */
  MAX_DISTANCE: Math.log(3),
} as const;

export type Label = {
  /** Signed like transactions.amount: positive = money in. */
  amount: number;
  category_id: string;
  /** The transaction's date (YYYY-MM-DD): recency. */
  date: string;
  /** Who connected the account ("connected by"). */
  user_id: string;
  /** Whether the account is private to its connector. */
  is_private: boolean;
};

/**
 * The labels that may teach a row connected by `connectorId`. A member's
 * private-account fixes only teach their own rows: a herd mate must not be able
 * to infer them from a guess.
 */
export function usableLabels(labels: Label[], connectorId: string): Label[] {
  return labels.filter((l) => !l.is_private || l.user_id === connectorId);
}

const size = (amount: number) => Math.log1p(Math.abs(amount));

/** The category this merchant's labels give a transaction of `amount`, or null. */
export function learnedCategory(labels: Label[], amount: number): string | null {
  const moneyIn = amount > 0;
  const recent = labels
    .filter((l) => (l.amount > 0) === moneyIn)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, LEARN.RECENT);
  if (recent.length < LEARN.MIN_LABELS) return null;

  const x = size(amount);
  const near = recent
    .map((l) => ({ l, d: Math.abs(size(l.amount) - x) }))
    .filter(({ d }) => d <= LEARN.MAX_DISTANCE)
    .sort((a, b) => a.d - b.d)
    .slice(0, LEARN.K);

  const votes = new Map<string, number>();
  for (const { l } of near) votes.set(l.category_id, (votes.get(l.category_id) ?? 0) + 1);
  let best: string | null = null;
  let most = 0;
  for (const [category, n] of votes) {
    if (n > most) [best, most] = [category, n];
  }
  if (most < LEARN.MIN_VOTES || most < LEARN.MIN_SHARE * near.length) return null;
  return best;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx -y deno test supabase/functions/_shared/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/learn.ts supabase/functions/_shared/learn.test.ts
git commit -m "feat(sync): learn a merchant's category from the herd's fixes (Phase 12a)"
```

---

### Task 4: Re-resolving with labels — `planReresolve`, `loadLabels`, `set-merchant-rule`

**Files:**
- Modify: `supabase/functions/_shared/rules.ts` (`ReresolveRow`, `planReresolve`)
- Modify: `supabase/functions/_shared/rules.test.ts` (the two `planReresolve` tests)
- Modify: `supabase/functions/_shared/sync.ts` (add `loadLabels` after `loadCategoryMaps`)
- Modify: `supabase/functions/set-merchant-rule/index.ts` (the re-resolve block, ~lines 70-97)

**Interfaces:**
- Consumes: `resolveCategory`, `CategorySource` (Task 2); `Label`, `learnedCategory`, `usableLabels`, `GUESSED_SOURCES` (Task 3).
- Produces:
  - `type ReresolveRow = { id: string; pfc_detailed: string | null; pfc_primary: string | null; category_id: string | null; category_source: string; amount: number; user_id: string }`
  - `planReresolve(rows: ReresolveRow[], ruleCategoryId: string | null, labels: Label[], maps: { detailed: CategoryMap; primary: CategoryMap }, fallbackId: string): { category_id: string; category_source: CategorySource; ids: string[] }[]`
  - `loadLabels(admin: SupabaseClient, herdId: string, merchantKeys: string[]): Promise<Map<string, Label[]>>` (in `sync.ts`)

- [ ] **Step 1: Rewrite the `planReresolve` tests.** In `rules.test.ts`, add `import type { Label } from './learn.ts';` and replace both `planReresolve` tests with:

```ts
const row = (id: string, pfc_detailed: string | null, pfc_primary: string | null, category_id: string, category_source = 'plaid') =>
  ({ id, pfc_detailed, pfc_primary, category_id, category_source, amount: -20, user_id: 'u1' });
const learnedLabels: Label[] = [
  { amount: -20, category_id: 'cat-learned', date: '2026-09-01', user_id: 'u1', is_private: false },
  { amount: -22, category_id: 'cat-learned', date: '2026-09-02', user_id: 'u1', is_private: false },
];

Deno.test('planReresolve groups only the rows whose category or source changes', () => {
  const rows = [
    row('t1', 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', 'TRANSPORTATION', 'cat-rideshare'),
    row('t2', null, 'TRANSPORTATION', 'cat-transport'),
    row('t3', null, null, 'cat-food', 'rule'),
  ];
  assertEquals(planReresolve(rows, 'cat-food', [], MAPS, 'cat-none'), [
    { category_id: 'cat-food', category_source: 'rule', ids: ['t1', 't2'] },
  ]);
});

Deno.test('planReresolve without a rule restores Plaid, by the same resolver sync uses', () => {
  const rows = [
    row('t1', 'TRANSPORTATION_TAXIS_AND_RIDE_SHARES', 'TRANSPORTATION', 'cat-food', 'rule'),
    row('t2', null, 'TRANSPORTATION', 'cat-food', 'rule'),
    row('t3', null, null, 'cat-food', 'rule'),
  ];
  assertEquals(planReresolve(rows, null, [], MAPS, 'cat-none'), [
    { category_id: 'cat-rideshare', category_source: 'plaid', ids: ['t1'] },
    { category_id: 'cat-transport', category_source: 'plaid', ids: ['t2'] },
    { category_id: 'cat-none', category_source: 'fallback', ids: ['t3'] },
  ]);
});

Deno.test('planReresolve: a rule beats learning, and removing it falls back to learning', () => {
  const rows = [row('t1', null, 'TRANSPORTATION', 'cat-transport')];
  assertEquals(planReresolve(rows, 'cat-rule', learnedLabels, MAPS, 'cat-none'), [
    { category_id: 'cat-rule', category_source: 'rule', ids: ['t1'] },
  ]);
  assertEquals(planReresolve(rows, null, learnedLabels, MAPS, 'cat-none'), [
    { category_id: 'cat-learned', category_source: 'learned', ids: ['t1'] },
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx -y deno test supabase/functions/_shared/rules.test.ts`
Expected: FAIL. `planReresolve` takes 4 arguments and returns no `category_source`.

- [ ] **Step 3: Implement.** In `rules.ts`, replace the imports, `ReresolveRow` and `planReresolve` with:

```ts
import { type CategoryMap, type CategorySource, resolveCategory } from './categorize.ts';
import { type Label, learnedCategory, usableLabels } from './learn.ts';
```
```ts
export type ReresolveRow = {
  id: string;
  pfc_detailed: string | null;
  pfc_primary: string | null;
  category_id: string | null;
  category_source: string;
  /** Signed: positive = money in. What learning compares. */
  amount: number;
  /** Who connected the account: decides which private labels may teach it. */
  user_id: string;
};

/**
 * One merchant's non-manual rows, re-resolved with the rule's category (null:
 * no rule) and the herd's labels for that merchant. Same resolver as sync, so
 * a rule applied then removed lands every row exactly where sync would put it.
 * Returns only the rows whose category or source changes, grouped by both.
 */
export function planReresolve(
  rows: ReresolveRow[],
  ruleCategoryId: string | null,
  labels: Label[],
  maps: { detailed: CategoryMap; primary: CategoryMap },
  fallbackId: string,
): { category_id: string; category_source: CategorySource; ids: string[] }[] {
  const groups = new Map<string, { category_id: string; category_source: CategorySource; ids: string[] }>();
  for (const row of rows) {
    const next = resolveCategory(
      {
        rule: ruleCategoryId,
        learned: learnedCategory(usableLabels(labels, row.user_id), row.amount),
        detailed: row.pfc_detailed,
        primary: row.pfc_primary,
      },
      maps,
      fallbackId,
    );
    if (next.categoryId === row.category_id && next.source === row.category_source) continue;
    const key = `${next.categoryId}|${next.source}`;
    const group = groups.get(key) ?? { category_id: next.categoryId, category_source: next.source, ids: [] };
    group.ids.push(row.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}
```

In `sync.ts`, add `import { GUESSED_SOURCES, type Label } from './learn.ts';` and, after `loadCategoryMaps`:

```ts
/** Merchant keys per labels query: keeps the PostgREST URL short. */
const LABEL_KEY_CHUNK = 100;

/**
 * The herd's labels (12a) for these merchants, keyed by merchant_key: rows
 * categorized by hand, and guesses accepted in review. Shared by sync,
 * set-merchant-rule and apply-learning, so all three learn identically.
 */
export async function loadLabels(
  admin: SupabaseClient,
  herdId: string,
  merchantKeys: string[],
): Promise<Map<string, Label[]>> {
  const byMerchant = new Map<string, Label[]>();
  // A name with no letters has an empty key: it takes no rule, and teaches nothing.
  const keys = [...new Set(merchantKeys.filter(Boolean))];
  for (let i = 0; i < keys.length; i += LABEL_KEY_CHUNK) {
    const { data, error } = await admin
      .from('transactions')
      .select('merchant_key, amount, category_id, date, user_id, accounts!inner(is_private)')
      .eq('herd_id', herdId)
      .in('merchant_key', keys.slice(i, i + LABEL_KEY_CHUNK))
      .not('category_id', 'is', null)
      .or(`category_is_manual.eq.true,and(category_source.in.(${GUESSED_SOURCES.join(',')}),reviewed_at.not.is.null)`);
    if (error) throw new Error(`failed to load labels: ${error.message}`);
    for (const r of data ?? []) {
      const list = byMerchant.get(r.merchant_key) ?? [];
      list.push({
        amount: Number(r.amount),
        category_id: r.category_id,
        date: r.date,
        user_id: r.user_id,
        is_private: (r.accounts as unknown as { is_private: boolean }).is_private,
      });
      byMerchant.set(r.merchant_key, list);
    }
  }
  return byMerchant;
}
```

In `set-merchant-rule/index.ts`, change the import to `import { loadCategoryMaps, loadLabels } from '../_shared/sync.ts';`. Then replace the block from `const { data: rows, error: rowsError } = await admin` through the end of the `for (const { category_id, ids } of plan)` loop with:

```ts
      const { data: rows, error: rowsError } = await admin
        .from('transactions')
        .select('id, pfc_detailed, pfc_primary, category_id, category_source, amount, user_id')
        .eq('herd_id', herdId)
        .eq('merchant_key', input.merchant_key)
        .eq('category_is_manual', false);
      if (rowsError) throw rowsError;

      const maps = await loadCategoryMaps(admin);
      // Without a rule, the herd's own fixes (12a) come before Plaid again.
      const labels = (await loadLabels(admin, herdId, [input.merchant_key])).get(input.merchant_key) ?? [];
      const plan = planReresolve(
        (rows ?? []).map((r) => ({ ...r, amount: Number(r.amount) })),
        after,
        labels,
        { detailed: maps.detailedMap, primary: maps.categoryMap },
        maps.fallbackId,
      );
      for (const { category_id, category_source, ids } of plan) {
        for (let i = 0; i < ids.length; i += CHUNK) {
          const { error } = await admin
            .from('transactions')
            .update({ category_id, category_source })
            .in('id', ids.slice(i, i + CHUNK))
            // Re-checked at write time: a row set by hand meanwhile stays put.
            .eq('category_is_manual', false);
          if (error) throw error;
        }
        updated += ids.length;
      }
```
Also update the header comment's "re-resolved with the same resolver sync uses" to add ", learning included".

- [ ] **Step 4: Run the tests and type-check the function**

Run: `npx -y deno test supabase/functions/_shared/`
Expected: all PASS.
Run: `npx -y deno check supabase/functions/set-merchant-rule/index.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/rules.ts supabase/functions/_shared/rules.test.ts supabase/functions/_shared/sync.ts supabase/functions/set-merchant-rule/index.ts
git commit -m "feat(rules): rule changes re-resolve with the herd's learning (Phase 12a)"
```

---

### Task 5: Sync learns

**Files:**
- Modify: `supabase/functions/_shared/sync.ts` (inside `if (upserts.length > 0) {`)

**Interfaces:**
- Consumes: `loadLabels` (Task 4); `learnedCategory`, `usableLabels` (Task 3); `resolveCategory`, `pickCategory` (Task 2).

- [ ] **Step 1: Wire it.** Extend the learn import to `import { GUESSED_SOURCES, type Label, learnedCategory, usableLabels } from './learn.ts';`. After the `ruleByMerchant` map is built, add:

```ts
      // The herd's own fixes (12a) for the merchants in this batch.
      // deno-lint-ignore no-explicit-any
      const merchantKeyOf = (t: any) => normalizeMerchant(t.merchant_name ?? t.name);
      const labelsByMerchant = await loadLabels(admin, item.herd_id, upserts.map(merchantKeyOf));
```
Then replace the Task 2 `const category = pickCategory(...)` statement with:

```ts
          const merchantKey = merchantKeyOf(t);
          const category = pickCategory(existing, resolveCategory(
            {
              rule: ruleByMerchant.get(merchantKey),
              // Only labels this Item's connector may learn from (private accounts).
              learned: learnedCategory(
                usableLabels(labelsByMerchant.get(merchantKey) ?? [], item.user_id),
                toSignedAmount(t.amount),
              ),
              detailed: t.personal_finance_category?.detailed,
              primary: t.personal_finance_category?.primary,
            },
            { detailed: detailedMap, primary: categoryMap },
            fallbackId,
          ));
```

- [ ] **Step 2: Type-check and run the tests**

Run: `npx -y deno check supabase/functions/plaid-sync-transactions/index.ts supabase/functions/plaid-webhook/index.ts`
Expected: no errors.
Run: `npx -y deno test supabase/functions/_shared/`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_shared/sync.ts
git commit -m "feat(sync): new transactions learn from the herd's fixes (Phase 12a)"
```

---

### Task 6: The `apply-learning` Edge Function, and deploy to dev

**Files:**
- Create: `supabase/functions/apply-learning/index.ts`

**Interfaces:**
- Consumes: `loadCategoryMaps`, `loadLabels` (`sync.ts`); `planReresolve` (Task 4); `getCallerHerd`, `getAuthedUser`, `getAdminClient`, `jsonResponse`, `corsHeaders` (`_shared/lib.ts`).
- Produces: `POST apply-learning { transaction_id: uuid }` → `{ ok: true, updated: number }` (401 unauthenticated, 400 bad body, 404 not in caller's herd, 500 otherwise).

- [ ] **Step 1: Write the function**

```ts
// After a user categorizes a transaction by hand (Phase 12a), teach the rest
// of that merchant: the herd's non-manual rows that are still waiting for
// review are re-resolved with the same resolver sync uses, now that there is
// one more label. Rows already reviewed are left alone: the user has seen them.
// JWT-verified by default: no config.toml entry.

import { corsHeaders, getAdminClient, getAuthedUser, getCallerHerd, jsonResponse } from '../_shared/lib.ts';
import { planReresolve } from '../_shared/rules.ts';
import { loadCategoryMaps, loadLabels } from '../_shared/sync.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = getAdminClient();
  const user = await getAuthedUser(req, admin);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: { transaction_id?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // fall through to validation
  }
  const id = body?.transaction_id;
  if (typeof id !== 'string' || !UUID.test(id)) return jsonResponse({ error: 'transaction_id is required' }, 400);

  try {
    const { herd_id: herdId } = await getCallerHerd(admin, user.id);

    const { data: fixed, error: fixedError } = await admin
      .from('transactions').select('merchant_key').eq('id', id).eq('herd_id', herdId).maybeSingle();
    if (fixedError) throw fixedError;
    if (!fixed) return jsonResponse({ error: 'Unknown transaction' }, 404);
    const merchantKey: string = fixed.merchant_key ?? '';
    // A name with no letters has an empty key: nothing to learn.
    if (!merchantKey) return jsonResponse({ ok: true, updated: 0 });

    const { data: rule, error: ruleError } = await admin
      .from('merchant_rules').select('category_id')
      .eq('herd_id', herdId).eq('merchant_key', merchantKey).maybeSingle();
    if (ruleError) throw ruleError;

    const { data: rows, error: rowsError } = await admin
      .from('transactions')
      .select('id, pfc_detailed, pfc_primary, category_id, category_source, amount, user_id')
      .eq('herd_id', herdId)
      .eq('merchant_key', merchantKey)
      .eq('category_is_manual', false)
      .is('reviewed_at', null);
    if (rowsError) throw rowsError;

    const maps = await loadCategoryMaps(admin);
    const labels = (await loadLabels(admin, herdId, [merchantKey])).get(merchantKey) ?? [];
    const plan = planReresolve(
      (rows ?? []).map((r) => ({ ...r, amount: Number(r.amount) })),
      rule?.category_id ?? null,
      labels,
      { detailed: maps.detailedMap, primary: maps.categoryMap },
      maps.fallbackId,
    );

    let updated = 0;
    for (const { category_id, category_source, ids } of plan) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { error } = await admin
          .from('transactions')
          .update({ category_id, category_source })
          .in('id', ids.slice(i, i + CHUNK))
          // Re-checked at write time: set by hand or reviewed meanwhile, it stays put.
          .eq('category_is_manual', false)
          .is('reviewed_at', null);
        if (error) throw error;
      }
      updated += ids.length;
    }
    return jsonResponse({ ok: true, updated });
  } catch (err) {
    console.error(`apply-learning failed for ${id}`, err);
    return jsonResponse({ error: 'Could not apply what Tusky learned' }, 500);
  }
});
```

- [ ] **Step 2: Type-check**

Run: `npx -y deno check supabase/functions/apply-learning/index.ts`
Expected: no errors.

- [ ] **Step 3: Deploy every function to dev**

Run: `npx supabase functions deploy --use-api`
Expected: every function deployed, including `apply-learning`. (The CLI is linked to dev. Shared code changed, so the sync, webhook and rule functions must be redeployed too.)

- [ ] **Step 4: Smoke-test it unauthenticated**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://ifibrsgqdibcomzxencf.supabase.co/functions/v1/apply-learning -H "Content-Type: application/json" -d '{}'`
Expected: `401`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/apply-learning/index.ts
git commit -m "feat(functions): apply-learning re-resolves a merchant after a fix (Phase 12a)"
```

---

### Task 7: The app — flag guesses, show the source, trigger learning

**Files:**
- Create: `apps/mobile/src/lib/category-source.ts`
- Create: `apps/mobile/src/lib/category-source.test.ts`
- Modify: `apps/mobile/src/lib/queries.ts` (`Transaction` type ~line 227, `TRANSACTION_COLUMNS` ~line 245, `useSetTransactionCategory` ~lines 293-330)
- Modify: `apps/mobile/src/components/review-card.tsx` (after the category chip `</Pressable>`, ~line 147)
- Modify: `apps/mobile/src/app/transaction/[id].tsx` (after the rule caption, ~line 113)

**Interfaces:**
- Consumes: the `apply-learning` function (Task 6), the `category_source` column (Task 1).
- Produces: `guessHint(source: string): string | null` and `setBy(source: string): string`.

- [ ] **Step 1: Write the failing test** (`category-source.test.ts`)

```ts
/// <reference types="node" />
// TS 6 no longer auto-includes @types (types defaults to []); scoped to tests so app code never sees Node globals.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { guessHint, setBy } from './category-source.ts';

test('guessHint names where a guess came from, and is null for everything else', () => {
  assert.equal(guessHint('learned'), 'from your past choices');
  assert.equal(guessHint('community'), 'from other Tusky users');
  assert.equal(guessHint('ai'), 'with AI');
  for (const source of ['manual', 'rule', 'plaid', 'fallback', 'something-new']) assert.equal(guessHint(source), null);
});

test('setBy has words for every source, and a safe default', () => {
  assert.equal(setBy('manual'), 'You');
  assert.equal(setBy('rule'), 'Your rule');
  assert.equal(setBy('learned'), 'Your past choices');
  assert.equal(setBy('community'), 'Other Tusky users');
  assert.equal(setBy('ai'), 'AI');
  assert.equal(setBy('plaid'), 'Your bank (via Plaid)');
  assert.equal(setBy('fallback'), 'No match yet');
  assert.equal(setBy('something-new'), 'Tusky');
});
```

- [ ] **Step 2: Run to verify it fails**

Run (in `apps/mobile`): `npm test`
Expected: FAIL, cannot find `./category-source.ts`.

- [ ] **Step 3: Implement `category-source.ts`**

```ts
/**
 * Words for where a transaction's category came from (Phase 12,
 * transactions.category_source). Takes a plain string: the server may add
 * sources before the app knows them.
 */

const GUESS_HINTS: Record<string, string> = {
  learned: 'from your past choices',
  community: 'from other Tusky users',
  ai: 'with AI',
};

const SET_BY: Record<string, string> = {
  manual: 'You',
  rule: 'Your rule',
  learned: 'Your past choices',
  community: 'Other Tusky users',
  ai: 'AI',
  plaid: 'Your bank (via Plaid)',
  fallback: 'No match yet',
};

/** For a Tusky guess, how it was made ("Tusky guessed this …"); null when it is not a guess. */
export function guessHint(source: string): string | null {
  return GUESS_HINTS[source] ?? null;
}

/** Who set the category, for the transaction screen. */
export function setBy(source: string): string {
  return SET_BY[source] ?? 'Tusky';
}
```

- [ ] **Step 4: Run the test**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Wire queries.ts.** In the `Transaction` type, after `category_is_manual: boolean;` add:
```ts
  /** Where the category came from (Phase 12): manual, rule, learned, community, ai, plaid or fallback. */
  category_source: string;
```
Add `category_source` after `category_is_manual` in `TRANSACTION_COLUMNS`.

In `useSetTransactionCategory`, replace the `mutationFn` with:
```ts
    mutationFn: async ({ transactionId, categoryId }: { transactionId: string; categoryId: string }) => {
      const { error } = await supabase
        .from('transactions')
        .update({ category_id: categoryId, category_is_manual: true })
        .eq('id', transactionId);
      if (error) throw error;
      // Phase 12a: teach the merchant's other unreviewed rows. Best effort: the
      // choice itself is saved, and the next sync learns from it anyway.
      const { error: learnError } = await supabase.functions.invoke('apply-learning', {
        body: { transaction_id: transactionId },
      });
      if (learnError) console.warn('apply-learning failed', (await readFunctionError(learnError)).message);
    },
```
and in `onMutate`'s optimistic row, change `{ ...t, category_id: categoryId, category_is_manual: true }` to `{ ...t, category_id: categoryId, category_is_manual: true, category_source: 'manual' }`.

- [ ] **Step 6: The flag on the review card.** In `review-card.tsx`, add `import { guessHint } from '@/lib/category-source';` with the other `@/lib` imports. Directly after the category chip's closing `</Pressable>` and before `{rule?.category_id ? (`, add:
```tsx
        {guessHint(t.category_source) ? (
          <AppText variant="caption" tone="dim" style={{ textAlign: 'center' }}>
            Tusky guessed this {guessHint(t.category_source)}
          </AppText>
        ) : null}
```

- [ ] **Step 7: The "Set by" line.** In `app/transaction/[id].tsx`, add `import { setBy } from '@/lib/category-source';` with the other `@/lib` imports. Directly after the rule caption's `) : null}` (the one that ends `', but this one was set by hand'`) and before the Memo `<Line`, add:
```tsx
          <Line label="Set by" value={setBy(t.category_source)} dim />
```

- [ ] **Step 8: Typecheck, lint, test**

Run (in `apps/mobile`): `npm run typecheck && npx expo lint && npm test`
Expected: no errors, all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/lib/category-source.ts apps/mobile/src/lib/category-source.test.ts apps/mobile/src/lib/queries.ts apps/mobile/src/components/review-card.tsx "apps/mobile/src/app/transaction/[id].tsx"
git commit -m "feat(app): flag Tusky's guesses in review and show who set a category (Phase 12a)"
```

---

### Task 8: The quality measure, docs, and the end-to-end demo

**Files:**
- Create: `scripts/cat-quality.mjs`
- Modify: `CLAUDE.md` (the "Categories are two levels" and "Merchant rules" bullets, the Commands block, a new 12a bullet)
- Modify: `README.md` (Status)
- Modify: `docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md` (step 4 of `learnedCategory`)

- [ ] **Step 1: Write `scripts/cat-quality.mjs`**

```js
#!/usr/bin/env node
// Categorization quality (Phase 12): for each source, how many of the
// categories it set were kept (reviewed without a fix) and how many a user
// corrected by hand. Read-only.
//
//   node scripts/cat-quality.mjs
//
// Runs on the LINKED project and refuses anything but dev. Rows reviewed before
// Phase 12a count as kept, and fixes made before it were never recorded, so
// compare runs made after 12a shipped.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DEV_REF = 'ifibrsgqdibcomzxencf';

const linked = readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8').trim();
if (linked !== DEV_REF) {
  console.error(`refusing: the CLI is linked to ${linked}, not the dev project ${DEV_REF}`);
  process.exit(2);
}

const sql = `
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
order by 1;`;

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
  const lines = out.split(/\r?\n/).filter((l) => /^[a-z_]+,/.test(l));
  for (const line of lines) {
    const [source, kept, corrected, pct] = line.split(',');
    console.log(`${source.padEnd(16)}${kept.padStart(8)}${corrected.padStart(11)}${(pct || '-').padStart(13)}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
```

Run: `node scripts/cat-quality.mjs`
Expected: a header line (`source  kept  corrected  corrected_pct`), then one line per source, e.g. `plaid ...`. The header matches `/^[a-z_]+,/` and prints too.

- [ ] **Step 2: End-to-end demo on the emulator** (Metro running; JS hot-reloads)
  1. `node scripts/seed-review.mjs 40`
  2. `node scripts/emu.mjs ui`, then open the review deck (tap the "to review" card on Home).
  3. Find a merchant that appears at least 3 times in the queue. On its first card, change the category and choose "Just this one". Skip to its second card and change it to the same category.
  4. Reach the third card for that merchant. Expected: it already shows the new category, with "Tusky guessed this from your past choices" under the chip.
  5. Accept it (swipe right). Open it from the feed: "Set by: Your past choices".
  6. Confirm that reviewed rows did not move: `npx -y supabase@2.118.0 db query --linked -o csv "select count(*) from transactions where category_source = 'learned' and reviewed_at < now() - interval '10 minutes'"`. Expected: `0`.
  7. `node scripts/emu.mjs logs`. Expected: no JS errors.
  8. `node scripts/cat-quality.mjs`. Expected: `learned` has kept ≥ 1, and the source you corrected has corrected ≥ 2.

- [ ] **Step 3: Docs**
  - **CLAUDE.md, "Categories are two levels":** change the resolution sentence to "Sync resolves **manual > rule (7c) > learned (12a) > Plaid detailed … > uncategorized**: `resolveCategory` in `_shared/categorize.ts`, with `pickCategory` on top."
  - **CLAUDE.md, "Merchant rules":** change `resolveCategoryId` to `resolveCategory`.
  - **CLAUDE.md, a new Conventions bullet after "Merchant rules":**
    ```markdown
    - **Learning from fixes** (Phase 12a). `transactions.category_source` records where each category came
      from (`manual | rule | learned | community | ai | plaid | fallback`), and `corrected_from` which
      source a hand-picked category replaced. The `ad_transactions_category_source` trigger stamps both;
      the client never writes them. Labels are a merchant's manual rows plus accepted guesses
      (`_shared/learn.ts`), loaded by `loadLabels`; a member's private-account labels teach only their
      own rows. Sync, `set-merchant-rule` and `apply-learning` all re-resolve through `planReresolve`,
      and `apply-learning` touches only unreviewed rows. `node scripts/cat-quality.mjs` prints each
      source's correction rate. Spec: `docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md`.
    ```
  - **CLAUDE.md, Commands block:** add `node scripts/cat-quality.mjs   # dev: each category source's correction rate`.
  - **README.md, Status:** after the Phase 7 lines, add `- 🚧 **Phase 12** — the categorization engine — [spec](docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md)` with a nested `  - ✅ **12a** — Tusky learns each merchant's category from your fixes (split by amount), flags its guesses in review, and records where every category came from`. Replace the "Planned: community categorization" line with `  - 12b (AI fallback, on credits) and 12c (opt-in crowd labels) are next`.
  - **The spec, 12a `learnedCategory` step 4:** replace "A tie goes to the most recent label." with "Labels further than 3× (or ⅓) the amount do not vote, so a far-off amount gets no guess. The ⅔ share means a tie never wins."
  - **The spec, 12a UI:** replace `shows "Categorized by …" for every source` with `shows "Set by …" for every source (the label column is narrow)`.

- [ ] **Step 4: Final checks**

Run: `npx -y deno test supabase/functions/_shared/`, then (in `apps/mobile`) `npm run typecheck && npx expo lint && npm test`, then `node scripts/rls-check.mjs`
Expected: everything PASS.

- [ ] **Step 5: Commit, then open the PR**

```bash
git add scripts/cat-quality.mjs CLAUDE.md README.md docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md docs/superpowers/plans/2026-09-26-phase-12a-learning.md
git commit -m "docs: Phase 12a learning, the quality script and conventions"
git push -u origin pedro-12
gh pr create --base master --title "Phase 12a: Tusky learns from your category fixes" --body-file <file>
```
The PR body summarizes what changed, how it was tested, and "After merge: `db push` and deploy all functions except plaid-sandbox on production (see docs/ops/production.md), with Pedro's go-ahead". It ends with the Claude Code attribution line. Do not merge: Pedro merges.
