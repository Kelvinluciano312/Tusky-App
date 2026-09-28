# Phase 12c handoff — crowd labels

Branch `pedro-12c`. Spec: `docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md` (§12c).

## What shipped

- Migration `20261006120000_phase12c_crowd_labels.sql`, applied to dev (`ifibrsgqdibcomzxencf`):
  - Tables `consents` (`user_id, kind, granted_at, withdrawn_at`) and `community_labels`
    (`contributor, merchant, direction, amount_band, pfc_detailed, category_id, created_on`,
    unique on `(contributor, merchant, direction, amount_band)`, no client grants at all).
  - Functions `private.amount_band` (SQL twin of `_shared/crowd.ts`'s `amountBand`, sharing 12b's cache
    bands), `private.label_contributor` (HMAC of `user_id` under the Vault secret `label_pepper`),
    `private.forget_crowd_labels`, `private.contribute_crowd_label` (the `security definer` trigger
    body — never blocks the user's own change, including on a missing pepper),
    `private.consents_forget_on_delete`, `public.set_consent` (the only way to write `consents`), and
    `public.community_tallies` (server-only read of vote counts).
  - Trigger `ae_transactions_crowd_label` on `transactions`: fires on a manual change or a
    review-accept, for the acting user (`auth.uid()`) only, only with active `crowd_labels` consent,
    only for a non-private account. A custom category contributes its built-in group; `uncategorized`
    never contributes.
- The Vault pepper `label_pepper` was created on dev by SQL (`vault.create_secret(...)`), per the
  production doc's new step — never in the repo or chat.
- Resolver order updated: **manual > rule > learned > community > ai > Plaid detailed > Plaid primary
  > uncategorized** (`resolveCategory` in `_shared/categorize.ts`). A community answer is sticky, the
  same as an AI one: a later re-resolve does not take it back.
- Serving threshold: at least 3 distinct contributors and at least 70% agreement
  (`communityAnswers` in `_shared/crowd.ts`), served into sync via `loadCommunity`. Below 3
  contributors, nothing is served.
- App: a switch to share fixes with the crowd (Settings), off by default, plus a one-time prompt after
  a user's third fix (`use-crowd-prompt`).
- Functions deployed to dev: `plaid-sync-transactions`, `plaid-webhook`, `apply-learning`,
  `set-merchant-rule`.
- Fixed during the build (commit `cee7bea`): the crowd trigger's ambiguous `merchant` column
  reference, and moving `auth.uid()` inside the exception handler so a fix is never blocked by a
  crowd-write failure. Caught by `rls-check.mjs`, not by hand-review.

## Docs updated (this task)

- `docs/ops/production.md` — new `label_pepper` bullet under Secrets (create-once SQL, never rotate).
- `CLAUDE.md` — new "Crowd labels (Phase 12c)" bullet under Conventions, after "The AI fallback";
  resolver-order sentence in the Categories bullet now includes `community` between `learned` and
  `ai`.
- The spec — 12c's `rls-check.mjs` list now reads "no member can read another user's `consents`, or
  write one except through `set_consent`" (replacing the `credit_ledger` line, which was 12b's, not
  12c's). "Known and accepted" gained three entries: community answers are sticky with no backfill
  sweep; only the user's own by-hand action contributes (service-role writes never do); merchant
  lookup falls back from entity id to normalized name.
- `README.md` — Phase 12c marked done, pending merge.

## Verification results (this task, Step 6)

- `npx -y deno test --allow-env supabase/functions/_shared/` — **154 passed, 0 failed** (2s). Without
  `--allow-env`, ~8 AI-pass tests fail on Deno env permission; that is expected and not a regression,
  per the brief.
- `apps/mobile`: `npm test` — **99 passed, 0 failed**. `npm run typecheck` — clean, no errors.
  `npx expo lint` — clean, no warnings or errors.
- `node scripts/rls-check.mjs` (linked project confirmed `ifibrsgqdibcomzxencf` before running) —
  **all PASS**, both as the crowd-consent test user (`ccbd42ef-…`) and the herd-test user
  (`706f7db5-…`). Notably:
  - `read_community_labels` — denied (want denied)
  - `call_community_tallies` — denied (want denied)
  - `insert_consent_directly` — denied (want denied)
  - `own_consent_granted` — true (want true)
  - `crowd_contributed_as_expected` — true (want true)
  - `crowd_custom_is_group` — true (want true)
  - `crowd_regrant` — true (want true)
  - `crowd_withdraw_forgets` — true (want true)
  - `fix_without_pepper` — **allowed** (want allowed) — confirms a fix never blocks even without the
    pepper present in that probe.

## Deferred minors (from the review loop)

- Task 4: `crowd_regrant` probe assumes 0 pre-existing consent rows for the test users
  (brief-acknowledged; holds today).
- Task 4: the `fix_without_pepper` exception handler catches only `insufficient_privilege` — a missing
  Vault schema would raise a different error class. Very low risk in practice.
- Task 7: `use-crowd-prompt` treats a consent query still loading as "not consented", which could
  re-ask harmlessly while the query is in flight. Fix idea: skip while `isPending`.

(Task 3's ambiguous-`merchant` trigger bug was **fixed**, not deferred — see commit `cee7bea` above.)

## Remaining manual verification (Pedro) — brief Steps 1–3, not run by this task

These need the live emulator and a forced re-sync on dev; they were out of scope for this task and
are left for Pedro (or a follow-up session with emulator access):

1. **A contribution from a real fix.** With the crowd switch on as the test user, fix one non-private
   transaction in the app, then query
   `select merchant, direction, amount_band, category_id from public.community_labels where contributor = private.label_contributor('ccbd42ef-cba6-4f05-a100-a83a727255b2')`
   — expect one row for that merchant (the category's group if custom). Then accept a "Tusky guessed"
   card in `/review` — expect a second row, or the same row updated if it's the same band.
2. **The crowd serves a category (dev only).** Seed two `demo-*` contributors for that merchant/band
   (see brief Step 2's SQL), clear the Item's `sync_cursor` to force a 90-day re-pull, sync from the
   app (pull to refresh on Home), and run `node scripts/seed-review.mjs`. Expect that merchant's other
   non-manual rows in the same band to show `category_source = 'community'`, and their review card to
   read "Tusky guessed · from other Tusky users". Check with a `category_source, count(*)` query, then
   run `node scripts/cat-quality.mjs` and expect a `community` line. Clean up:
   `delete from public.community_labels where contributor like 'demo-%'`.
3. **Withdraw.** Turn the switch off. Expect the Step 1 query to return no rows.

## Production steps — WAIT for Pedro's go-ahead

None of these have been run. Per `docs/ops/production.md`, production commands always wait for
Pedro, name `--project-ref awiwcgrisyzimzxgddxu` explicitly, and the CLI stays linked to dev.

1. **Create the `label_pepper` Vault secret on production** — the same one-time SQL as dev:
   `select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'label_pepper', 'HMAC pepper for community_labels.contributor (Phase 12c)');`
   Never rotate it afterwards (see the new production.md bullet for why).
2. **Push the migration:**
   `npx -y supabase@2.118.0 db push --project-ref awiwcgrisyzimzxgddxu` (dry-run first, per
   production.md's existing convention).
3. **Deploy the four functions** touched by this phase — `plaid-sync-transactions`, `plaid-webhook`,
   `apply-learning`, `set-merchant-rule` — each `--use-api`, each naming
   `--project-ref awiwcgrisyzimzxgddxu`.

Pedro runs all three of these himself, in order, only after his go-ahead.
