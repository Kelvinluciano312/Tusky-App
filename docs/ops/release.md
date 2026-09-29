# Release builds (Phase 14d)

Release apps are built in the cloud by EAS. That works from Windows, and it is the only way to build
iOS without a Mac. Dev builds keep using `npx expo run:android` and Metro.

## Profiles (`apps/mobile/eas.json`)

| Profile | What | Backend |
| --- | --- | --- |
| `development` | Dev client, internal distribution | Local `.env` through Metro |
| `playtest` | Release `.aab` for Play's **Internal testing** track | **Dev** (Sandbox Plaid). No `EXPO_PUBLIC_PROD_*` vars, so `pickBackend` chooses sandbox. Play license-tester purchases are RevenueCat sandbox events, and they go to the dev webhook. |
| `production` | The real release | **Production**. A release build with the prod vars always uses real data. |

`autoIncrement` with `appVersionSource: remote` means EAS owns `versionCode`. Never set it by hand.

## EAS environment variables

The `.env` file is gitignored, so EAS never sees it. Set variables per EAS environment, with each
value copied from `apps/mobile/.env`. Only `EXPO_PUBLIC_*` values go here: they are public by design,
and no secret ever does.

```sh
cd apps/mobile
# preview (playtest): the dev project and RevenueCat's Play key (goog_…)
npx eas-cli env:set --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value <dev url> --visibility plaintext
npx eas-cli env:set --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <dev publishable key> --visibility plaintext
npx eas-cli env:set --environment preview --name EXPO_PUBLIC_REVENUECAT_KEY --value <goog_ key> --visibility plaintext
```

`production` gets:
- the dev pair;
- `EXPO_PUBLIC_PROD_SUPABASE_URL` and `EXPO_PUBLIC_PROD_SUPABASE_KEY`;
- **at launch only**, `EXPO_PUBLIC_PROD_REVENUECAT_KEY`. Until then, production's paywall says plans are coming soon.

The legal URLs default to the studio site, `studiosouroboros.com/tusky/privacy` and `/delete-account` (`constants/legal.ts`; the pages live in the Ouroboros-Inc repo under `public/tusky/`), so no env var is needed for them.

## Building and uploading

```sh
cd apps/mobile
npx eas-cli build --platform android --profile playtest
```

The first time, answer **Yes** to "Generate a new Android Keystore?". EAS then keeps the upload key.
Never lose access to the Expo account: that key is what Play trusts.

- **First upload:** by hand. Download the `.aab` from the build page, then in the Play Console go to
  Testing → Internal testing → Create release. Google requires the first upload to be manual.
- **Later uploads:** `npx eas-cli submit --platform android --profile playtest`, once a Play
  service-account key is stored in EAS (`npx eas-cli credentials`).

**The internal track holds one release at a time.** A `playtest` build uploaded there **replaces** a
`production` build for everyone on the track, and the other way round. Say which one is live when you
hand a build to testers.
