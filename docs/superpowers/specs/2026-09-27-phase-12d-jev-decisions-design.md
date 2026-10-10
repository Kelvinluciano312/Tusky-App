# Phase 12d — Jev decisions across Tusky

**Status:** Design approved 2026-09-27. Implementation waits for the Phase 12c
(crowd labels) PR to merge, then starts on a fresh branch off `master`.

**One line:** Adopt Jev (TypeSafe AI's System One model) for every structured
decision Tusky makes, keeping Claude (Haiku) for text only. Jev is a subscriber
feature; the gate stays open during testing.

## Why

Jev returns typed values with calibrated probabilities in a single
non-autoregressive pass. It cannot hallucinate a category that isn't offered,
it reports `confidence`, and at $0.042/MTok input with free output it is
effectively free at our volume ($10 of credits ≈ 240M input tokens ≈ ~150k
categorization calls). It generates no text, so anything user-facing and
sentence-shaped stays on Claude.

This phase replaces the Phase 12b Haiku categorization fallback with Jev and
adds three new Jev-powered decisions: a recurring-detection tiebreak, a
review-deck priority score, and a shared-expense (split) suggestion.

### Two vendors, one rule

**Jev for every decision, Claude for every sentence.** Categorization,
recurring, priority, split suggestion → Jev. The future budget-tips and
financial-guidance chat (unbuilt) → Haiku, credit-based. Both subscriber-gated.

## Decisions this design makes

- **Ordering:** 12d follows 12c. 12c (Tasks 4–8) finishes and merges first; the
  Jev swap lands on a settled resolver chain, not a moving one.
- **Scope:** all four surfaces in one phase (categorization, recurring tiebreak,
  review priority, split suggestion). Broad sweep, each surface with its own way
  to be measured.
- **Subscriber gate:** unchanged. `aiAllowed(herd_id)` stays the single
  server-side seam a tier check will occupy, still returns `true`. No
  speculative entitlement schema before Stripe exists.
- **Opt-in switch:** one switch for all Jev decisions, **off by default**.
  Repurpose `profiles.ai_categorize`, relabelled in Settings to describe what it
  now covers. Off-by-default preserves the privacy posture
  (`docs/ops/security-review-2026-09-27.md`): merchant text — and now per-row
  category/amount — leaves our infra to a second processor (TypeSafe), whether
  or not the model can hallucinate.
- **Category shape:** two-stage Choice (group, then child) delivered as a single
  **speculative fan-out** request — one round trip, not two.
- **Confidence threshold:** `JEV_CONFIDENCE = 0.9`, a named constant, matching
  TypeSafe's own classification cookbook. Confidence stored on every row so the
  threshold can be re-tuned from real data via `cat-quality.mjs`.
- **`category_source`:** stays `'ai'`. Vendor-agnostic; meant Haiku, now means
  Jev. No enum change, no data migration, no resolver churn.
- **Transport:** raw HTTP, not the npm SDK (Deno compatibility unverified; the
  SDK's default env var is `TYPESAFE_API_KEY` while our secret is `JEV_API_KEY`;
  the call is one `fetch`).

## Global constraints

- **Never fail a sync.** Every Jev pass swallows its own errors and leaves the
  row/stream exactly as the non-Jev path left it. This is the 12b `runAiPass`
  discipline, extended to all four surfaces.
- **After the cursor advances.** All Jev passes run after the upsert and cursor
  advance, beside the snapshot pass, so a slow vendor never costs a
  re-pagination (12b's hard-won rule).
- **The global cache stays clean.** `ai_category_cache` is keyed by merchant and
  holds no `herd_id`. Only categorization (built-in categories, merchant-level
  text) writes it, and never for a private-account row. Per-row, herd-specific
  judgments (priority, split) never reach it.
- **Manual always wins.** `pickCategory` is unchanged; a manual category
  overrides every automatic source including `ai`.
- **`aiAllowed` + key + switch** gate every surface. Missing key → the pass is
  skipped silently.

## Architecture

One shared module, per-surface builders/readers, one injected impure client.

### `_shared/jev.ts` — the client and pure helpers

The **only** impure export:

```
askJev(state, questions, opts?) → { model, answers }   // throws on failure
hasJevKey()                                             // JEV_API_KEY present
```

- `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer
  ${JEV_API_KEY}`, `Content-Type: application/json`.
- Body: `{ state, model: JEV_MODEL, questions }`. `JEV_MODEL = 'jev-latest'`,
  pinned to a constant so a version can be frozen if accuracy moves.
- Bounded like `AI_CLIENT`: `JEV_CLIENT = { timeout: 20_000, maxRetries: 1 }`.
  A slow model must never hold a sync open past its cursor advance.
- Retry once on 429/5xx honouring `retry-after` if present; otherwise throw.

Everything else in the module is **pure** and unit-tested with no network:
question builders (produce the request `questions` object) and answer readers
(take a response, return typed results). Question ids are internal — they are
never sent to the model — so we key child questions `child__<group_slug>` freely.

### Response shapes (from TypeSafe docs)

```
Choice → { type:'choice', choice, confidence, probabilities:{opt:prob} }
Score  → { type:'score',  score,  confidence, probabilities, legend? }
Noul   → { type:'noul',   noul }        // 0..1, no confidence field
```

## Surface 1: categorization (replaces 12b Haiku)

The pure scaffolding around the model call is **kept**: `buildAskList`,
`applyAnswers`, `groupUpdates`, `cacheKeyFor`, `ai_category_cache`, and the
private-account cache exclusion. What changes: the `AskFn` implementation, and
what we write (now confidence-aware).

### The single fan-out request, per uncached merchant key

```
state: { merchant, description, amount, direction: 'in'|'out', plaid_guess }
questions:
  group:                  Choice over the 16 built-in groups
  child__<group_slug>:    Choice over that group's children   (×16)
```

All 17 Choices evaluate in parallel in one request. Built-in categories only —
that is what lets one answer serve the global cache across every herd. Custom
categories are herd-specific and stay out of this path (unchanged from 12b).

### `pickCategorization(response, categories)` — pure

1. Read `group` → winning group slug + its confidence.
2. Read `child__<winning group>` → winning child slug + its confidence.
3. `child_conf ≥ JEV_CONFIDENCE` → write **child**, `level='child'`.
4. else `group_conf ≥ JEV_CONFIDENCE` → write **group**, `level='group'`.
5. else → **decline** (cache null, as 12b does today for an unplaceable
   merchant — stops us re-asking every sync).

Groups are valid categories (they carry `plaid_category_map` entries), and
`lib/categories.ts` `groupIdOf` already gives the rollup. An unsure answer now
yields a usable group-level category instead of leaving the row uncategorized —
strictly better than 12b.

### Concurrency

Jev is one-state-per-call, so ≤ `AI_MAX_PER_SYNC` (50) uncached merchants = up
to 50 requests. Bound in-flight to ~8; 1,200 req/min is not the constraint.

### `category_source = 'ai'`, unchanged.

## Surfaces 2 & 3: the per-row fan-out (priority + split)

Both are per-row, herd-specific, **uncacheable**, and run as sync posts each
newly-posted row. One `askJev` per row carries both:

```
state: { merchant, description, amount, direction, category, herd_size }
questions:
  review_priority:   Score, 3 levels
                     ['routine', 'worth a glance', 'likely needs a fix']
  is_shared_expense: Noul   // ADDED ONLY when isShared(herd) — speculative,
                            // so we never pay for it in a solo herd
```

`is_shared_expense` uses speculative fan-out: omitted entirely in solo herds.

### Review-deck priority (Surface 2)

- Computed during sync, stored on `transactions.review_priority` (smallint).
- The Phase 10 deck (`deckReducer`/`topCard`) is a pure reducer; priority is an
  **ordering input only** — it changes what surfaces first, never what is in the
  queue. If Jev is off/failed, `review_priority` is null and the deck falls back
  to today's order untouched.

### Split suggestion (Surface 3)

- Only in shared herds (`isShared(herd)`, `lib/herd.ts`).
- Writes a nullable **hint** `transactions.split_suggested` (boolean) the app
  may surface. It **never** writes `transactions.split` — that is validated by
  `ac_transactions_split` and is the user's choice. A suggestion therefore
  cannot move a balance and never touches `['settle']`.

## Surface 4: recurring tiebreak

`_shared/recurring.ts` stays the source of truth. The heuristic is deterministic
for clear cases (no cost, no vendor dependency). Jev breaks ties **only** for a
candidate stream the heuristic flags as *ambiguous* (near its confidence
boundary):

```
state: { merchant, cadence_days, occurrences, amounts, category }
questions:
  is_recurring: Noul   // "these transactions are a recurring subscription/bill"
```

`noul ≥ 0.5` tips it in, below tips it out. Runs at end of sync where detection
already runs. Never overwrites a confident heuristic verdict. `dismissed` is
still user-only and never in the upsert payload.

## Data flow per sync (all gated on switch + key + `aiAllowed`)

1. Upsert rows; advance cursor. *(existing)*
2. **After cursor advance**, beside snapshot pass:
   a. Categorization fan-out per uncached merchant → `ai_category_cache` +
      row updates (`planReresolve`, unchanged path).
   b. Per newly-posted row: priority Score + (shared herds) split Noul →
      `review_priority`, `split_suggested`.
   c. End of sync: recurring Noul over ambiguous candidate streams only.

## Schema — one migration

New nullable columns, all **Jev-owned** — never in sync's upsert key-union (a
bulk upsert sends the union of the rows' keys; a key on only some rows nulls it
on the rest — same discipline as `reviewed_at`/`notes`):

- `ai_category_cache`: `confidence numeric`, `level text` ('child'|'group').
- `transactions`: `ai_confidence numeric`, `ai_level text`,
  `review_priority smallint`, `split_suggested boolean`.

Grants: the app reads `review_priority` and `split_suggested`; grant
`authenticated` `SELECT` on those columns per the CLAUDE.md rule (a new column is
unreachable until granted). Verify with `has_column_privilege`. `ai_confidence`
and `ai_level` are server/analytics only — no client grant. RLS is unchanged
(columns on an already-protected table), but run `rls-check.mjs` after the
migration regardless.

## Gating (all four surfaces)

```
if (!hasJevKey() || !aiAllowed(item.herd_id)) return 0;
if (!profile?.ai_categorize) return 0;   // one switch, all surfaces, off by default
```

`aiAllowed` stays returning `true` — documented as the subscription seam.
Settings label (`apps/mobile/src/app/(tabs)/settings.tsx:244`) updated to say
the switch now covers all AI decisions, not just categorization. `Profile` type
and `queries.ts` unchanged (same column).

## Error handling

Every surface swallows a Jev throw and leaves state as the non-Jev path did:

- Categorization: declines low-confidence (caches null); throw → row keeps its
  prior category.
- Priority/split: null → deck uses default order, no suggestion shown.
- Recurring: keeps the heuristic verdict.

No surface can fail a sync.

## Testing

- `jev.test.ts` (Deno, `_shared`): question builders produce correct shapes;
  answer readers pick correct winners; `pickCategorization` threshold / rollup /
  decline branches; fan-out reader maps `child__<group>` to the winning group.
- Injected fake `askJev` (mirrors the existing fake `askClaude`) drives
  `runAiPass` and the per-row pass with zero network.
- `scripts/cat-quality.mjs` extended to read `ai_confidence`/`ai_level` and
  print a calibration curve — the instrument for judging Jev vs. the Haiku
  baseline.
- `rls-check.mjs` after the migration.
- App pure-logic tests via `npm test` for any `lib/` reader touched.

## Rollout

1. Dev only. Switch on for the two test users
   (`ph.leao2099+tuskytest`, `ph.leao2099+tuskyherd`).
2. Sync real sandbox data; read `cat-quality.mjs` calibration.
3. Sweep `JEV_CONFIDENCE` if the curve suggests it.
4. Prod migration + deploy behind Pedro's go-ahead (per the production rule).

## Docs to update

- `CLAUDE.md` categorization section: `ai` source is now produced by Jev; the
  fan-out/confidence/rollup mechanics; the three new surfaces.
- `docs/ops/security-review-2026-09-27.md`: TypeSafe is a second data processor;
  merchant text + per-row category/amount leave to it when the switch is on.
- `docs/product/`: short note — Jev makes decisions, Haiku makes sentences, both
  subscriber-gated; monetization implication (AI decision cost is now negligible,
  so the credit meter is for Haiku text, not Jev decisions) flagged for later
  evaluation.

## Out of scope

- Stripe / tiers / credit metering (monetization is unbuilt; `aiAllowed` seam
  only).
- Haiku conversation features (budget tips, financial guidance) — future phase,
  credit-based.
- Removing `askClaude`/`ai.ts` Haiku code: left in place (dead but tested) or
  deleted in 12d — decided at plan time.
- Non-text Jev inputs (Jev is text-only).

## Open items for the plan

- Whether to delete the Haiku categorization code path or keep it dormant.
- Exact `review_priority` rubric wording and how the app surfaces it in the deck.
- How the app presents `split_suggested` in the Phase 11b UI.
