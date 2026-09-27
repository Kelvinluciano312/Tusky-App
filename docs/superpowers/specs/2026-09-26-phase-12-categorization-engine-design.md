# Phase 12: the categorization engine

Auto-categorization is a core promise of Tusky, and "community categorization" is how we keep it. With two
real users today, labels from the crowd cannot carry quality on their own for a long time. So Phase 12
builds a layered engine: Tusky learns from your own fixes first, then from an opt-in AI fallback, then
from the crowd. Each layer is a source in the one resolver Phase 7 built, and each leaves a record of
where a category came from, so we can measure how good it is.

Phase 7 laid the groundwork (see its spec, "Community categorization: groundwork only"): stable
built-in ids, Plaid's guess kept beside a manual choice, `merchant_entity_id`, and a slot in
`resolveCategoryId`.

## What we decided with Pedro (2026-09-26)

- **All four layers are in scope:** learning from your own fixes, context signals, an AI fallback,
  and crowd labels. They ship as three PRs: 12a, 12b and 12c.
- **Tusky applies a learned category and flags it in review.** The review card says "Tusky guessed".
  Accepting the card confirms the guess, and changing it is a correction. A correct guess costs no taps.
- **AI costs credits.** It follows `docs/product/monetization.md`: every AI call is metered.
- **AI is opt-in.** A Settings switch, off by default. 12b adds a minimal credit ledger. Credits are
  granted by SQL until Stripe exists.
- **Crowd labels are opt-in, and everyone benefits.** Users who don't contribute still get
  crowd-based categories.
- **Order:** 12a, then preset budgets (Phase 13, its own spec), then 12b and 12c.

## Data check (dev, 2026-09-26)

Of 500 dev transactions:
- `datetime` is set on 0.
- `merchant_entity_id` is set on 23.
- 5 are manual.
- Plaid's confidence is VERY_HIGH or HIGH on 257, MEDIUM on 3, and LOW, UNKNOWN or missing on 240.

Consequences:
- **Context means amount and direction only.** Time of day comes later, and only if production data
  shows `datetime` is set. The same check on production is read-only, but it waits for Pedro's go-ahead.
- **Half of Plaid's guesses are unsure,** so the learned layers have plenty to act on.
- **Crowd labels cannot require the entity id** (see 12c).

## The resolver

`resolveCategoryId` becomes `resolveCategory` and returns `{ categoryId, source }`. The order is:

1. manual (applied by `pickCategoryId`, unchanged)
2. `rule`: a merchant rule (7c)
3. `learned`: the herd's own fixes (12a)
4. `community`: the crowd (12c)
5. `plaid`: Plaid's detailed code, then its primary, when its confidence is VERY_HIGH, HIGH or MEDIUM
6. `ai`: 12b, only when the switch is on and credits remain
7. `plaid`: Plaid's low-confidence (LOW, UNKNOWN or missing) guess
8. `fallback`: uncategorized

The resolver stays pure, and a test pins every pair of sources. AI is asynchronous and metered, so
sync doesn't call it inside the resolver. It runs as a second pass over the rows that landed on step 7
or 8 (see 12b).

## `transactions.category_source` and `corrected_from`

- **`category_source`** is not null: `manual | rule | learned | community | ai | plaid | fallback`.
  - Sync sets it on every row it writes: `manual` when `pickCategoryId` kept a manual choice,
    otherwise the resolver's source. Every row in the bulk upsert then carries the key, so the
    key-union rule is safe.
  - `set-merchant-rule` sets it to `rule`, or to the new resolved source, on the rows it re-resolves.
  - A `before update` trigger sets it to `manual` when a row becomes manual or a manual row's
    category changes. The app's direct update (`useSetTransactionCategory` in `lib/queries.ts`) therefore
    stays as it is.
- **`corrected_from`** is set by the same trigger when a hand-picked category differs from the one
  Tusky had set. It holds the source that was wrong, and is null otherwise. This is what we measure.
- **Backfill:**
  - manual rows get `manual`;
  - non-manual rows whose category equals their merchant's rule category get `rule`;
  - the uncategorized row with no Plaid code gets `fallback`;
  - everything else gets `plaid`.

  `corrected_from` starts null.
- **Grants:** `authenticated` gets `select` on both columns and no `update`, since only the trigger
  writes them.
