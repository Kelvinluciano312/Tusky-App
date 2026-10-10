# Phase 17 (iOS launch) — handoff

Plan: `2026-10-10-phase-17-ios.md`. Branch: `kelvin`. This file grows milestone by milestone: answers to
the plan's "record this" steps, findings that changed the plan, and the commands only a person can run.

## Findings that changed or corrected the plan

- **iOS prebuild does not run on Windows.** `npx expo prebuild --platform ios` prints "Skipping generating the
  iOS native project files" and fails. The plan's Task 1.4 gate was therefore done two ways:
  `npx expo config --type introspect --json` (evaluates every config plugin, writes nothing), and a real
  Android prebuild. **Still to do on Kelvin's Mac, once:** `cd apps/mobile && npx expo prebuild --platform ios --no-install --clean`,
  then check `ios/Tusky/Info.plist`, `ios/Tusky/Tusky.entitlements` and `ios/Tusky/PrivacyInfo.xcprivacy`
  against the list in plan Task 1.4, and delete `ios/`.
- **Introspected iOS result (all as planned):** portrait-only iPhone orientations, four iPad orientations,
  `UIRequiresFullScreen=false`, `ITSAppUsesNonExemptEncryption=false`, `NSFaceIDUsageDescription` present,
  calendar and reminders strings present, entitlements `com.apple.developer.applesignin` and
  `com.apple.developer.associated-domains = applinks:studiosouroboros.com`.
- **ATS pinned.** Expo's introspection default has `NSAllowsArbitraryLoads=true`. `app.json` now sets
  `NSAppTransportSecurity` explicitly (`NSAllowsArbitraryLoads=false`, `NSAllowsLocalNetworking=true`, a
  `localhost` exception), so a release build can never ship arbitrary loads. ATS does not apply to raw IP
  addresses, so the dev client still reaches Metro on the Tailscale address.
- **`expo-calendar`'s config plugin is applied automatically** (it is on `@expo/prebuild-config`'s
  `legacyExpoPlugins` list, applied whenever the package is installed), so the CLAUDE.md note "the plugin is
  left out of app.json on purpose" did not actually keep `READ_CALENDAR`/`WRITE_CALENDAR` out of the Android
  manifest. Fixed with `android.blockedPermissions` in `app.json`. Verified with a real Android prebuild:
  both permissions appear as `tools:node="remove"`, and the only permissions added by Phase 17 are
  `USE_BIOMETRIC` and `USE_FINGERPRINT`. CLAUDE.md is updated in Task 8.6.
  `expo-local-authentication` is on the same auto list; its plugin is also listed explicitly in `plugins`
  so the Face ID string can be passed.

## Task 1.1 — API checks (expo 57.0.x modules, read from the installed `.d.ts`)

| Module (version) | Confirmed |
| --- | --- |
| `expo-apple-authentication` 57.0.2 | `signInAsync`, `isAvailableAsync`, `getCredentialStateAsync`, `AppleAuthenticationButton` (+ config plugin) |
| `expo-crypto` 57.0.3 | `randomUUID`, `digestStringAsync`, `CryptoDigestAlgorithm` (no plugin) |
| `expo-local-authentication` 57.0.3 | `authenticateAsync`, `hasHardwareAsync`, `isEnrolledAsync`, `supportedAuthenticationTypesAsync` (+ config plugin) |
| `expo-screen-capture` 57.0.4 | `preventScreenCaptureAsync(key)`, `allowScreenCaptureAsync(key)`, **`enableAppSwitcherProtectionAsync(blurIntensity)` exists (iOS only, blur overlay)** and `disableAppSwitcherProtectionAsync`. No config plugin. |

Consequence: Task 6.3 uses `enableAppSwitcherProtectionAsync` on iOS; no hand-rolled cover is needed.
On Android, `preventScreenCaptureAsync` (FLAG_SECURE) is what blanks the recents card.

## To do by a person (collected as the milestones land)

- `apps/mobile/eas.json` `submit.production.ios`: add `{ "ascAppId": "<ASC App ID, P9>", "appleTeamId": "<Team ID, P1>" }`
  once Kelvin supplies both (neither is a secret). Left out on purpose rather than committing placeholders.
- Run the iOS prebuild gate on the Mac (see above).
- First EAS iOS dev build (plan Task 1.5): `cd apps/mobile && npx eas-cli build --platform ios --profile development`
  (interactive the first time), install on the iPhone and iPad. Rebuild the Android dev client too, since
  native modules were added: `npx expo run:android --device Pixel_7`.

## M2 — iOS parity (done, committed)

- Review screen: `gestureEnabled: false` (iOS edge swipe-back would fight the deck; Back stays the header button, as on Android).
- Paywall: iOS-only header `Close` (`components/paywall-close.tsx`, wired in `_layout.tsx` via `headerRight`).
- Keyboard: only `join-herd.tsx` needed `automaticallyAdjustKeyboardInsets`. Every other text field is already in a
  `Sheet`/`KeyboardAvoidingView` screen (auth, onboarding, verify) or at the top of a list (transactions search).
