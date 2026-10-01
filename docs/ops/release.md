# Release builds (Phase 14d)

Release apps are built in the cloud by EAS. That works from Windows, and it is the only way to build
iOS without a Mac. Dev builds keep using `npx expo run:android` and Metro.

## Profiles (`apps/mobile/eas.json`)

| Profile | What | Backend |
| --- | --- | --- |
| `development` | Dev client, internal distribution | Local `.env` through Metro (Sandbox Plaid) |
| `production` | Every store build: Play's **Internal testing** track today, later the public release | **Production** (real banks). A release build with the prod vars always uses real data. |

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
  purchases are free test purchases.

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
