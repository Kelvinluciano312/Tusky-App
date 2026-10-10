# Tusky — agent notes

Monarch-Money-style personal finance mobile app. Expo (React Native) + Supabase + Plaid Sandbox.
Approved plan/phases: see README Status. Phases 0–13 are merged, including Phase 12's four layers
(12a–12d, `docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md`). Phase 9's
Track P (production) is live and waits only on Plaid's production access for OAuth banks. Now:
Phase 14, monetization (`docs/superpowers/specs/2026-09-28-phase-14-monetization-design.md`),
milestones 14a (plans and limits) → 14b (lifecycle, reconnect merge) → 14c (purchases), all merged
→ 14d (launch readiness: Play Billing, account deletion, release builds), on `pedro-14d`. The iPhone app
(14d-2) is planned in `docs/superpowers/plans/2026-10-07-phase-14d-2-ios.md`.

**Plaid keys per project.** Dev stays on Sandbox, and all general testing happens there. Production
keys live only in the production project's secrets. Phase 6's old "key switch" step is superseded by
this split. `supabase/functions/.env` now holds **production** values (`PLAID_ENV=production`), so it
must never be pushed to dev.

**Production project** (real banks): `awiwcgrisyzimzxgddxu`. Read `docs/ops/production.md` before
touching it. The CLI stays linked to dev; production commands name `--project-ref`, and each one waits
for Pedro's go-ahead.

## Layout

- `apps/mobile/` — Expo SDK 57 app (expo-router, file routes in `src/app/`). **Read `apps/mobile/AGENTS.md` before writing Expo code** — SDK 57 APIs differ from training data.
- `supabase/migrations/` — versioned SQL. `supabase/functions/` — Deno Edge Functions (`npm:` imports); shared helpers in `functions/_shared/lib.ts`.
- `legacy/` — old Vite web demo + Flask Plaid quickstart. Reference only; never build on it.

## Commands

```sh
# app (run inside apps/mobile)
npm run typecheck && npx expo lint      # run both before committing
npm test                                # app pure-logic tests (node --test, no deps)
npx expo run:android --device Pixel_7   # emulator (x86_64); omit --device for default target
# backend (repo root; per machine, run `supabase login` + `link` once — see "First run")
npx supabase db push
npx supabase functions deploy <name> --use-api   # omit <name> to deploy all; reads config.toml
# NEVER `secrets set --env-file supabase/functions/.env` on dev: the file holds production Plaid keys.
# Set one dev secret at a time: npx supabase secrets set NAME=value
npx -y deno test --allow-env supabase/functions/_shared/    # Edge Function unit tests; Deno need not be installed (tests set env vars)
node scripts/cat-quality.mjs                    # dev: each category source's correction rate
```

**Review queue for demos:** `node scripts/seed-review.mjs [count]` puts the test user's latest posted
transactions (25 by default) back in the review queue. It works on dev only, and refuses to run if the
CLI is linked to any other project.

**Driving the emulator (agents):** use `node scripts/emu.mjs` — `ui` prints visible labels with tap
centers as text, `tap "<label>"` taps by text, `logs` shows JS errors/crashes since the last call.
Prefer `ui` over `shot`; a screenshot costs ~1.5k tokens, only take one when visual layout is the
question. JS edits hot-reload via Metro — never rebuild for them.

**Pedro's phone, remotely (Pixel 10 Pro, arm64, wireless adb):**
- The phone reaches this PC's Metro over Tailscale. The PC's Tailscale IP is `100.108.96.124`, and a firewall rule "Metro over Tailscale" allows port 8081 on that interface only.
- Start Metro with `$env:REACT_NATIVE_PACKAGER_HOSTNAME='100.108.96.124'; npx expo start --dev-client`.
- The phone then opens `http://100.108.96.124:8081`. When wireless adb is up, `adb shell am start -a android.intent.action.VIEW -d "exp+tusky://expo-development-client/?url=http%3A%2F%2F100.108.96.124%3A8081" com.ouroborosstudios.tusky` opens it for him.
- A white screen with no bundle request in Metro means the phone cannot reach the PC: check the firewall and Tailscale.
- **A Metro that outlived its Claude session hangs.** It still answers `/status`, but bundle requests stall, so the phone shows a white screen. After any new session, kill whatever listens on 8081 and start Metro fresh. Test with a real bundle fetch (`/node_modules/expo-router/entry.bundle?platform=android&dev=true`), not `/status`.
- A native rebuild needs wireless adb, which works only on the same Wi-Fi: `npx expo run:android --device Pixel_10_Pro`. Expo matches the model name, not the adb serial.

## Hard-won gotchas

- **Expo Go cannot run this app** (native Plaid SDK). Dev builds only.
- **Plaid Link's OAuth flow does not work on an emulator.** With an OAuth bank (Chase in Sandbox),
  Link's webview loses its `link/workflow/poll` requests while Chrome holds the bank page and returns
  to a blank screen. Test Link against OAuth banks on a physical device; everything else is fine on
  the emulator.
- `expo run:android` builds ONLY the target device's ABI — an arm64 build crashes the x86_64 emulator with "Cannot find native module". Build per device.
- Unset `EXPO_PUBLIC_*` env vars arrive as `''`, not `undefined` — use `||` fallbacks, never `??`.
- Env vars bake into the JS bundle at Metro start — restart Metro after editing `.env`.
- **`options.transactions_url_taxonomy` does not work with `plaid@30`.** Plaid's current docs list it
  on `/transactions/sync`, but the API rejects it with `UNKNOWN_FIELDS` — the SDK pins an older
  `Plaid-Version`. The account's default PFC taxonomy applies instead; the `uncategorized` fallback in
  `_shared/categorize.ts` is what absorbs any primary we don't map. General lesson: Plaid docs describe
  the current API, not the version your SDK pins.