- RevenueCat per platform: `pickRevenueCatKey`, `canManage`, `manageFallbackUrl`; `useBuy` never sends Play's
  replacement params on iOS; the Plan screen's store name follows the platform.
- **To do by a person:** put the App Store key in `apps/mobile/.env` as `EXPO_PUBLIC_REVENUECAT_IOS_KEY=` (the dev Test
  Store `test_…` key works there too) and restart Metro. At launch, `EXPO_PUBLIC_PROD_REVENUECAT_IOS_KEY` goes in the EAS
  `production` environment. See plan Task 8.1.
- **Device checks (iPhone):** the review deck swipes both ways and an edge swipe does not navigate; the paywall's Close
  works; the invite-code field stays above the keyboard. On the Android emulator the same screens are unchanged.

## M3 — Plaid OAuth banks on iOS (code done; dev deployed)

What changed: `_shared/link-platform.ts` (+ Deno tests) picks `redirect_uri` on iOS and `android_package_name` otherwise;
`plaid-create-link-token` reads `platform` from the body (old clients send none and stay Android) and the secret
`PLAID_IOS_REDIRECT_URI`; `lib/plaid.ts` sends `platform: Platform.OS`; `app/+native-intent.tsx` makes the router ignore
Plaid's OAuth return link (`lib/deep-links.ts`), so Plaid's SDK resumes Link on its own.

Dev is already set up: secret `PLAID_IOS_REDIRECT_URI=https://studiosouroboros.com/tusky/plaid/oauth` set, and
`plaid-create-link-token` deployed to `ifibrsgqdibcomzxencf`.

### For Pedro (P6): files on studiosouroboros.com

1. `public/.well-known/apple-app-site-association` (no extension; served as `application/json`; no redirect). Replace
   `<TEAM_ID>` with the Apple Team ID (P1):

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["<TEAM_ID>.com.ouroborosstudios.tusky"],
        "components": [{ "/": "/tusky/plaid/*", "comment": "Plaid OAuth return" }]
      }
    ]
  }
}
```

2. `public/tusky/plaid/oauth/index.html`, a minimal page (what a browser sees if the link does not open the app):

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tusky</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem"><p>Returning you to Tusky&hellip;</p></body></html>
```

3. Check Apple's CDN has the file (can take a while after the first deploy):
   `https://app-site-association.cdn-apple.com/a/v1/studiosouroboros.com`

### For Kelvin (P7): Plaid dashboard

API → Allowed redirect URIs: add `https://studiosouroboros.com/tusky/plaid/oauth` in **Sandbox and Production**.
Until it is registered, an OAuth bank (Chase in Sandbox) fails at the bank step; banks without OAuth still link.

### Production commands (Pedro, each only on his go-ahead; the CLI stays linked to dev)

```sh
npx supabase secrets set PLAID_IOS_REDIRECT_URI=https://studiosouroboros.com/tusky/plaid/oauth --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy plaid-create-link-token --use-api --project-ref awiwcgrisyzimzxgddxu
```

### Device checks (iPhone, then iPad; needs the AASA live, the redirect URI registered, and an iOS dev build)

1. Link "First Platypus Bank" (`user_good` / `pass_good`): it links.
2. Link **Chase** (OAuth): the bank page opens, returns into Link, and the bank appears.
3. Android emulator: First Platypus still links (the request body now carries `platform: 'android'`).

## M4 — Sign in with Apple (code done; `two-factor` deployed to dev)

What changed:

- `lib/apple.ts` (pure, tested): name from Apple's first authorization, Hide My Email detection, onboarding name
  suggestion, identity helpers, which proof account deletion needs, cancel detection.
- `lib/apple-auth.ts`: `signInWithApple()` sends Apple the SHA-256 (hex) of a random nonce and Supabase the raw nonce, then
  `signInWithIdToken({ provider: 'apple' })`. `saveAppleName` keeps the name Apple shared, but only before onboarding, so an
  existing account that links Apple later keeps its own name. `confirmWithApple()` is for account deletion (M5).
  `useAppleCredentialWatch()` (called in `RootNavigator`) signs out when `getCredentialStateAsync` reports `REVOKED`, on
  launch and on every return to the foreground. `NOT_FOUND` and errors are ignored.
- `components/apple-sign-in.tsx`: the button, under the primary button on sign-in and sign-up. It renders nothing on Android.
- Onboarding prefills the name from the profile unless it is only a relay address's local part; Account shows
  "Signed in with Apple" and labels the password row "Set a password" for an Apple-only account.
- Two-step (`_shared/two-factor.ts`): `hasFirstFactor` accepts `password` or `oauth` (provider Apple, or none named) as the
  first factor; otp, magiclink, recovery and invite sessions still cannot be marked. The error code
  `password_session_required` is unchanged so old clients keep working.
- `supabase/config.toml` `[auth.external.apple]`: enabled, client id `com.ouroborosstudios.tusky` (local copy only).

### For Kelvin (P8): dashboards