- **`carryForward`:** a pending row's manual category already moves to the posted row. Its
  `category_source` (`manual`) goes with it.

## 12a: learning from your own fixes

**Labels.** A label is a transaction in the herd, with the same `merchant_key`, that is either:
- manual, or
- carries a guessed source (`learned`, `community`, `ai`) and was accepted in review (`reviewed_at`
  set).

Accepting a guess is therefore a label, and no extra table is needed.

**`learnedCategory(labels, row)`** lives in `_shared/learn.ts` and is pure:
1. Keep the labels with the same direction as the row (money in or money out), and take the 10 most
   recent.
2. Fewer than 2: no answer.
3. Take the K = 5 labels nearest the row's amount by distance on `log(1 + |amount|)`. Distance means
   a $4 coffee sits near a $6 one and far from a $60 fill-up.
4. The category with the most of those labels wins, if it has at least 2 votes and at least ⅔ of the
   neighbours. Otherwise there is no answer. Labels further than 3× (or ⅓) the amount do not vote, so a far-off amount gets no guess. The ⅔ share means a tie never wins.
5. All the constants sit together at the top of the file.

This one rule covers the gas-station case: snacks and fuel at the same merchant separate by amount,
once the user has fixed each twice.

**In sync.** One query loads the labels for the merchant keys in the batch, scoped to the Item's herd.
The labels are passed as `learned:`, the way `rule:` is today (`_shared/sync.ts`).

**After a fix.** A new Edge Function, `apply-learning`, takes `{ transaction_id }`. It follows
`set-merchant-rule`'s pattern and scopes with `getCallerHerd`. It re-resolves the herd's rows for
that merchant that are non-manual and **not yet reviewed**, and writes the category and source.
- Reviewed rows are left alone: the user has already seen them.
- The app calls the function after a successful category change (`use-category-choice.ts`), then
  invalidates `['transactions']`, `['reports']` and `['settle']`.
- The "Always categorize as…?" prompt stays. A rule is still the explicit, strongest option.

**UI.**
- The review card (`review-card.tsx`) shows "Tusky guessed" under the category chip when the source
  is `learned`, `community` or `ai`. The hint names where it came from: "from your past choices",
  "from other Tusky users" or "by AI".
- The transaction screen (`app/transaction/[id].tsx`) shows "Set by …" for every source (the label column is narrow). It
  already has a line for manual rows.

**The quality measure.** `scripts/cat-quality.mjs` is read-only and targets dev, like `seed-review`.
For each source it counts the auto-set rows that the user corrected (`corrected_from`) and those
reviewed and kept. It prints each source's correction rate. We run it before and after each
milestone. "Very good" means that number falls.

## 12b: the AI fallback

**Revised 2026-09-27, after pricing the model.** The original plan metered this with a credit ledger.
Claude Haiku 4.5 costs $1 per million input tokens and $5 per million output, which works out to
about **$0.0001 per transaction** — roughly eleven cents per thousand. A ledger, a balance check and
debit-with-refund is more machinery than a cost of pennies justifies, so it is dropped. What replaces
it is an opt-in switch, a hard per-sync cap, and one place a subscription check will later sit.

- **AI is a subscriber feature.** Not gated today, because there is no billing yet, but the check has
  a single home so it never has to be hunted down: `aiAllowed(herd)` in `_shared/ai.ts` returns true
  for everyone for now and is the one function Stripe will change. The gate is server-side, never the
  client — the same rule `docs/product/monetization.md` sets for every tier limit.
- **The switch.** `profiles.ai_categorize boolean not null default false`, set by the user in
  Settings, with `grant update (ai_categorize)`. Off by default: nothing reaches a model until
  someone asks for it.
- **In `syncItem`,** after the upsert:
  - Collect the rows whose source is low-confidence `plaid` or `fallback`.
  - Stop unless the Item's connector has the switch on and `aiAllowed` passes.
  - Answer from the cache first, and take at most 50 uncached rows per sync.
  - One batched call through `_shared/ai.ts` to `claude-haiku-4-5`, with an `ANTHROPIC_API_KEY`
    secret. A failure is swallowed: the rows keep Plaid's category and the next sync may retry.
  - Write each answer only to a row that is still non-manual, and only if the answer is one of the
    built-in category ids we offered.