- **Never log a caught Plaid error whole.** The SDK throws an axios error that carries its request: the
  `PLAID-SECRET` header, and on some paths a bank access token in the body. Log `loggable(err)`
  (`_shared/lib.ts`): it keeps only Plaid's code and message, and passes any other error through with
  its stack. The raw object also overflowed the 10,000-character log line, hiding Plaid's own message.
- **Plaid's allowed Android package names are per Plaid team.** Production's keys are on Kelvyn's team
  and dev's Sandbox keys on Pedro's individual account, so `com.ouroborosstudios.tusky` must be listed
  on both. Missing, `/link/token/create` answers 400 `INVALID_FIELD` and the function returns 500.
- **Supabase Free Plan pauses the project after ~7 days of inactivity.** Symptom: every request to
  `*.supabase.co` returns Cloudflare **521 web server is down** while `supabase.com` itself is fine —
  looks like a dead key or bad network, is neither. Fix: dashboard → **Resume project**. Data and config
  survive, restorable for up to 1 year.
- **Android builds need JDK 17, not whatever Android Studio bundles.** Android Studio's `jbr` became
  JDK 25, and on it `configureCMakeDebug` fails for react-native-screens/worklets with only
  `WARNING: A restricted method in java.lang.System has been called`. Point `JAVA_HOME` at a JDK 17 for
  the build (Gradle's own download lives under `~/.gradle/jdks/eclipse_adoptium-17-*`; on Pedro's PC use
  `eclipse_adoptium-17-amd64-windows.2`. The folder without `.2` nests the JDK one level deeper, and
  pointing `JAVA_HOME` at it fails with "JAVA_HOME is set to an invalid directory").
- `android/` and `ios/` are gitignored; `expo run:android` regenerates them via prebuild. Never hand-edit them — native config belongs in `app.json` under `expo-build-properties` (that is where `minSdkVersion: 26`, required by Plaid SDK 6.0, lives), or it is wiped on the next prebuild.

## First run on a fresh clone

```sh
cd apps/mobile
npm install
cp .env.example .env     # EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY
npx expo run:android     # prebuild generates android/, then builds
```

Both `apps/mobile/.env` and `supabase/functions/.env` are gitignored and never travel with the repo — recreate them per machine (Supabase dashboard → Settings → API Keys; Plaid dashboard → Keys). The backend CLI also needs, once per machine:

```sh
npx supabase login
npx supabase link --project-ref ifibrsgqdibcomzxencf
```

## Platform notes

### Linux

- Prereqs: Node 20+, JDK 17, Android SDK. Export `ANDROID_HOME=$HOME/Android/Sdk`, put `$ANDROID_HOME/platform-tools` on `PATH`, and accept licenses (`sdkmanager --licenses`) or Gradle aborts.
- Emulator needs KVM: `ls /dev/kvm` must succeed. If it does not, `sudo usermod -aG kvm $USER` then log out and back in.
- Physical device: `adb devices` printing nothing or `unauthorized` is usually missing udev rules — install `android-udev-rules` (or add a rule for your vendor ID), then `adb kill-server && adb start-server`.
- Metro dying with `ENOSPC: System limit for number of file watchers reached` → raise the inotify limit:
  `echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/99-inotify.conf && sudo sysctl --system`
- Normal POSIX shell — the Windows caveats below do not apply.

### Windows

- Repo must live at a short, space-free, non-OneDrive path (e.g. `C:\dev\Tusky-App`), or ninja/CMake fails with "build.ninja still dirty".
- PowerShell 5.1: no `&&`; embedded `"` in `git commit -m` here-strings breaks arg passing (avoid double quotes in messages); binary output needs `adb pull`, never `>` redirection.

## Conventions