Supabase → Authentication → Providers → Apple: enable it, **Client IDs** = `com.ouroborosstudios.tusky`; no secret is
needed for native sign-in. Do it on dev now and on production with Pedro. Also confirm **Email → Confirm email = ON** on both
projects: it is what stops someone pre-registering a victim's email to hijack the Apple link.

### For Kelvin (P4): Apple private email relay

Apple Developer → Services → *Sign in with Apple for Email Communication*: register `studiosouroboros.com` and the sender
`noreply@studiosouroboros.com`. Without it, confirmation and two-step emails to `@privaterelay.appleid.com` bounce, so a
Hide My Email person could never receive a two-step code.

### Still unknown until a real iPhone signs in (record the answers here, then in CLAUDE.md)

1. **The real `amr`** of an Apple session. Expected `[{ method: 'oauth', provider: 'apple', … }]`. Add a temporary
   `if (__DEV__) console.log(JSON.parse(atob(session.access_token.split('.')[1])).amr)` after sign-in, read it from Metro, and
   remove it. If the method has another name, change `FIRST_FACTOR_METHODS` in `_shared/two-factor.ts` (and its test), then
   redeploy `two-factor`. Observed value: _not yet observed_.
2. Whether `supabase.auth.updateUser({ password })` for an Apple-only person creates an `email` identity. If it does not,
   "Set a password" only adds a password to the same user and the row label should not promise email sign-in.
3. That `getUserIdentities()` returns the Apple identity with `identity_data.sub` (the watch and account deletion depend on it).
4. Whether `getCredentialStateAsync` works on the device. It throws on the simulator, which the watch deliberately ignores.

### Device checks (iPhone, dev Sandbox; needs an iOS dev build, P2, and the Apple provider enabled on dev)

1. A new Apple sign-up, once sharing the name and once with **Hide My Email**. Check the rows on dev: profile, herd, trial
   subscription, crowd consent, no terms consent. The app shows accept-terms, then onboarding with the name prefilled (empty
   for a relay address with no name), then Home.
2. Sign out, then sign in with Apple again: the same account.
3. An existing email account signs in with Apple using the **same** email: it links to that account (same data).
4. Two-step on as an Apple-only person: a code arrives at the relay address (needs P4) and verifies.
5. iOS Settings → Apple Account → Sign in with Apple → Tusky → Stop using: back in the app, it signs out.
6. Account screen: "Signed in with Apple" shows, and the password row reads "Set a password".
7. Android: the sign-in and sign-up screens are unchanged (no Apple button).

## M5 — Account deletion for Apple users, revocation, Apple notifications (code done; deployed to dev)

What changed:

- `_shared/apple.ts` (pure but for the two fetches; 12 tests): verifies Apple's identity token (RS256 against Apple's keys,
  issuer, audience `com.ouroborosstudios.tusky`, at most 10 minutes old, and `sub` equal to the caller's own Apple identity),
  builds the ES256 client secret, trades an authorization code for a refresh token, revokes it, and verifies the signed
  server-to-server notification. Nothing in it logs a token, a code or the key.
- `delete-account` takes `{ password }` or `{ apple: { identity_token, authorization_code } }` (`parseProof`). The Apple user to
  match is read from the caller's own identity on the server, never from the request. The code is traded for a refresh token
  **before** the slow Plaid pass (it is single-use and lives 5 minutes), and the token is revoked after the user is gone
  (Guideline 5.1.1(v)). A refused or unreachable Apple never fails a deletion. A wrong Apple proof is a 403
  `apple_unverified` with nothing touched. **Accepted limit:** a password proof (for example from Android) cannot revoke Apple's
  grant, because only an Apple sign-in yields the code.
- App: an Apple-only account on iOS (`deleteProofKind`) sees no password field in the delete sheet. It types `DELETE`, then Apple
  asks (`confirmWithApple`), and the tokens go to the function. Password accounts and Android are unchanged.
- `apple-notifications` (new, public, `verify_jwt = false` in `config.toml`): POST only; the body's `payload` must be a JWS
  signed by Apple or the answer is 401 before anything else runs. `consent-revoked` and `account-delete` end that user's
  sessions (`user_for_apple_sub` then `end_user_sessions`, migration `20261018130000_apple_identity.sql`, service_role only).
  `email-enabled`/`email-disabled` are logged by type. It never deletes data: an orphaned account's banks are archived by
  `plan-enforcer` when its trial ends, which stops Plaid billing. The Apple user id is never logged.
- **Task 5.4 path that held:** `postgres` may `DELETE` from `auth.sessions` (rehearsed in a rolled-back block on dev), so
  `end_user_sessions` stayed in. Verified on dev: garbage bodies answer 401, GET answers 405, `anon` and `authenticated` cannot
  execute either function, and `node scripts/rls-check.mjs` passes.

### For Kelvin (Task 5.5): dev secrets

Without them the function still deletes accounts but cannot revoke Apple's grant (it logs `apple: not configured`). From the
repo root, with the `.p8` from P3 (never commit it or paste it into chat):

```powershell
npx supabase secrets set APPLE_TEAM_ID=<Team ID> APPLE_KEY_ID=<Key ID>
npx supabase secrets set "APPLE_PRIVATE_KEY=$(Get-Content C:\path\to\AuthKey_XXXX.p8 -Raw)"
```

