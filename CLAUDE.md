# Tusky — agent notes

Monarch-Money-style personal finance mobile app. Expo (React Native) + Supabase + Plaid Sandbox.
Approved plan/phases: see README Status (Phases 0–6 done; Phase 6's final step, the Plaid key switch, waits
on Pedro's go-ahead — see its spec, `docs/superpowers/specs/2026-09-23-phase-6-connections-control-design.md`).
Phases 7 (categories) and 8 (transaction review) are merged. Now: Phase 9 — names, herds (shared
households), who paid, production project — `docs/superpowers/specs/2026-09-25-phase-9-herds-design.md`,
milestones 9a → 9d plus Track P. Latest handoff: `docs/superpowers/plans/2026-09-28-phase-9d-handoff.md`.

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
npx supabase secrets set --env-file supabase/functions/.env   # NOT YET: the file holds the pending new Plaid keys (see Phase 6 spec, final step)
npx -y deno test supabase/functions/_shared/    # Edge Function unit tests; Deno need not be installed
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
- The phone then opens `http://100.108.96.124:8081`. When wireless adb is up, `adb shell am start -a android.intent.action.VIEW -d "exp+tusky://expo-development-client/?url=http%3A%2F%2F100.108.96.124%3A8081" com.tusky.app` opens it for him.
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
  re-resolves the merchant's non-manual rows with `resolveCategoryId` whenever the category part
  changes, so removing a rule puts Plaid's category back. Sync loads the Item's herd's rules and passes
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
- **Transaction review** (Phase 8). `reviewed_at` null means "in the queue" (posted rows only), and
  `notes` holds the memo. Both are user-owned: sync's upsert must never include them. A bulk upsert sends
  the union of the rows' keys, so a key on only some rows nulls it on the rest. `carryForward`
  (`_shared/review.ts`) moves a pending row's memo and manual category onto the posted row that replaces
  it. The `/review` queue is a per-visit id snapshot kept outside `['transactions']` on purpose.
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
  Second test user for herd tests (9c): "Kel Test", `ph.leao2099+tuskyherd@gmail.com`
  (`706f7db5-…`), no banks, alone in its own herd.