- All Plaid calls go through Edge Functions; the app never sees access tokens (`plaid_tokens` has zero client grants/policies).
- **Herds own the data** (Phase 9b). Every user belongs to exactly one herd (`herd_members.user_id`
  is unique), and a personal one is created at signup by `handle_new_user`.
  - **Access.** `herd_id` is the access boundary on every owned table. Policies use
    `herd_id = (select private.my_herd_id())`. Account-bearing tables also require
    `account_id = any ((select private.my_account_ids())::uuid[])`, which is what hides another
    member's private account. The `::uuid[]` cast is required: without it, `= any ((select …))` is
    read as a subquery and fails with `uuid = uuid[]`.
  - **`user_id` on Plaid data** (items, accounts, transactions, snapshots, streams) means "connected
    by". It decides who may reconnect or disconnect a bank and which banks leave with a member, never
    who may read a row.
  - **Config tables** (budgets, category_overrides, merchant_rules, custom categories) have no
    `user_id`. A built-in category is `herd_id is null`. Client inserts get
    `herd_id default private.my_herd_id()`.
  - **Composite keys.** `(item_id, herd_id)` and `(account_id, herd_id)` cascade on update, so moving a
    bank to another herd is one `update plaid_items set herd_id`. They are the ONLY foreign keys to
    their parent: a second one makes PostgREST refuse embeds with PGRST201.
  - **Triggers.** `fill_herd_id` fills `herd_id` on Plaid inserts, so server code never names it.
    `category_in_herd` refuses a category from another herd, which an FK check would allow because it
    bypasses RLS.
  - **Edge Functions** scope with `getCallerHerd` (`_shared/lib.ts`).
  - **Membership (9c).** Every membership change goes through the `herd` function (logic in
    `_shared/herd.ts`), which calls `merge_into_herd` (join) and `leave_herd` (leave and remove). Only
    service_role may execute them, so each runs in one transaction. A join moves everything the joiner
    has; where both sides set the same override or rule, or the herd already has budgets, the herd wins.
    A leaver takes the banks they connected; the herd keeps config, and custom categories on the leaver's
    rows fall back to their group first. Invites are single-use 8-character Crockford codes, 7 days,
    max 6 members. `accounts.is_private` is changed only by the account's connector
    (`accounts_private_by_connector` trigger). Herd mates see each other's profiles. The app resets its
    whole query cache after a join, leave or removal.
  - **Who paid (9d).** `accounts.owner_id` (null = Joint) defaults to the connector on insert, and any
    member may change it. `transactions.paid_by` (null = Joint) is set by the database, never by sync's
    payload: `ab_transactions_paid_by` copies the account's owner onto each new row, and
    `accounts_owner_reapply` re-applies a new owner to the rows where `paid_by_is_manual` is false. An
    owner or payer must be a member of the row's herd (`private.is_herd_member`, which triggers call as
    the app's user; that is why it lives in `private`). Sync carries a hand-picked payer from pending to
    posted (`carryForward`), except for a payer who has since left. Leaving hands the leaver's banks to
    them as owner and payer, and makes accounts they owned on others' banks Joint. The app shows who-paid
    UI only in herds of two or more.
  - **Shared money (11; 15d).** Since Phase 15d, `paid_by` means **"spent by"**: a tag that organizes a
    joint account and never creates a debt by itself. The account's owner is who paid. The app gates every shared feature on `isShared(herd)` (`lib/herd.ts`). `monthly_person_totals`
    is `monthly_category_totals` split by `paid_by`. A payer or owner change must refresh `['transactions']`
    and `['reports']`, because the feed filters by payer and Reports totals by person.
  - **Splits and settle-up (11b).**
    - **Only a `split` creates a debt** (15d): where the split differs from who paid (the account's owner;
      Joint = everyone equally). An unsplit row is for whoever paid, so it squares itself.
    - `transactions.split` (`{ user_id: percent }`) is validated by `ac_transactions_split`: two or more
      members, totalling 100. Setting a split nulls `paid_by`; choosing a person clears the split.
    - `carryForward` moves a split from pending to posted, like a payer.
    - `shared_lines` lists every row that can create a debt (split rows only); private accounts are left
      out, so every member sees the same balance. `settlements` holds recorded payments.
    - The math is `lib/settle.ts`, kept in whole cents per purchase so the balance squares exactly.
    - Anything that can move a balance must invalidate `['settle']`: payer, split, owner, hidden, private,
      category.
  - **Questions (15d).** `transaction_questions`: one member asks another what a row was. Asking requeues
    the row (`reviewed_at` null), and `orderQueue` puts my open questions first, even outside the batch.
    The database answers a question (`af_transactions_answer_questions`) when its addressee changes who
    spent it, the split or the memo, or reviews the row. In-app only; push notifications come later.
    Question queries live under `['transactions', 'questions']`.
  - **The app hides connector-only actions**: reconnect, disconnect, the Private switch and the sandbox
    tools show only when `item.user_id` is the signed-in user.
  - **`node scripts/rls-check.mjs`** proves every member sees exactly their herd minus others' private
    accounts, and that forbidden writes fail. It runs as each user inside a rolled-back block, with no
    credentials. Run it after any migration that touches RLS, grants or views.
    `--join <joiner> <host>` and `--join-leave <joiner> <host>` first rehearse a membership change in
    the same rolled-back block (the joiner's first account made private), so two-member visibility is
    tested without committing anything.
- New tables: enable RLS, add herd policies (above), then grant `authenticated`
  exactly what the app uses — **a new table is unreachable from the app until you do**. Since Phase 6
  (`20260924120100_phase6_revoke_default_grants.sql`) `postgres`'s default privileges in `public` give
  anon and authenticated nothing (service_role still gets everything), and every older table was revoked
  and re-granted to match what the app uses. Before that, the defaults gave anon and authenticated EVERY
  privilege, and a column-scoped `grant update (col)` restricted nothing. Check with
  `has_column_privilege('authenticated', '<table>', '<col>', 'UPDATE')`. A table-level `revoke` also
  drops that table's column grants, so re-issue them afterwards. Since 9a, functions `postgres`
  creates in `public` no longer get `EXECUTE` from PUBLIC; grant it per function when one is meant to
  be called.
- **Disconnecting a bank** (`plaid-disconnect-item`, logic in `_shared/connections.ts`) calls
  `/item/remove` FIRST, and changes local state only if that succeeds or returns `ITEM_NOT_FOUND`. The
  token is the only way to stop Plaid's billing, so it is never deleted after a transient error. "Keep
  history" sets `status = 'archived'` (token, streams and today's snapshots deleted; accounts,
  transactions and past snapshots kept). "Delete everything" deletes the `plaid_items` row and lets the
  cascade do the rest. Disconnect and `syncItem` share `claimItem`, which never claims an archived Item.
  Every query of live data must therefore exclude archived Items: Home's `useAccounts` does it in SQL,
  and the sync, webhook and snapshot paths skip them.
- Duplicate links are refused in `plaid-exchange-token` **before** the token exchange (409
  `duplicate`), by `isDuplicateLink`: same institution plus an account with the same name and mask on a
  live Item. Archived Items never block a relink.