### Production commands (Pedro, each only on his go-ahead; the CLI stays linked to dev)

```sh
npx supabase db push --project-ref awiwcgrisyzimzxgddxu   # migration 20261018130000_apple_identity.sql
npx supabase secrets set APPLE_TEAM_ID=<Team ID> APPLE_KEY_ID=<Key ID> --project-ref awiwcgrisyzimzxgddxu
npx supabase secrets set "APPLE_PRIVATE_KEY=<contents of AuthKey_XXXX.p8>" --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy apple-notifications --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy delete-account --use-api --project-ref awiwcgrisyzimzxgddxu
```

Then Apple Developer → Identifiers → `com.ouroborosstudios.tusky` → Sign in with Apple → Configure → **Server-to-Server
Notification Endpoint** = `https://awiwcgrisyzimzxgddxu.supabase.co/functions/v1/apple-notifications`.

### Device checks (iPhone, dev Sandbox; needs the dev secrets above)

1. Delete an **Apple-only** test account: Apple's prompt appears after typing `DELETE`, then the account, herd and banks are
   gone and the function log shows no error. iOS Settings → Apple Account → Sign in with Apple: Tusky is no longer listed.
2. Cancel Apple's prompt: nothing is deleted and the sheet stays open.
3. Delete a **password** account on iPhone and on Android: unchanged (password field, no Apple prompt).
4. If you can send a test notification from Apple, check the dev log shows only the event type.

## M6 — Security hardening, iOS and Android (code done; app only, nothing to deploy)

What changed:

- **Session keychain accessibility (6.1).** `createSecureStorage(secure, legacy?, options?)` passes `options` on every read, write
  and delete, chunks included (tested). `supabase.ts` passes `{ keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY }`: on iOS the
  session never leaves the phone in a backup or a device transfer, and is unreadable while the phone is locked. Android ignores
  the option. Existing sessions upgrade the next time the token refreshes, because each write rewrites every chunk.
