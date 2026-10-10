# Release builds (Phase 14d)

Release apps are built in the cloud by EAS. That works from Windows, and it is the only way to build
iOS without a Mac. Dev builds keep using `npx expo run:android` and Metro.

## Profiles (`apps/mobile/eas.json`)

| Profile | What | Backend |
| --- | --- | --- |
| `development` | Dev client, internal distribution (Android APK; on iOS an ad hoc build for registered devices) | Local `.env` through Metro (Sandbox Plaid) |
| `development-simulator` | `development`, built for the iOS Simulator (a Mac only, for screenshots) | Same as `development` |
| `production` | Every store build: Play's **Internal testing** track and App Store Connect (TestFlight), later the public releases | **Production** (real banks). A release build with the prod vars always uses real data. |

**Every build that leaves this machine is production** (Phase 15a). Sandbox is for testing in dev
builds; testers on a store track get the real backend. The old `playtest` profile, which pointed a
store build at Sandbox, is gone.

`autoIncrement` with `appVersionSource: remote` means EAS owns `versionCode`. Never set it by hand.

## EAS environment variables

The `.env` file is gitignored, so EAS never sees it. Set variables per EAS environment, with each
value copied from `apps/mobile/.env`. Only `EXPO_PUBLIC_*` values go here: they are public by design,
and no secret ever does.