- **Categories are two levels** (Phase 7a). The 16 original rows are the groups (`parent_id` null) and
  keep their ids; 89 children hang off them (61 from 7a, 28 more in 15h). `categories_enforce_tree` allows a parent only if it is a
  built-in group, and copies the group's `kind` onto the child. Sync resolves **manual > rule (7c) > learned (12a) > community (12c) > ai (12b) >
  Plaid detailed (`plaid_detailed_map`) > Plaid primary (`plaid_category_map`, whose entries are
  groups) > uncategorized**: `resolveCategory` in `_shared/categorize.ts`, with `pickCategory` on
  top. `credit_card_payment` is transfer-kind, so it leaves spending and cash flow, but
  `ignoredCategoryIds` keeps it in recurring detection: a card bill still has a due date. Rollups go
  through `lib/categories.ts` (`groupIdOf`, `rollupByGroup`), and a group and its children are never
  budgeted at once (`budgetsReplacedBy`). `transactions.merchant_key` is a generated column, the SQL
  twin of `normalizeMerchant`. Change both together, or rules and renames (7c) stop matching.
- **Custom categories and overrides** (Phase 7b). The app reads `user_categories`, never `categories`
  directly. That view applies the herd's `category_overrides` (name, colour, hidden) to the built-ins and
  adds the herd's custom rows. Overrides are for built-ins only (a trigger refuses custom rows). A custom
  category is a child of a built-in group. The client may `insert (name, parent_id, icon, color)` and
  `update (name, icon, color)`, and nothing else. `parent_id` is insert-only because
  `categories_enforce_tree` cannot stop a group being made its own parent. Clients cannot delete: the
  `delete-category` function moves the category's transactions (manual flags kept), streams and budget
  first. Sync loads only built-in categories into its shared context, and adds the Item's herd's custom
  transfer categories per Item before recurring detection.
- **Merchant rules** (Phase 7c). `merchant_rules` (one per herd and `merchant_key`) holds a category, a
  display name, or both. Clients only read it; every write goes through `set-merchant-rule`, which
  re-resolves the merchant's non-manual rows with `resolveCategory` whenever the category part
  changes, so removing a rule puts back what learning (12a) or Plaid says. Sync loads the Item's herd's rules and passes
  `rule:` to the same resolver. Renames apply only when data is read (`lib/merchants.ts`). Rows read the
  rules themselves (`useMerchantRules`), so every surface shows the same name. `delete-category` moves
  rules to the group before its delete: the rules FK has no cascade, on purpose.
- **Learning from fixes** (Phase 12a). `transactions.category_source` records where each category came
  from (`manual | rule | learned | community | ai | plaid | fallback`), and `corrected_from` which
  source a hand-picked category replaced. The `ad_transactions_category_source` trigger stamps both;
  the client never writes them. Labels are a merchant's manual rows plus accepted guesses
  (`_shared/learn.ts`), loaded by `loadLabels`; a member's private-account labels teach only their
  own rows. Sync, `set-merchant-rule` and `apply-learning` all re-resolve through `planReresolve`,
  and `apply-learning` touches only unreviewed rows. `node scripts/cat-quality.mjs` prints each
  source's correction rate. Spec: `docs/superpowers/specs/2026-09-26-phase-12-categorization-engine-design.md`.
- **The AI fallback** (Phase 12b; answered by Jev since 12d). Opt-in per user (`profiles.ai_categorize`,
  off by default) and only over rows nothing else could settle. `_shared/ai.ts` is pure except the
  `JevAsk` that `jevCategorizer` is given. `runAiPass` in `_shared/sync.ts` never throws: a missed
  category is not worth failing a sync over. `ai_category_cache` is GLOBAL and has no `herd_id` — the
  model sees only merchant text and built-in categories, so one answer serves every herd — but a
  private account's row is never cached. Since 14a, `aiAllowed(plan)` (`_shared/plans.ts`) gates it
  on the connector's plan. Three things are easy to undo by
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
  - **Custom categories** (15h, `_shared/custom-ai.ts`, `runCustomPass` right after `runAiPass`).
    Unreviewed, non-manual rows whose source is ai/plaid/fallback and whose built-in group has the
    herd's own children get one Choice: those children (as `c0`, `c1`, … so no id reaches the model)
    or `keep`. Written only above `JEV_CONFIDENCE`. Cached in `ai_custom_cache`, per herd, keyed by the
    global key plus the group and the custom set offered (a new custom category asks again); private
    rows are never cached. Learning (12a) already learns custom categories from fixes.
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
- **Crowd labels** (Phase 12c). Contributions are written only by the `security definer` trigger
  `ae_transactions_crowd_label`, for the acting user (`auth.uid()`) with active `crowd_labels` consent
  — never by a service-role rule, sync, or `apply-learning` write. `community_labels` has no user,
  herd or account column and no client grants at all: the pool is server-only. `contributor` is an
  HMAC of the user's id under the Vault secret `label_pepper`, so one person casts one vote per
  merchant/direction/band and withdrawal can find and delete their own rows. Serving needs at least 3
  distinct contributors and at least 70% agreement (`communityAnswers` in `_shared/crowd.ts`); below
  that, nothing is served, so one person's label never leaks through another user's category.
  `private.amount_band` is the SQL twin of `amountBand`, the same bands 12b's AI cache key uses. A
  community answer is sticky like an AI one: `community` is a source in `resolveCategory`, so a later
  re-resolve does not take back an answer already shown. Consent (`consents`, kind `crowd_labels`) is
  written only through `set_consent` — never a direct client write — and withdrawing deletes that
  user's contributions.