- **The cache is the point, not an optimization.** `ai_category_cache` is global and keyed by merchant
  and amount band. The model only ever sees built-in categories and merchant-level text, so one
  answer is correct for every herd: **a merchant any subscriber pays to resolve is then free, and
  already categorized, for everyone.** That is the same bargain as 12c's crowd labels, arrived at
  from the other direction.
- **What the model sees:** the merchant name, the raw description, the amount, Plaid's codes and the
  built-in category list. Never an account, a balance, a user or a herd. The switch's caption says so
  plainly.
- **Model call shape.** `client.messages.parse()` with `output_config.format` built by
  `zodOutputFormat`, so the reply is a validated array of `{ id, category_slug }` rather than prose
  to parse. Haiku 4.5 takes no `effort` and no adaptive thinking — classification needs neither.

## 12c: crowd labels

- **Consent.**
  - `consents (user_id, kind, granted_at, withdrawn_at)` holds the stored consent record. Its kind
    is `crowd_labels`.
  - The switch is in Settings. A one-time prompt appears after a user's third fix.
  - Withdrawing sets `withdrawn_at` and deletes that user's contributions.
- **`community_labels`** has no user, herd or account column. It holds:
  - `contributor`: HMAC(user_id, a pepper kept in Supabase Vault as `label_pepper`). One vote per
    person, and withdrawal can find their rows.
  - `merchant`: `merchant_entity_id` when present, otherwise `'k:' || merchant_key`. The dev data
    check shows entity ids are sparse; normalized names are the fallback.
  - `direction` and `amount_band`. The bands are [0, 5), [5, 15), [15, 50), [50, 150), [150, 500)
    and 500+. 12b's cache shares them.
  - `pfc_detailed` (Plaid's guess), `category_id` and `created_on date`.
  - `category_id` is always built-in: a custom category contributes its group.
  - The table is unique on (contributor, merchant, direction, amount_band), and the latest choice
    wins.
  - It has no client grants at all.
- **Writes.** A `security definer` trigger runs on a manual change, and on the review-accept of a
  guess, when the user's consent is active.
  - If anything fails, including a missing pepper, the trigger skips the contribution and never
    blocks the user's change.
  - The pepper is created by SQL on each project and never lives in the repo. `docs/ops/production.md`
    gets a step for it.
- **Reads.** Sync loads the votes for the batch's merchants.
  - A band becomes a `community` answer when at least 3 distinct contributors voted and at least 70%
    agree.
  - Below 3 contributors, nothing is served, so one person's label is never visible through another
    user's category.
- **`rls-check.mjs`** proves:
  - no member can read `community_labels`;
  - no member can read another user's `credit_ledger` or `consents`;
  - `category_source` and `corrected_from` are not client-writable.

## Known and accepted

- **Changing your mind converges slowly.** Two old labels and one new one still mix. A rule is the
  instant override.
- **Old rows have no `merchant_entity_id`** until Plaid re-sends them. The crowd falls back to
  normalized names, and two banks may name one merchant differently.
- **Learning is per herd.** A herd mate's fixes teach the whole herd, which is what shared
  categories already do.
- **AI answers are shared across users through the cache.** Only merchant-level text goes in, so
  nothing personal is shared.

## Deferred

- Time-of-day context (it waits on production data).
- Rules on amount, account or description (still deferred from 7c).
- Stripe purchase of credits (monetization).
- Preset budgets: Phase 13, its own spec.

## Verification

- `npx -y deno test supabase/functions/_shared/`:
  - resolver precedence for every pair of sources;
  - `learnedCategory`: labels that agree, a split by amount, too few labels, opposite direction, a
    tie;
  - AI: batching, debit and refund with a fake client, the cache hit, the 50-row cap;
  - the community threshold.
- `npm run typecheck && npx expo lint && npm test` in `apps/mobile`.
- `node scripts/rls-check.mjs` after each migration.
- **Dev demo:**
  1. Run `node scripts/seed-review.mjs`.
  2. On the emulator, fix one merchant twice.
  3. Sync.
  4. The next row from that merchant shows "Tusky guessed" in review.
  5. Accept it. `cat-quality.mjs` counts it as kept.
- Production `db push` right after Pedro merges each PR.
