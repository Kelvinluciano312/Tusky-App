# Phase 14c handoff — purchases

Plan: `2026-09-28-phase-14c-purchases.md`. Spec: `../specs/2026-09-28-phase-14-monetization-design.md`.
Branch `pedro-14c`, cut from `pedro-14b`. Dev only; production is untouched.

## What shipped

1. **The mapper** (`_shared/revenuecat.ts`: `subscriptionFromRc`). Turns a RevenueCat v1 subscriber record into our
   `subscriptions` row:
   - A billing issue maps to `grace` and an ended plan to `expired`. When several plans are live, the best-ranked wins.
   - A `comp` row is never changed, and a trial is replaced only by a live purchase.
   - A record emptied by a restore on another account expires the row we wrote.
   - Test Store purchases (`test_store` → `test`) count only where `PLAID_ENV=sandbox`.
2. **`revenuecat-webhook`** (public, `verify_jwt = false`). It checks `Authorization` against
   `REVENUECAT_WEBHOOK_SECRET` first. Only the user ids are read from the event, and a TRANSFER re-reads both
   accounts. Each user is then re-fetched from RevenueCat.
   - A RevenueCat or database failure answers 500, so RevenueCat retries.
   - Anything else answers 200.
3. **`plan-refresh`** (JWT). The app calls it right after a purchase or restore. It runs the webhook's own
   `syncSubscriber` for the caller, so the new plan shows without waiting for the webhook.
4. **Migration `20261010120000`** allows store `test`.
5. **The app.**
   - `lib/purchases.ts` (`react-native-purchases` 10.10). RevenueCat's user is the Supabase user; identify calls
     run in order.
   - A purchase or restore goes ahead only once `ensurePurchaser` confirms that RevenueCat is on the signed-in user.
   - `lib/paywall.ts` is pure: tiers, the plan summary, the herd payer, `ownPaidPlan`, and `productChange`.
   - Screens:
     - The paywall (`/paywall`, modal) takes prices from the store and limits from `plans`.
     - The Plan screen (`/plan`) shows Manage subscription, Restore purchases, and Invite for a Tusk Herd payer.
     - Settings has a Plan row.
     - The warning banner and a refused bank ("See plans") both open the paywall.
   - A payer whose herd mate's Tusk Herd covers them still sees their own plan and can manage it.

## Dev state

- Migration `20261010120000` is applied. The constraint reads
  `store in ('play','app_store','comp','trial','test')`.
- `revenuecat-webhook` and `plan-refresh` are deployed to dev. No RevenueCat secret is set yet, so the webhook
  refuses everything.
- The emulator (Pixel_7, x86_64) has a dev build that includes `react-native-purchases`. Pedro's phone needs its
  own arm64 rebuild before it can run this JS.
- `EXPO_PUBLIC_REVENUECAT_KEY` is empty, so the paywall says "Plans are coming soon".

## Verified

- `deno test _shared/`: 271 passed. App `npm test`: 125 passed. Typecheck and lint are clean.
- On dev, `revenuecat-webhook` answers 401 with no header and with a wrong one. `plan-refresh` answers 401 without
  a JWT.
- Emulator:
  - Settings shows "Tusk / Your plan · 1 of 10 banks".
  - `/plan` shows Tusk, Complimentary, 1 of 10 banks and See plans, with no Manage button for a comp row.
  - `/paywall` shows "Plans are coming soon".
- A final whole-branch review (fresh reviewer) found one Critical and two Important issues:
  - A restore left the old account on a paid plan.
  - A failed identify could buy under the wrong RevenueCat user.
  - A herd-covered payer could not reach Manage subscription.
  All three are fixed with tests that failed first.

## Not verified yet: live purchases (plan Task 7, Steps 1 and 3–8)

These need a RevenueCat account, which is Pedro's to create. See the plan's Task 7 for the full checklist:
- **Setup:** Test Store products, the entitlements `tusklet`, `tusk` and `tusk_herd`, and the `default` offering
  with `<plan>_monthly` / `<plan>_yearly` packages.
- **Webhook:** point it at dev and set its Authorization value. Then set `REVENUECAT_SECRET_KEY` and
  `REVENUECAT_WEBHOOK_SECRET` on dev one at a time. Never use `--env-file`.
- **Key:** put the Test Store key in `apps/mobile/.env` as `EXPO_PUBLIC_REVENUECAT_KEY`, then restart Metro.
- **Run:**
  - Buy, upgrade, restore and cancel, and let a purchase expire.
  - **Add a transfer check:** restore on a second account and confirm the first account's row reads `expired`.
  - Check that a Test Store purchase writes `store = 'test'`. If it is ignored, the v1 `store` literal differs
    from `test_store`: the webhook log names the real value, and `storeOf` is the one line to fix.

## Deferred minors (from the final review)

- If `plan-refresh` fails, the app only logs a warning; it never tells the user or refetches later.
- A deferred downgrade closes the paywall without saying that it takes effect at renewal.
- The billing period of the current plan cannot be switched (monthly ↔ yearly).
- The webhook and `plan-refresh` can overwrite each other near a renewal; the next event corrects it.
- `plan-refresh` has no per-user throttle against RevenueCat's rate limit.
- A network error loading offerings reads as "Plans are coming soon".
- The paywall's "already covered" card can appear after the tier buttons are already tappable.
- The grace-period message always names the Play Store.

## Waits on Pedro

1. **RevenueCat setup** and the live run above.
2. **The Play Console.** Create the `tusklet`, `tusk` and `tusk_herd` subscriptions with `monthly` and `yearly` base
   plans at the spec's prices. Link Play to RevenueCat with a service account, then attach the Play products to the
   same entitlements and packages.
3. **Where Play purchases get tested.** Play Billing needs a build from the internal testing track, and release
   builds talk to production. The choice:
   - test against production, which needs the 14a–14c push and a production RevenueCat key in that build only; or
   - ship an internal-track build that uses the dev backend.
4. **Production.**
   - Push the migration (after 14a and 14b).
   - Deploy `revenuecat-webhook` and `plan-refresh`.
   - Set the two secrets (`docs/ops/production.md`, "RevenueCat").
   - Leave `EXPO_PUBLIC_PROD_REVENUECAT_KEY` empty until launch.
5. **No account deletion exists yet.** When one is built, it must first tell a Play or App Store subscriber to cancel
   in the store.