- **Preset budgets** (Phase 13). `lib/presets.ts` is pure: it takes the last 3 full months of
  `monthly_category_totals`, takes a median per line, and caps each bucket by a share of the median
  income (whole dollars, so pennies of income read as none). Built-in group slugs decide needs from
  wants, and `food_and_dining` is budgeted as its categories so a group and its children are never
  budgeted at once. Applying calls `replace_budgets(p_lines jsonb)`, a `security invoker` function
  that swaps the herd's budget rows in one transaction. Spec:
  `docs/superpowers/specs/2026-09-26-phase-13-preset-budgets-design.md`.
- **Plans** (Phase 14a).
  - `plans` holds the limits: banks, history days, AI, and self or herd scope.
  - `subscriptions` has one row per user and is written only by the service role: the signup
    trigger's 30-day trial, the store webhook and plan-refresh (14c), and the daily job.
  - `private.effective_plan` picks the best of the user's own live row, a herd mate's live
    `tusk_herd`, and `free`. `plan_for(user)` (service role only) adds the limits and `banks_used`;
    `my_plan()` is the app's view of it.
  - A bank counts against its connector's plan, or against the herd's pool under `tusk_herd`.
    Archived banks never count.
  - `plaid-create-link-token` and `plaid-exchange-token` refuse a new bank with
    `402 { error: 'plan_limit', plan, max_banks }`. Update mode is never refused. Link-token sets
    `days_requested` from the plan. Exchange-token checks again after recording the Item and removes it
    at Plaid if a race tipped the plan over: only the bank past the limit in link order goes.
  - `scripts/plan-check.sql` proves the resolver on dev. Spec:
    `docs/superpowers/specs/2026-09-28-phase-14-monetization-design.md`.
  - **Lifecycle (14b).** `plan-enforcer` runs hourly since 16a (pg_cron → pg_net, minute 0) and is public, so it
    checks `x-cron-secret` against `CRON_SECRET` first. Vault holds `cron_secret` and `project_url`
    per project; without them the job does nothing. Free archives every bank at once; a smaller plan
    opens a 7-day window (`subscriptions.over_limit_since`), then archives the newest past the
    limit. `{ "dry_run": true }` reports without acting. The app's `planBanner` (`lib/plan-banner.ts`)
    warns 3 days before a trial ends and through the window.
  - **Reconnect merge (14b).** Every sync runs `mergeReconnected` (`_shared/merge.ts`): accounts of the
    same connector, institution, name and mask on an archived Item pair with the new ones; in the
    overlap, edits move to the twin (date, amount, merchant_key) and the kept rows are deleted. It
    runs every sync because Plaid delivers history in stages, and it never overwrites a value.
  - **Purchases (14c).** RevenueCat's app user id is the Supabase user id. Only the server grants a
    plan: `revenuecat-webhook` (public; `Authorization` compared with `REVENUECAT_WEBHOOK_SECRET`) and
    `plan-refresh` (the app, after a purchase or restore) both run `syncSubscriber` in
    `_shared/revenuecat.ts`, which re-fetches the subscriber from RevenueCat and never reads the event
    body beyond its ids. It never changes a `comp` row, changes a trial only for a live purchase, and
    never writes `over_limit_since`. Dev buys through RevenueCat's Test Store (store `test`, accepted
    only where `PLAID_ENV=sandbox`). `EXPO_PUBLIC_PROD_REVENUECAT_KEY` stays empty until launch, so
    production's paywall says plans are coming soon. The paywall's prices come from the store and its
    limits from `plans`; packages are `<plan>_monthly` / `<plan>_yearly` in the `default` offering.
  - **Store products (14d).** Play has one subscription per plan and period (`tusk_monthly`, …), so
    RevenueCat's ids read `tusk_monthly:<base plan>`; Test Store products may carry `_v2`. `periodOf`
    and `baseOf` (`lib/paywall.ts`) accept every form, and `productChange` hands Play the old
    subscription id without its base plan. A higher plan or monthly → yearly applies now (proration);
    anything else waits for renewal. `plan-refresh` answers 429 `too_soon` within 10 s of the last
    refresh (`subscriptions.refreshed_at`, claimed in one conditional update); the app then refetches
    the plan at 15 s and 60 s.
  - **Deleting an account (14d, 16d).** `delete-account` (logic in `_shared/account.ts`) takes
    `{ password }` and verifies it FIRST (`verifyPassword`: a throwaway anon client, `signInWithPassword`
    as the caller's email, its session signed out `scope: 'local'`; verifying in the app would replace
    the session). Missing or wrong answers 403 `wrong_password` and touches nothing; an Auth outage
    throws (500), also before anything is touched. The app's `DeleteAccountSheet` asks for the word
    `DELETE` (case-sensitive) and the password, and carries the subscription warning with a Manage
    subscription link. Then: leave the herd if
    others remain, then `/item/remove` every live Item and stop on the first failure (502
    `plaid_failed`, nothing deleted: the token is the only way to stop Plaid's billing), then delete
    the personal herd through `delete_personal_herd(p_user)` (service role only: it takes the same
    locks as a join and refuses, 409 `busy`, a herd with another member or a live bank, so a join
    during the Plaid calls can never get a shared herd deleted; never delete a herd by id here) and
    the auth user (the cascade does the rest), then ask RevenueCat to forget the
    purchaser (errors only warned). It does not cancel a store subscription; the app warns first
    (`deleteWarning`). A deleted member's settlements go with them.
  - **Release builds.** EAS profiles and the Play upload flow: `docs/ops/release.md`. **Every store build
    is production** (real banks), internal testing included; Sandbox is for dev builds only. Legal pages live on the studio site (Ouroboros-Inc repo, `public/tusky/`); `constants/legal.ts` holds the URLs.
- **First run** (Phase 15c). The root layout gates a session with `gateFor` (`lib/first-run.ts`):
  `accept-terms` until the active `terms` consent matches `TERMS_VERSION` (`constants/legal.ts`), then
  `onboarding` until `profiles.onboarded_at` is set, then the app. A failed read opens the app.
  - **Terms** are a `consents` row of kind `terms` with a `version`. Sign-up sends `terms_version` in
    the user metadata and `handle_new_user` records it (with email confirmation there is no session
    to call from); `accept_terms(p_version)` covers everyone else. Bumping `TERMS_VERSION` asks
    everyone again; a newer acceptance closes the older row.
  - **Crowd labels are on for new accounts**: `handle_new_user` inserts the consent. Onboarding and
    Account & privacy both show the switch.
  - **Password rules** (15b, 16c): 12+ characters, a lowercase letter, an uppercase letter, a digit, a
    symbol, not the email's name (`lib/password.ts`). Sign-up and the password sheet ask twice
    (`passwordsMatch`). The hosted projects enforce length and `lower_upper_letters_digits_symbols` in
    the Auth dashboard (`config.toml` is only the local copy). Existing users keep signing in; the
    rule applies on their next change.
- **Recurring → calendar** (15g). Tapping a recurring row offers "Add to calendar", which opens the
  phone's own new-event screen through `createEventInCalendarAsync` from `expo-calendar/legacy`
  (SDK 57 made the root export throw). It needs no calendar permission, so the config plugin is left
  out of `app.json` on purpose: adding it would request READ/WRITE_CALENDAR and change the Play Data
  safety answers. `lib/calendar.ts` (`eventFor`) builds the all-day repeating event.
  expo-calendar is native: dev clients need a rebuild.
- **Account & privacy** (`app/account.tsx`, 15f) holds sign-in, the AI and crowd switches
  (`components/privacy-switches.tsx`), legal links, and a quiet "Delete my account" at the bottom.
  Settings links to it in one row.
- **Two-step sign-in (16e).** Opt-in (`profiles.two_factor`, default off), by emailed code, **bound to the session on the server**.
  - **Why not `amr`.** `verifyOtp({ type: 'email' })` makes its OWN session with `amr` `[{method:'otp'}]` and no password anywhere, so a mailbox alone could mint a "verified" session and skip the password. The JWT's `amr` is therefore never the proof (the first 16e design was exactly that, and was wrong).
  - **The rule.** A session is verified when `two_factor_sessions` has a row for its `session_id` (and the user's id). Only the `two-factor` Edge Function writes it: POST `{ code }` from a session whose `amr` has `password` (otherwise 403 `password_session_required`: an otp- or recovery-created session can never be marked), it checks the code on a throwaway anon client (`verifyOtp`, then revokes that probe session), and marks the CALLER'S session. Wrong code: 403 `wrong_code`. **Attempts are reserved atomically BEFORE the code is checked** (`take_two_factor_attempt`, service role only, one advisory lock per user): at most 5 per session AND 10 per user across all sessions in 15 minutes, else 429 `too_many_attempts` (`two_factor_failures`; a fresh sign-in is not a fresh budget, and parallel guesses cannot slip past a stale count). A wrong code keeps its attempt, success clears the user's, and a check that could not run (outage) refunds its attempt. The vendor's own limits sit underneath. The function must NOT call `requireSecondStep`. The session is not replaced, and a token refresh keeps its `session_id`, so it stays verified. Both tables are server-only (RLS on, no policies, no grants) and have FKs to `auth.sessions` with `on delete cascade`, so signing out clears them.
  - **Enforcement.** `private.my_herd_id()` returns null when `two_factor` is on and `private.session_verified()` is false, so every herd policy (and `my_account_ids`) shows and accepts nothing to an unverified session. Own profile, subscription and consents stay reachable, so the gate can tell why. `public.my_second_step_done()` is the app's read of the same boolean. The client has no UPDATE on `two_factor`: only `set_two_factor(p_on)`, which itself needs a verified session (so a password alone cannot switch it off or on). Edge Functions run as the service role, so each user-facing one calls `requireSecondStep` (`_shared/lib.ts`, pure rule in `_shared/two-factor.ts`) right after `getAuthedUser`: 403 `two_factor_required`. Put it in any NEW user-facing function. `rls-check` has the `tf_*` cases (otp-only claims, another user's marked session, unmarked sessions).
  - **Known limit.** Whoever controls the mailbox can reset the password and then pass the code too: email-code two-step protects a stolen password, not a stolen mailbox.
  - **App.** `useFirstRun` also reads `profiles.two_factor` and, only when it is on, `my_second_step_done()`; `gateFor(state, TERMS_VERSION)` returns `verify` first when `state.secondStepDone` is not true (`lib/two-factor.ts`, `lib/first-run.ts`). Needs SMTP and a Magic Link template showing `{{ .Token }}` per project; both projects have them since 2026-10-06 (Resend; the dashboard settings are listed in `docs/ops/production.md`, "Settings outside the repo").
  - **Screens (16e app).** The root layout guards `app/verify.tsx` on `gate === 'verify'`. `verify` sends the code once (`sendLoginCode`, `lib/login-code.ts`; the last send per address is kept at module level so a remount never mails twice), takes it in `CodeEntry` (`components/code-entry.tsx`: digits only, auto-submits at `CODE_LENGTH`, Verify at 6+, Resend with a 60 s countdown), and `confirmLoginCode(code)` calls the `two-factor` function (errors through `readFunctionError`, worded by `codeFailureMessage`), then the whole query cache is invalidated so the gate re-evaluates. "Sign out" is the way back. **`CODE_LENGTH` (8) must equal Auth -> Email OTP Length**: the hosted dev project sends 8 digits though `config.toml` says 6. The Account & privacy switch (`TwoFactorSwitch`, `CodeSheet`) asks for a fresh code in both directions: `confirmLoginCode` marks the session, then `set_two_factor`. A function's 403 `two_factor_required` is caught in `readFunctionError`, which calls `notifyTwoFactorRequired`; the root layout invalidates `['first-run']` so the gate re-evaluates. Do not toggle a field's `editable` while submitting: it drops focus and the keyboard.
- **Dialogs (16f).** Never use React Native's `Alert`: ESLint refuses the import. `dialog.alert(title, message?, buttons?, options?)` (`components/ui/dialog.tsx`) has the same signature and semantics, so it works from hooks and mutation callbacks outside React. `<DialogHost />` sits once in the root layout and is itself a `Modal`, so it shows above Sheets. Several calls queue; a button closes the dialog first, then runs its `onPress`. Scrim tap and the back button press the `cancel` button (or just dismiss, or do nothing with `cancelable: false`). The queue logic is pure (`lib/dialog-queue.ts`, tested). `Button` has a `destructive` variant.
- **Screen sizes (16g).** Phones fill the width and stay portrait (`app.json` `orientation: portrait`).
  Android 16 ignores that lock on windows 600dp and wider, so tablets rotate: every screen must work
  in landscape. `constants/theme.ts` `Layout` holds the caps (`maxContent` 640, `maxWide` 1040,
  `maxSheet` 560, `maxDialog` 420). Spread `Layout.column` into every ScrollView/list
  `contentContainerStyle` (or wrap fixed content in `<Column>`, `components/ui/column.tsx`), and
  `Layout.sheet` into a bottom sheet's panel. A one-off Modal sheet dims with a full-screen
  `absoluteFill` backdrop on the `KeyboardAvoidingView`, never a `flex: 1` Pressable above the panel,
  or the sides of a capped panel stay undimmed. Headers and the tab bar stay full width. Home goes
  two columns from 900dp (`twoColumns`, `lib/layout.ts`). The review deck scrolls its card when a
  landscape window is shorter than the card. A row's text beside an icon needs `flex: 1` (see
  `password-checklist.tsx`), or Android measures it too narrow and clips or wraps it; labels beside
  values use `minWidth`, not a fixed `width`. Check on AVDs `Small_Tablet` (960x600dp), `Pixel_Tablet`
  (1280x800dp) and `Pixel_7`. The tablet AVDs are API 35, which still honours the portrait lock, so
  for real tablet behaviour either set `android:screenOrientation="unspecified"` in the generated
  `android/` manifest (gitignored, rebuild) or, on `Pixel_7` (API 37), run
  `adb shell wm size 1600x2560; adb shell wm density 320`, and always `wm size reset; wm density reset`
  after. Small phones: `wm size 720x1280`, `wm density 320`, `settings put system font_scale 1.3`
  (reset to 1.0). Do not tap the dev "Switch to Real data" banner while signing in: it sits under the
  password field on a small screen and sends the login to production.
