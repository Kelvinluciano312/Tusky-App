# Tusky — agent notes

Monarch-Money-style personal finance mobile app. Expo (React Native) + Supabase + Plaid Sandbox.
Approved plan/phases: see README Status (Phases 0–6 done; Phase 6's final step, the Plaid key switch, waits
on Pedro's go-ahead — see its spec, `docs/superpowers/specs/2026-09-23-phase-6-connections-control-design.md`).
Now: Phase 7 — categories — `docs/superpowers/specs/2026-09-24-phase-7-categories-design.md`, built as milestones
7a/7b/7c, all built. Latest handoff: `docs/superpowers/plans/2026-09-25-phase-7c-handoff.md`; specs in `docs/superpowers/specs/`.

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
npx supabase secrets set --env-file supabase/functions/.env   # NOT YET: the file holds the pending new Plaid keys (see Phase 6 spec, final step)
npx -y deno test supabase/functions/_shared/    # Edge Function unit tests; Deno need not be installed
```

**Driving the emulator (agents):** use `node scripts/emu.mjs` — `ui` prints visible labels with tap
centers as text, `tap "<label>"` taps by text, `logs` shows JS errors/crashes since the last call.
Prefer `ui` over `shot`; a screenshot costs ~1.5k tokens, only take one when visual layout is the
question. JS edits hot-reload via Metro — never rebuild for them.

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
- **Supabase Free Plan pauses the project after ~7 days of inactivity.** Symptom: every request to
  `*.supabase.co` returns Cloudflare **521 web server is down** while `supabase.com` itself is fine —
  looks like a dead key or bad network, is neither. Fix: dashboard → **Resume project**. Data and config
  survive, restorable for up to 1 year.
- **Android builds need JDK 17, not whatever Android Studio bundles.** Android Studio's `jbr` became
  JDK 25, and on it `configureCMakeDebug` fails for react-native-screens/worklets with only
  `WARNING: A restricted method in java.lang.System has been called`. Point `JAVA_HOME` at a JDK 17 for
  the build (Gradle's own download lives under `~/.gradle/jdks/eclipse_adoptium-17-*`).
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
- New tables: enable RLS, add `(select auth.uid()) = user_id` policies, then grant `authenticated`
  exactly what the app uses — **a new table is unreachable from the app until you do**. Since Phase 6
  (`20260924120100_phase6_revoke_default_grants.sql`) `postgres`'s default privileges in `public` give
  anon and authenticated nothing (service_role still gets everything), and every older table was revoked
  and re-granted to match what the app uses. Before that, the defaults gave anon and authenticated EVERY
  privilege, and a column-scoped `grant update (col)` restricted nothing. Check with
  `has_column_privilege('authenticated', '<table>', '<col>', 'UPDATE')`. A table-level `revoke` also
  drops that table's column grants, so re-issue them afterwards. Functions still get `EXECUTE` from
  PUBLIC by Postgres default: revisit that when adding the first RPC.
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
  keep their ids; 61 children hang off them. `categories_enforce_tree` allows a parent only if it is a
  built-in group, and copies the group's `kind` onto the child. Sync resolves **manual > rule (7c) >
  Plaid detailed (`plaid_detailed_map`) > Plaid primary (`plaid_category_map`, whose entries are
  groups) > uncategorized**: `resolveCategoryId` in `_shared/categorize.ts`, with `pickCategoryId` on
  top. `credit_card_payment` is transfer-kind, so it leaves spending and cash flow, but
  `ignoredCategoryIds` keeps it in recurring detection: a card bill still has a due date. Rollups go
  through `lib/categories.ts` (`groupIdOf`, `rollupByGroup`), and a group and its children are never
  budgeted at once (`budgetsReplacedBy`). `transactions.merchant_key` is a generated column, the SQL
  twin of `normalizeMerchant`. Change both together, or rules and renames (7c) stop matching.
- **Custom categories and overrides** (Phase 7b). The app reads `user_categories`, never `categories`
  directly. That view applies this user's `category_overrides` (name, colour, hidden) to the built-ins and
  adds their own custom rows. Overrides are for built-ins only (a trigger refuses custom rows). A custom
  category is a child of a built-in group. The client may `insert (name, parent_id, icon, color)` and
  `update (name, icon, color)`, and nothing else. `parent_id` is insert-only because
  `categories_enforce_tree` cannot stop a group being made its own parent. Clients cannot delete: the
  `delete-category` function moves the category's transactions (manual flags kept), streams and budget
  first. Sync loads only built-in categories into its shared context, and adds the Item owner's custom
  transfer categories per Item before recurring detection.
- **Merchant rules** (Phase 7c). `merchant_rules` (one per user and `merchant_key`) holds a category, a
  display name, or both. Clients only read it; every write goes through `set-merchant-rule`, which
  re-resolves the merchant's non-manual rows with `resolveCategoryId` whenever the category part
  changes, so removing a rule puts Plaid's category back. Sync loads the owner's rules per Item and passes
  `rule:` to the same resolver. Renames apply only when data is read (`lib/merchants.ts`). Rows read the
  rules themselves (`useMerchantRules`), so every surface shows the same name. `delete-category` moves
  rules to the group before its delete: the rules FK has no cascade, on purpose.
- **Bottom sheets need `KeyboardAvoidingView behavior="padding"` on Android too.** A `Modal` is its own
  window: the activity's resize for the keyboard never reaches it, and a text field there has the whole
  sheet covered by the keyboard (`budget-sheet.tsx` and `category-sheet.tsx` are the reference).
- **App pure logic is tested with `npm test`** (`node --test src/lib/*.test.ts`; Node strips the types).
  A module under test may import other modules only as `import type`, or at runtime by relative
  `./x.ts` path (`allowImportingTsExtensions` is on). A `@/` alias or a React Native import breaks
  the run. TS 6 no longer auto-includes `@types`, so each test file starts with
  `/// <reference types="node" />`.
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
- Webhook URLs: new Items get one on `linkTokenCreate`. Items linked before 2026-09-22 have none,
  and Plaid then silently sends nothing — either dev action below registers it.
- `plaid-sandbox` is **dev/test only**, with two actions: `reset_login` forces a real
  `ITEM_LOGIN_REQUIRED` (Plaid then fires an ITEM ERROR webhook), `fire_webhook` makes Plaid send
  `SYNC_UPDATES_AVAILABLE`. Two guards — the function 403s unless `PLAID_ENV=sandbox`, and the
  bank screen's (`app/bank/[id].tsx`) buttons that call it are behind `__DEV__` so they are stripped from release builds.
  Never expose it in production.
- **Monetization is planned but unbuilt** — free tier plus two subscriptions (Tusklet, Tusk) via
  Stripe; see `docs/product/monetization.md` before designing anything that touches limits or cost.
  Two facts that change designs: Plaid bills **per connected Item per month, not per pull** (syncing
  is free; `/transactions/refresh`, which we do not use, is the per-request exception), and **only
  `/item/remove` stops that billing** — disconnecting does not. Credits are therefore metered against
  AI usage, never transaction pulls. Any tier limit is enforced in an Edge Function, never the client,
  for the same reason `plaid_tokens` is server-only.
- Sandbox login inside Plaid Link: `user_good` / `pass_good`. Test app user: `ph.leao2099+tuskytest@gmail.com` (email confirmation is ON for new signups; confirm via admin API or dashboard).
