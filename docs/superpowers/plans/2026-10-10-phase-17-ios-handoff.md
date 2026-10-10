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