- **`Sheet` (`components/ui/sheet.tsx`) runs its close animation only when mounted.** A no-op
  `setMounted(false)` on a closed sheet made React drop the render-phase `setMounted(true)` on the
  next open, and no Sheet-based picker ever appeared. Keep the `else if (mounted)`.
- **Bottom sheets need `KeyboardAvoidingView behavior="padding"` on Android too.** A `Modal` is its own
  window: the activity's resize for the keyboard never reaches it, and a text field there has the whole
  sheet covered by the keyboard (`budget-sheet.tsx` and `category-sheet.tsx` are the reference).
- **App pure logic is tested with `npm test`** (`node --test src/lib/*.test.ts`; Node strips the types).
  A module under test may import other modules only as `import type`, or at runtime by relative
  `./x.ts` path (`allowImportingTsExtensions` is on). A `@/` alias or a React Native import breaks
  the run. TS 6 no longer auto-includes `@types`, so each test file starts with
  `/// <reference types="node" />`.
- **Transaction review** (Phase 8). `reviewed_at` null means "in the queue" (posted rows only), and
  `notes` holds the memo. Both are user-owned: sync's upsert must never include them. A bulk upsert sends
  the union of the rows' keys, so a key on only some rows nulls it on the rest. `carryForward`
  (`_shared/review.ts`) moves a pending row's memo and manual category onto the posted row that replaces
  it. The `/review` queue is a per-visit id snapshot kept outside `['transactions']` on purpose.
  Since Phase 10 it is a deck of cards:
  - Swipe right to accept, left to skip to the back; Undo reverses the last move.
  - The deck logic is pure (`deckReducer`/`topCard` in `lib/review.ts`); the gestures use Reanimated 4 and Gesture Handler (`GestureHandlerRootView` wraps the root layout).
  - Write shared values with `.set()` and read them with `.get()`, never `.value`: the React Compiler lint rejects `.value` writes.