- **App lock (6.2).** Opt-in, per device, never synced: `tusky.appLock` in the keystore (`lib/app-lock-store.ts`, read
  synchronously so the first frame is already locked). `AppLockProvider` (`components/app-lock.tsx`) wraps `RootNavigator`. With the
  preference on and a signed-in user it locks at cold start and after 60 s away (`shouldLockOnResume`, pure and tested; a clock that
  moved backwards locks too). The lock is a full-screen `Modal`, so it covers sheets, dialogs and Plaid Link. The system prompt
  (`authenticateAsync`, with the phone's passcode as fallback) opens by itself once per lock; the button asks again; **Sign out**
  is the escape. Someone who has just signed in is not locked, and nobody is locked out of a signed-out app. The switch is in the
  Account screen's Sign-in card, under two-step. Turning it on or off needs one successful prompt, and turning it on needs a
  phone with a passcode or biometrics.
- **Privacy shield (6.3).** `lib/privacy-shield.ts`. iOS always blurs Tusky in the app switcher
  (`enableAppSwitcherProtectionAsync(1)`). Android, while App lock is on, blanks the Recents card and blocks screenshots and screen
  recording (`preventScreenCaptureAsync('app-lock')`, FLAG_SECURE). With the lock off, Android is exactly as before.
- **Dependency audit (6.4).** See "iOS launch" in `docs/ops/security-review-2026-09-27.md`. Only build-tooling packages moved
  (16 lockfile entries, `package.json` untouched); everything else needs a breaking `--force` and is not shipped in the bundle.

Notes for whoever runs the first iOS build:

- **The iOS Keychain outlives an uninstall.** Delete Tusky and reinstall it, and the session, and the App lock preference, are
  still there. That is a feature for the lock (it cannot be reset by reinstalling), but a person who expects "reinstall = signed
  out" will be surprised. If it matters, the fix is a first-run marker in `AsyncStorage` (which is wiped with the app): when it is
  missing, clear the Tusky keystore entries once. Not built; decide after seeing it on a device.
- **`npx expo install --check` is not clean, and was not before this phase.** Seven patch-level mismatches exist in packages this
  phase did not touch. Run `npx expo install --fix`, then retest, before the first iOS build.
- **Rebuild the Android dev client** (`npx expo run:android --device Pixel_7`): `expo-local-authentication`,
  `expo-screen-capture`, `expo-apple-authentication` and `expo-crypto` are native. The app will not start on an old dev client.

### Device checks (iPhone, iPad and Android; needs the rebuilt dev clients)

1. Account → Lock with Face ID (or fingerprint / passcode): the switch asks once, then turns on. On a phone with no passcode and
   no biometrics, it refuses with "Set up Face ID, a fingerprint or a passcode on this device first."
2. Lock on → background Tusky for more than a minute → opening it shows "Tusky is locked" with the prompt already open.
3. Face ID unlocks. Cancel the prompt: the lock stays, no error text; **Unlock** asks again. On iOS, failing Face ID offers the
   passcode, and the passcode unlocks.
4. **Sign out** from the lock screen: confirm, and you land on the sign-in screen with nothing of the last account in the cache.
5. Background for less than a minute → no lock. Kill the app and open it → locked.
6. iOS app switcher: Tusky's card is blurred, with no balances readable (App lock on or off).
7. Android Recents: a blank card while the lock is on, and screenshots are blocked. With the lock off, both work as before.
8. Lock off → no change at all, on either platform.
9. iPad landscape and Split View: the lock screen is centred and readable.
10. Open Plaid Link, go to a bank's OAuth page for longer than a minute, and return: the lock covers Link, and unlocking returns
    to it. If Link is hidden behind the lock and cannot be reached afterwards, record it here as a bug.

## M7 — Demo account for App Review (code done; dev deployed and rehearsed)

Full procedure, caveats and the review-notes text: **`docs/ops/app-review.md`**. This section is what changed and what a person must run.

- **Migration `20261018140000_demo_items.sql`** (the plan said `…120000`; the timestamp was moved so it sorts after the Apple
  identity migration already pushed). Adds `plaid_items.is_demo boolean not null default false`. `authenticated` has no `UPDATE` or
  `INSERT` grant on the column (checked with `has_column_privilege`), so no user can flag a bank as a demo.
- **Skipped where Plaid would be called:** `plaid-sync-transactions`, `plaid-webhook` and both queries in `_shared/enforce.ts` now
  filter `is_demo = false`. `claimItem` is deliberately untouched: disconnect must still claim a demo Item. Disconnect and account
  deletion need no change, because `disconnectItem` skips Plaid when an Item has no `plaid_tokens` row, which a demo Item never has.
- **`scripts/demo-seed.mjs <user-id> [--print]`.** One `do` block (all or nothing), idempotent (wipes the user's demo bank and the
  herd's budgets, then rebuilds), dev-only unless `--print`. It refuses a user whose herd has other members or who has a real
  bank. It reads `TERMS_VERSION` from `constants/legal.ts`, and writes no `plaid_tokens` row, ever (the summary fails the run if
  one exists).
- **Deviation from the plan: the demo plan is a 90-day `trial`, not a comped `tusk`.** `revenuecat.ts` never overwrites a `comp`
  row (`current.store === 'comp'` returns null), so a reviewer who bought a plan would see nothing change, and Apple checks that
  purchases work. A trial row is replaced by a real entitlement; 90 days outlasts a review, and re-seeding renews it.
- **Rehearsed on dev** with a throwaway user (`appreview-dev@example.com`, created by SQL, never on production):
  - the summary read 3 accounts, 186 transactions (2 pending, 8 in the review queue), 4 streams, 4 budgets, `demo_tokens: 0`;
  - read as that user (role `authenticated` and its claims), RLS showed exactly those rows, and `plaid_tokens` was denied;
  - monthly income about 3,300 against 2,900 to 3,100 of spending; snapshot floors held (checking 1,800, card owed at least 150);
  - Netflix shows a price rise (13.99 to 15.49) on the recurring screen;
  - `plaid-sync-transactions` as that user answered `{"results":[]}`;
  - "Keep history" archived the bank and "Delete everything" removed it, both with `{"ok":true}` and no Plaid call;
  - re-seeding after each of those rebuilt the bank, and bad input (unknown user, a herd with others) failed cleanly.
  - Not done: signing in with the app on an emulator (none was running). Do it once on the dev build; the checklist is in
    `app-review.md`.

### Production commands (Pedro, each only on his go-ahead; the CLI stays linked to dev)

```sh
npx supabase db push --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy plaid-sync-transactions --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy plaid-webhook --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy plan-enforcer --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy revenuecat-webhook --use-api --project-ref awiwcgrisyzimzxgddxu
```

Then in the production dashboard: Authentication -> Users -> Add user `appreview@studiosouroboros.com` (Auto Confirm User, a long
random password kept in the team password manager), copy its id, and run the output of
`node scripts/demo-seed.mjs <user-id> --print` in the SQL editor. Last, sign in once on a production build and walk the checks in
`docs/ops/app-review.md`. Two-step stays off for this account.

Order matters: the migration comes first, because the four functions (`plan-enforcer` and `revenuecat-webhook` through `enforce.ts`) filter on `is_demo` and fail without the column. Re-seed in the
days before each submission (the data is dated to the day it was seeded), and after any review that deleted the account.

## M8 — Docs and submission prep (docs done; the submission itself is a person's)

### What the docs now say

- **`CLAUDE.md`**: the Phase 17 sentence in the header; an iPhone/iPad dev section beside "Pedro's phone"; the gotchas (iOS prebuild
  on Windows, Plaid iOS OAuth and `platform`, the Keychain outliving an uninstall, `expo-calendar`'s auto-applied plugin); and the
  conventions (Sign in with Apple and the nonce, the two first-factor kinds, deletion proofs and revocation, `apple-notifications`,
  App lock and the privacy shield, demo Items, public functions).
- **`docs/ops/release.md`**: profiles including the iOS ones, the `appl_` key, "iOS builds (Phase 17)", TestFlight and submit.
- **`docs/ops/production.md`**: the Apple secrets, the Apple provider and S2S settings, the relay sender, the demo account, and what is
  on dev only.
- **`docs/ops/app-review.md`**: the demo account procedure and the review-notes text. **`docs/ops/security-review-2026-09-27.md`**:
  the "iOS launch" section.
- **`README.md`**: Phase 17 in the status list.

### Answers the plan asked to record

- **Task 1.1 API checks:** see "Task 1.1" above (every API exists in the installed 57.0.x packages; `enableAppSwitcherProtectionAsync`
  does exist, so no hand-rolled cover).
- **Observed `amr` of an Apple session:** _not yet observed_. It needs a real iPhone signing in; see "Still unknown until a real iPhone
  signs in" under M4. `FIRST_FACTOR_METHODS` accepts `password` and `oauth` (provider Apple, or none named) until it is.
- **Which Task 5.4 path held:** `end_user_sessions` stayed in (`postgres` may delete from `auth.sessions`; rehearsed in a rolled-back
  block). The app-side `useAppleCredentialWatch` remains as the second mechanism.

### App Store Connect metadata (drafts; Kelvin edits and pastes)

| Field | Value |
| --- | --- |
| Name / SKU / bundle id | Tusky / `tusky` / `com.ouroborosstudios.tusky` |
| Subtitle (30 chars max) | Money, shared and clear |
| Category | Finance (primary). No secondary needed. |
| Privacy Policy URL | `https://studiosouroboros.com/tusky/privacy` (the app's `PRIVACY_URL`; the same page must be reachable without signing in) |
| Support URL | `https://studiosouroboros.com/tusky/support.html` (P6; the page needs a real contact e-mail) |
| Marketing URL | optional; leave empty |
| Age rating | Answer **No** to every content question (no objectionable content, no unrestricted web access, no user-to-user public content: herds are private). Apple computes the final rating; expect 4+. |
| Export compliance | Already answered by `ITSAppUsesNonExemptEncryption=false` in `app.json` (HTTPS only). Nothing to answer in the portal. |
| Price | Free, with in-app subscriptions (below). |
| Review contact / notes | Kelvin's phone and e-mail; the notes text is at the end of `docs/ops/app-review.md`. |

**Description (draft).** Guideline 3.1.2 needs the Terms link in the description and the subscription facts shown plainly.

```text
Tusky brings your accounts together so you can see where your money is and where it goes.

• Connect your banks securely with Plaid. Your bank login never touches Tusky.
• See your net worth and how it changes over time.
• Every transaction is sorted into categories, and Tusky learns from the fixes you make.
• Set budgets by category, or start from a preset based on your own spending.
• Spot recurring bills, subscriptions and paychecks, and get an upcoming-bills view.
• Review new transactions as a swipeable deck: accept, skip or fix each one.
• Share money with the people you live with: invite them to a herd, mark who paid, split a cost, and settle up.
• Optional: an AI pass for transactions nothing else could place, and anonymous crowd labels. Both are off until you turn them on.
• Lock Tusky with Face ID or your passcode, and hide balances in the app switcher.
• Sign in with Apple, or with an e-mail and password. You can delete your account and all its data inside the app.

Tusky is free to start, with a free trial. Tusklet and Tusk are auto-renewing subscriptions that unlock more of the app:

• <PRICE LINES: copy each plan's title, length and price from App Store Connect, monthly and yearly>

Payment is charged to your Apple Account at confirmation of purchase. A subscription renews automatically unless it is canceled at
least 24 hours before the end of the current period. You can manage or cancel it any time in your Apple Account settings.

Privacy Policy: https://studiosouroboros.com/tusky/privacy
Terms of Use: https://studiosouroboros.com/tusky/terms
```

Prices come from `docs/product/monetization.md` only as sandbox figures (Tusklet $3.99 a month or $45 a year, Tusk $6.99 a month or $75 a
year). The Tusk Herd prices are not recorded anywhere in the repo: read all six from App Store Connect, never from this file.

**Keywords (100 chars max, draft):** `budget,net worth,spending,bills,finance,money,household,shared,expenses,tracker`

**App Privacy.** Every row: linked to the user, not used for tracking, purpose App Functionality. This matches
`NSPrivacyCollectedDataTypes` in `app.json`. Tracking: **No**. No analytics, no crash reporting, no advertising.

| Data type | Why we hold it |
| --- | --- |
| Email Address | The account, and the codes and confirmations sent through Resend |
| Name | The display name |
| User ID | The Supabase user id, and RevenueCat's app user id |
| Other Financial Info | Balances and transactions from Plaid. Merchant text goes to TypeSafe only when the person turns the AI switch on. |
| Purchase History | Subscriptions, through RevenueCat |
| Other User Content | Notes, rules and custom categories |

### Subscriptions in App Store Connect and RevenueCat

Steps are plan 14d-2 Task 10 Steps 1–2 and 5 (`docs/superpowers/plans/2026-09-29-phase-14d-launch-readiness.md`), summarised in
`docs/ops/release.md` ("iOS subscriptions"). The six products go in **one subscription group**, each attached to its package on the
`default` offering of RevenueCat's App Store app. The `appl_` public key goes in `apps/mobile/.env` for dev
(`EXPO_PUBLIC_REVENUECAT_IOS_KEY`) and in the EAS `production` environment as `EXPO_PUBLIC_PROD_REVENUECAT_IOS_KEY`.
Apple wants each subscription to have its own review screenshot of the paywall; take it from the demo account.

### Screenshots (demo account only, never a real person's data)

| Screen | iPhone 6.9" (1320×2868) | iPad 13" (2064×2752, portrait; landscape optional) |
| --- | --- | --- |
| Home (net worth, accounts, upcoming) | yes | yes |
| Transactions | yes | yes |
| Review deck | yes | yes |
| Budgets | yes | yes |
| Reports | yes | yes |
| Paywall | yes | yes |

Take them on a Mac with `npx eas-cli build --platform ios --profile development-simulator` (the iPhone 16 Pro Max and iPad Pro 13"
simulators), signed in as the seeded demo user (re-seed the same day so the dates look current), or on the devices themselves.

### Release build, TestFlight, submit

Exact commands: `docs/ops/release.md` -> "Store build and TestFlight". In short: check `env:list --environment production`, build with
`--profile production`, submit, wait for processing, then walk the matrix below on that build.
Do not skip the `__DEV__` re-check on the production build: sign-in must not offer "Switch to Real data", and the bank screen must
show no sandbox buttons.

### Verification matrix

"Checked" means checked here, in code, tests or on the dev project. "Device" means it can only be proven on hardware and has **not**
been done. Nothing in the Device column was run, and none of those cells is a pass.

Automated, run on 2026-10-10 at the end of M8: `npm run typecheck`, `npx expo lint`, `npm test` (app), and
`npx -y deno test --allow-env supabase/functions/_shared/` (352 passed, 0 failed) all exit 0. `node scripts/rls-check.mjs` passed
after both migrations were pushed to dev.

| Area | What is checked | iPhone | iPad | Android |
| --- | --- | --- | --- | --- |
| E-mail sign-up, confirm mail, sign-in | No code path changed | Device | Device | Unchanged (no edits to the flow) |
| Sign in with Apple (new, returning, linked e-mail, Hide My Email) | Helpers and nonce flow in unit tests; Apple provider settings written down | Device (needs P2, P8, dev build) | Device | Button renders nothing |
| Accept terms, onboarding name prefill, Home | `nameSuggestion` tested | Device | Device | Unchanged |
| Two-step, password user and Apple user | `hasFirstFactor` tested; `two-factor` deployed to dev; real `amr` unobserved | Device | Device | Unchanged |
| Link a bank: First Platypus and Chase OAuth | `linkPlatformFields` tested; function and secret on dev; +native-intent wired | Device (needs AASA live, P7) | Device | Device (First Platypus) |
| Sync, feed, review deck, budgets, reports, settle, herd invite | Review `gestureEnabled:false`; no data-path change | Device | Device | Unchanged |
| Paywall: prices, Close, buy, restore, Manage | `pickRevenueCatKey`, `canManage`, `manageFallbackUrl` tested; iOS never sends Play `productChange` | Device (needs the six products and key) | Device | Unchanged |
| Delete account: password user; Apple user (revocation logged) | `parseProof` and `deleteAccount` tested for both proofs, a null grant and a throwing revoke; function on dev | Device (needs the dev Apple secrets) | Device | Password path unchanged |
| App lock: biometric, passcode fallback, 60 s, sign-out escape | `shouldLockOnResume` and the keychain options tested | Device | Device (landscape, Split View) | Device (biometric + FLAG_SECURE) |
| App switcher hides balances | `enableAppSwitcherProtectionAsync(1)` called once on iOS | Device | Device | Device (Recents blank while locked) |
| Keyboard never covers a field | Only `join-herd.tsx` needed the iOS prop; the rest already sit in sheets | Device | Device | Unchanged |
| Dark and light mode, Dynamic Type at the largest size, iPhone SE | No layout was changed | Device | Device | Unchanged |
| Demo account: data visible, refresh clean, no Plaid calls | On dev: seeded, read through RLS as that user, sync answered an empty result, both disconnect modes ran with no Plaid call | Device (sign in with the app once) | Device | Device |
| `__DEV__` features absent from a production build | `__DEV__`-guarded, as before | Production build | Production build | Production build |

### Production commands, all in order

All of these are Pedro's, each only on his go-ahead; the CLI stays linked to dev (`ifibrsgqdibcomzxencf`), so every line names
`--project-ref awiwcgrisyzimzxgddxu`. Nothing here has been run. Work top to bottom; the order is the dependency order.

**0. Before anything.** `npx supabase migration list --project-ref awiwcgrisyzimzxgddxu`. Expect exactly two pending migrations,
`20261018130000_apple_identity.sql` and `20261018140000_demo_items.sql`. If others are pending, stop and ask before pushing.

**1. Schema (first: four functions below filter on `is_demo`, and fail without the column).**

```sh
npx supabase db push --project-ref awiwcgrisyzimzxgddxu
```

**2. Secrets.** Values are the Team ID and Key ID from the Apple Developer portal (P1, P3) and the `.p8` file. Never paste the key
into a chat, a ticket or a commit. In PowerShell:

```powershell
npx supabase secrets set PLAID_IOS_REDIRECT_URI=https://studiosouroboros.com/tusky/plaid/oauth --project-ref awiwcgrisyzimzxgddxu
npx supabase secrets set APPLE_TEAM_ID=<Team ID> APPLE_KEY_ID=<Key ID> --project-ref awiwcgrisyzimzxgddxu
npx supabase secrets set "APPLE_PRIVATE_KEY=$(Get-Content C:\path\to\AuthKey_XXXX.p8 -Raw)" --project-ref awiwcgrisyzimzxgddxu
```

**3. Functions.** One changed (`two-factor`, `plaid-create-link-token`, `delete-account`, `plaid-sync-transactions`, `plaid-webhook`,
`plan-enforcer`, `revenuecat-webhook`) or is new (`apple-notifications`). `apple-notifications` reads `verify_jwt = false` from
`supabase/config.toml`, so deploy it from the repo root.

```sh
npx supabase functions deploy two-factor --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy plaid-create-link-token --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy delete-account --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy apple-notifications --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy plaid-sync-transactions --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy plaid-webhook --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy plan-enforcer --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy revenuecat-webhook --use-api --project-ref awiwcgrisyzimzxgddxu
```

Check that the new public function rejects an unsigned call (expect `401`):

```sh
curl -i -X POST https://awiwcgrisyzimzxgddxu.supabase.co/functions/v1/apple-notifications -H "Content-Type: application/json" -d '{"payload":"x"}'
```

**4. Supabase dashboard of `awiwcgrisyzimzxgddxu`.**
- Authentication -> Providers -> Apple: enable it; **Client IDs** = `com.ouroborosstudios.tusky`; no secret for native sign-in.
- Authentication -> Providers -> Email: **Confirm email** stays ON (it is what stops someone pre-registering a victim's e-mail to hijack
  an Apple link). Look at it; do not assume.
- Authentication -> Policies: turn on leaked-password protection if the plan allows it (a Pro setting); otherwise record it as accepted
  in `docs/ops/security-review-2026-09-27.md`.

**5. Apple Developer portal.**
- Identifiers -> `com.ouroborosstudios.tusky` -> Sign in with Apple -> Configure -> **Server-to-Server Notification Endpoint** =
  `https://awiwcgrisyzimzxgddxu.supabase.co/functions/v1/apple-notifications`.
- Services -> *Sign in with Apple for Email Communication*: domain `studiosouroboros.com`, sender `noreply@studiosouroboros.com` (P4).
  Without it, mail to `@privaterelay.appleid.com` bounces.

**6. Site and Plaid.**
- Ouroboros-Inc repo: `public/.well-known/apple-app-site-association`, `public/tusky/plaid/oauth/index.html` (M3 above) and
  `public/tusky/support.html` (P6).
- Plaid dashboard, **Production**: add `https://studiosouroboros.com/tusky/plaid/oauth` under Allowed redirect URIs (P7). Big OAuth
  banks still wait on Plaid's production access (`docs/ops/production.md`).

**7. The demo account.** Dashboard -> Authentication -> Users -> Add user `appreview@studiosouroboros.com` (Auto Confirm User, a long
random password kept in the team password manager, two-step off). Copy its user id, then run the printed SQL in the SQL editor:

```sh
node scripts/demo-seed.mjs <user-id> --print
```

Re-seed in the days before each submission and after any review that deleted the account.

**8. EAS, then the build.**

```sh
cd apps/mobile
npx eas-cli env:set --environment production --name EXPO_PUBLIC_PROD_REVENUECAT_IOS_KEY --value <appl_ key> --visibility plaintext
npx eas-cli env:list --environment production
```

### Still open, and who owns it

| Item | Owner |
| --- | --- |
| M0 P1–P9 (Apple account type and IDs, key, relay, devices, site files, Plaid URI, Supabase provider, App Store Connect) | Kelvin / Pedro, per the table in the plan |
| `submit.production.ios` (`ascAppId`, `appleTeamId`) in `apps/mobile/eas.json` | Kelvin supplies; add the two values then |
| iOS prebuild check on the Mac (Task 1.4) | Kelvin |
| First EAS iOS dev build and every Device cell above | Kelvin |
| Real `amr`, and the other three M4 unknowns | Kelvin, on the first Apple sign-in |
| Dev Apple secrets (Task 5.5) | Kelvin |
| `npx expo install --fix` for seven older patch mismatches, then a retest | Kelvin, before the first iOS build |
| Rebuild the Android dev client (new native modules) | Kelvin |
| Everything under "Production commands, all in order" | Pedro, on his go-ahead |
| App Store Connect: metadata, screenshots, six subscriptions, review notes, submit | Kelvin / Pedro |
| Push `kelvin` and open the single PR `kelvin -> master` (never merge) | Kelvin's go-ahead |
