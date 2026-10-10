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