- **Review window (16b).** Only the last two weeks go to review. A row sync inserts dated before its
  Item's `created_at` minus `REVIEW_WINDOW_DAYS` (14) gets `reviewed_at = now(), auto_reviewed = true`
  (`reviewCutoff`, `partitionAutoReview` in `_shared/review.ts`). Those rows go in their own upsert
  that carries both columns, and every other row in a second upsert without them (union of keys), so a
  failure between the two can never leave old history in the queue. Keyed on the date, not "first sync", because Plaid delivers history in stages;
  only truly new posted rows (no row of their own, no pending predecessor) qualify. `auto_reviewed` is
  server-only and keeps such rows out of `merchant_labels`' accepted guesses (a guess nobody looked at must
  not teach), and `ag_transactions_clear_auto_reviewed` clears it when `reviewed_at` goes back to null (a
  question requeue), so a later human review counts. Crowd contributions need `auth.uid()`, so a system
  review never contributes.
- Recurring streams are derived: detection (`_shared/recurring.ts`) runs at the end of every sync and
  owns every column except `dismissed`, which only the user writes. Never add `dismissed` to its
  upsert payload.
- **Aggregate views carry their own security.** Views cannot have RLS, so a view over user data needs
  `with (security_invoker = on)` — without it the view runs as its owner, `postgres`, who owns the base
  tables and is therefore exempt from their RLS, leaking every user's rows with no error. Always add a
  redundant `where user_id = (select auth.uid())` inside as well: it is free (the planner folds it into
  the same index condition) and a later `create or replace view` that drops the flag then fails closed.
  `monthly_category_totals` is the reference. Also: there is no `date_trunc(text, date)` overload, so
  `date_trunc('month', t.date::timestamp)` — a bare `date` picks the `timestamptz` overload, which is
  `STABLE`, not `IMMUTABLE`, and can never be indexed.
