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