`production` gets:
- the dev pair (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`), which only a dev build
  falls back to;
- `EXPO_PUBLIC_PROD_SUPABASE_URL` and `EXPO_PUBLIC_PROD_SUPABASE_KEY`;
- `EXPO_PUBLIC_PROD_REVENUECAT_KEY`: RevenueCat's Play key (`goog_…`). Without it the paywall says plans
  are coming soon.
- `EXPO_PUBLIC_PROD_REVENUECAT_IOS_KEY`: RevenueCat's App Store key (`appl_…`). The same rule applies, per
  platform: an iOS build without it says plans are coming soon, and the Android key is never used on iOS
  (`pickRevenueCatKey`). Dev builds read `EXPO_PUBLIC_REVENUECAT_IOS_KEY` from `.env`.

```sh
cd apps/mobile
npx eas-cli env:set --environment production --name EXPO_PUBLIC_PROD_SUPABASE_URL --value <prod url> --visibility plaintext
npx eas-cli env:set --environment production --name EXPO_PUBLIC_PROD_SUPABASE_KEY --value <prod publishable key> --visibility plaintext
npx eas-cli env:set --environment production --name EXPO_PUBLIC_PROD_REVENUECAT_KEY --value <goog_ key> --visibility plaintext
npx eas-cli env:list --environment production   # check before building
```

The legal URLs default to the studio site, `studiosouroboros.com/tusky/privacy`, `/terms` and
`/delete-account` (`constants/legal.ts`; the pages live in the Ouroboros-Inc repo under
`public/tusky/`), so no env var is needed for them.

## Plans on a store build

The paywall needs, for the production backend:
- migrations through 14d and the functions `plan-refresh`, `revenuecat-webhook` and `plan-enforcer`
  deployed, with their secrets (`docs/ops/production.md`);
- in RevenueCat, the Play app with its service-account credentials, a **current** offering named
  `default`, and packages `tusklet_monthly`, `tusklet_yearly`, `tusk_monthly`, `tusk_yearly`,
  `tusk_herd_monthly`, `tusk_herd_yearly`, each attached to its Play subscription and base plan;
- in Play, the subscriptions active, and testers listed under Settings → **License testing** so their
  purchases are free test purchases;
- for iOS, the same six packages on the **App Store app** in RevenueCat, each attached to an App Store
  subscription (one subscription group, so a person holds one plan at a time). Details: "iOS builds" below.

## Building and uploading

```sh
cd apps/mobile
npx eas-cli build --platform android --profile production
```

The first time, answer **Yes** to "Generate a new Android Keystore?". EAS then keeps the upload key.
Never lose access to the Expo account: that key is what Play trusts.

- **First upload:** by hand. Download the `.aab` from the build page, then in the Play Console go to
  Testing → Internal testing → Create release. Google requires the first upload to be manual.
- **Later uploads:** `npx eas-cli submit --platform android --profile production` (to the internal
  track as a draft), once a Play service-account key is stored in EAS (`npx eas-cli credentials`).
  Promote a tested release to production in the Play Console.

## iOS builds (Phase 17)

Everything here runs from Windows through EAS. A Mac is only needed to run the iOS Simulator and take
screenshots, and for the one-time prebuild check below. Bundle id `com.ouroborosstudios.tusky`; the
iPhone stays portrait, the iPad rotates (`supportsTablet`). Android is unaffected by anything in this section.

**Before the first build** (a person, once; the steps and who owns each are `P1`–`P9` in
`docs/superpowers/plans/2026-10-10-phase-17-ios.md`):
- the Apple Developer account is an **Organization**, and the App ID has Sign In with Apple and Associated Domains;
- test devices are registered (`npx eas-cli device:create`, then open the link on the iPhone and the iPad);
- `studiosouroboros.com` serves the universal-link file, or Plaid's OAuth banks cannot return to the app (the
  file and the Plaid redirect URI are in the handoff, M3);
- `apps/mobile/eas.json` has `submit.production.ios` with `ascAppId` and `appleTeamId`. They are left out of
  the repo until Kelvin supplies them.
- once, on a Mac: `cd apps/mobile && npx expo prebuild --platform ios --no-install --clean`, check
  `ios/Tusky/Info.plist`, `Tusky.entitlements` and `PrivacyInfo.xcprivacy` against plan Task 1.4, then delete `ios/`.
  iOS prebuild refuses to run on Windows, so the same check was done there with
  `npx expo config --type introspect --json`.

**Dev build** (iPhone or iPad, over Metro):

```sh
cd apps/mobile
npx eas-cli build --platform ios --profile development
```

Install it from the build page on a registered device, then start Metro the way CLAUDE.md describes for
Pedro's phone (Tailscale address). The Simulator build is `--profile development-simulator`, on a Mac.

**Store build and TestFlight:**

```sh
cd apps/mobile
npx eas-cli env:list --environment production        # EXPO_PUBLIC_PROD_REVENUECAT_IOS_KEY must be there
npx eas-cli build --platform ios --profile production
npx eas-cli submit --platform ios --profile production
```

`autoIncrement` with the remote version source owns the build number, as it does `versionCode`. The
submit step uploads to App Store Connect; the build appears under TestFlight after Apple's processing
(minutes to an hour). An e-mailed ITMS warning after upload usually means a missing purpose string: add the
key to `ios.infoPlist` in `app.json` with an honest sentence, never a blank.

**Check the production build, not a dev one,** for what `__DEV__` hides. Sign-in must not offer "Switch to
Real data", and the bank screen must show no sandbox buttons (Guideline 2.3.1: nothing hidden or test-only
may ship). Then walk the verification matrix in the handoff.

**What App Review needs:** a demo account with data on the production backend (`docs/ops/app-review.md`),
working Terms of Use and Privacy Policy links on the Plan screen and in Settings, Sign in with Apple on
the sign-in and sign-up screens, in-app account deletion, and subscriptions that can be bought in the
App Store sandbox. The metadata drafts (description, App Privacy answers, screenshot list) are in the
handoff, M8.

**iOS subscriptions.** In App Store Connect create the six subscriptions in one group; in RevenueCat add
the App Store app (the in-app purchase key and the shared secret), attach each product to its package on
the `default` offering, and put the `appl_` public key where "EAS environment variables" says. The
server side needs nothing new: `revenuecat-webhook` and `plan-refresh` already read the store from the
event, and `plan-refresh` is the manual fix when a webhook is late. Sandbox testers are set up under App Store
Connect → Users and Access → Sandbox. Production never accepts Test Store purchases.