- Every monetary amount renders via `src/components/ui/amount.tsx` (mono "ledger voice"); text via `AppText` variants; colors/spacing only from `src/constants/theme.ts`.
- Plaid PFC category → our `category_id` mapping must never overwrite a user's manual category override (seed of the future community feature).
- Reconnecting a stale bank uses **Link update mode**: `plaid-create-link-token` takes an optional
  `item_id`, passes that Item's `access_token`, and OMITS `products` (Plaid rejects both together).
  There is no `/item/public_token/exchange` afterwards — the token does not change. A successful sync
  is what returns the Item to `active`, which is why `plaid-sync-transactions` selects
  `status in ('active','login_required')` rather than just active.
- **`plaid-webhook` is the only public function** (`verify_jwt = false` in `supabase/config.toml`):
  Plaid calls it, not a user. Its auth is Plaid's ES256 JWT, checked by `verifyPlaidWebhook` in
  `_shared/webhook.ts` before anything else runs. Never ship another `verify_jwt = false` function
  without equivalent verification. It replies 200 at once and syncs in `EdgeRuntime.waitUntil`
  (Plaid abandons a delivery after 10s and retries any non-200 for 24h). The sync itself is
  `syncItem` in `_shared/sync.ts`, shared with `plaid-sync-transactions`.
- **Plaid troubleshooting log** (`plaid_events`, server-only). Plaid support asks for a `request_id`,
  Plaid's `item_id` and Link's `link_session_id`, and Free-plan function logs last about a day, so
  they are kept in a table: 90 days (pg_cron `plaid-events-prune`), deleted with the user. Every write
  goes through `recordPlaidEvent` (`_shared/plaid-log.ts`), which never throws: a lost log row must
  never fail a sync, a link or a disconnect. `plaidErrorFields` reads only `response.data` and the
  message, never the request. `item_id` has no foreign key on purpose, so the log outlives a deleted
  bank. The app reports Link exits to `plaid-link-event` (30 per user per hour) and sends
  `link_session_id` with the token exchange. A new Plaid call that can fail should record an event.
- Webhook URLs: new Items get one on `linkTokenCreate`. Items linked before 2026-09-22 have none,
  and Plaid then silently sends nothing — either dev action below registers it.
- `plaid-sandbox` is **dev/test only**, with two actions: `reset_login` forces a real
  `ITEM_LOGIN_REQUIRED` (Plaid then fires an ITEM ERROR webhook), `fire_webhook` makes Plaid send
  `SYNC_UPDATES_AVAILABLE`. Two guards — the function 403s unless `PLAID_ENV=sandbox`, and the
  bank screen's (`app/bank/[id].tsx`) buttons that call it are behind `__DEV__` so they are stripped from release builds.
  Never expose it in production.
- **Monetization cost facts** (plans themselves: Phase 14 above; background in
  `docs/product/monetization.md`). Two facts that change designs: Plaid bills **per connected Item per month, not per pull** (syncing
  is free; `/transactions/refresh`, which we do not use, is the per-request exception), and **only
  `/item/remove` stops that billing** — disconnecting does not. Credits are therefore metered against
  AI usage, never transaction pulls. Any tier limit is enforced in an Edge Function, never the client,
  for the same reason `plaid_tokens` is server-only.
- Sandbox login inside Plaid Link: `user_good` / `pass_good`. Test app user: `ph.leao2099+tuskytest@gmail.com` (email confirmation is ON for new signups; confirm via admin API or dashboard).
  Second test user for herd tests (9c): "Kel Test", `ph.leao2099+tuskyherd@gmail.com`
  (`706f7db5-…`), no banks, alone in its own herd.
- **The auth session lives in the keystore, not AsyncStorage.** `lib/secure-storage.ts` wraps
  `expo-secure-store` for supabase-js: it holds a long-lived refresh token, and AsyncStorage is an
  unencrypted file. Android's keystore rejects values over ~2 KB, so a value is chunked behind a
  manifest; a missing chunk reads as signed out, and keystore errors never throw. Old AsyncStorage
  sessions migrate on first read. Never pass `storage: AsyncStorage` to `createClient` again.
  See `docs/ops/security-review-2026-09-27.md`.
