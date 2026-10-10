# App Review (Phase 17)

Apple's reviewers must sign in and see a working app on the production build. They cannot be asked
to link a real US bank, so production carries one **demo account** whose bank is seeded straight
into the tables. Plan: `docs/superpowers/plans/2026-10-10-phase-17-ios.md`, milestone M7.

## How the demo bank works

- `plaid_items.is_demo = true` marks it. It has **no `plaid_tokens` row and no Plaid Item behind it**.
- Anything that would ask Plaid about it skips it: `plaid-sync-transactions`, `plaid-webhook` and the
  plan enforcer all filter `is_demo = false`. Pull-to-refresh on the demo account returns no results and
  no error.
- Disconnect ("Keep history" or "Delete everything") and account deletion work as for any bank.
  `disconnectItem` skips the Plaid call when an Item has no token row, which a demo Item never has.
- `authenticated` cannot write `is_demo` (no column grant), so no user can flag their own bank.

## What the account holds (`scripts/demo-seed.mjs`)

| Part | Content |
| --- | --- |
| Profile | "Alex Demo", onboarded, two-step **off**, AI categorising **off** |
| Terms | Accepted at the `TERMS_VERSION` in `constants/legal.ts`, so the accept-terms screen never shows |
| Plan | A 90-day `trial` (see Caveats for why it is not comped) |
| Bank | "Tusky Demo Bank": Everyday Checking, Rainy Day Savings, Demo Rewards Card |
| Transactions | About 185 over 100 days, all categorised, 2 pending, **8 waiting in the review deck** |
| Recurring | Rent, a biweekly paycheck, Netflix (with a price rise) and Spotify |
| Budgets | Groceries, coffee shops, restaurants and bars, shopping |
| History | Daily balance snapshots, so net worth and the charts are filled |
| Crowd labels | Consent withdrawn, so nothing a reviewer does on fake merchants reaches the shared pool |

The data is built **relative to the day it was seeded**. Re-seed in the days before submitting, so
"today" is not a quiet month-old ledger.

## Seeding

The script needs a user that already exists: create it first, then seed.

### Dev rehearsal

```sh
# a throwaway dev user: dashboard -> Authentication -> Users -> Add user (tick Auto Confirm User)
node scripts/demo-seed.mjs <user-id>
```

It refuses unless the CLI is linked to dev. It rolls back as a whole if anything is wrong (one `do`
block) and prints a summary: 3 accounts, 8 in the review queue, 4 streams, 4 budgets, `demo_tokens: 0`.

It also refuses when the user's herd has other members, or when the user has a real (non-demo) bank.
In the second case, disconnect that bank in the app first, so Plaid stops billing for it.

Running it again wipes and rebuilds the demo bank. That is also how the account is reset after a review.

### Production (Pedro, on his go-ahead)

Every command here names the production project. The CLI stays linked to dev.

```sh
# 1. The schema and the four functions that know about demo Items
npx supabase db push --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy plaid-sync-transactions --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy plaid-webhook --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy plan-enforcer --use-api --project-ref awiwcgrisyzimzxgddxu
npx supabase functions deploy revenuecat-webhook --use-api --project-ref awiwcgrisyzimzxgddxu
```

2. Dashboard of `awiwcgrisyzimzxgddxu` -> Authentication -> Users -> **Add user**:
   - Email `appreview@studiosouroboros.com`, **Auto Confirm User** ticked (the confirmation mail would
     never reach a reviewer).
   - A long random password. Keep it in the team password manager. It is never committed, pasted into a
     ticket, or put in this repo.
   - Copy the new user's id.
3. Print the seed SQL and run it in the dashboard's SQL editor (it runs as `postgres`):

   ```sh
   node scripts/demo-seed.mjs <user-id> --print
   ```

4. Sign in once on a production build and walk the checks below.
5. Two-step stays **off** for this account. A reviewer cannot receive its code.

## Checks after seeding

- Home: three balances and a net-worth chart with history.
- Transactions: a full feed, two pending rows, no uncategorised rows.
- Review: a deck of 8 cards.
- Budgets, Reports and Recurring show data, and Netflix shows a price change.
- Pull-to-refresh: no error banner.
- Bank screen: "Keep history" and "Delete everything" work with no Plaid call.
- Settings -> Account & privacy: the Delete my account sheet opens.

## Caveats

- **The plan is a trial, not a comp.** `revenuecat.ts` never overwrites a comped row, so a reviewer who
  bought a plan would see no change, and Apple checks that purchases work. A trial row is replaced by a
  real entitlement. The trial lasts 90 days; re-seeding renews it.
- **A reviewer can still link a real bank** from the production build. That is a real Plaid Item, and
  Plaid bills per connected Item. After the review, look for any non-demo Item on this user and
  disconnect it from the app (`node scripts/demo-seed.mjs` will refuse until you do).
- **A reviewer can delete the account.** Re-create the user and seed again before the next submission.
- **Bumping `TERMS_VERSION` means re-seeding**, or the reviewer lands on the accept-terms screen.
- **Sign in with Apple** is testable with any Apple ID and needs no demo credentials. A "Hide My
  Email" address only receives mail once the relay sender is registered (production.md).
- **Nothing here is secret** except the password. The user id and email may appear in review notes.

## Review notes (paste into App Store Connect -> App Review Information)

> **Demo account** (a sample account with sample data; no real bank is needed)
> Email: appreview@studiosouroboros.com
> Password: *(entered in the Password field of Sign-in Information)*
>
> Tusky is a personal finance app. It connects to banks through Plaid. Real bank linking needs a real
> US bank login, so the demo account comes with a sample bank, "Tusky Demo Bank", that is already
> linked. All screens (Home, Transactions, Review, Budgets, Reports, Recurring) can be explored with it.
> A screen recording of linking a real bank through Plaid is at: *(video link)*.
>
> - Two-step verification is off for the demo account.
> - **Sign in with Apple** is on the sign-in and sign-up screens and works with any Apple ID.
> - **Subscriptions** (Tusklet, Tusk, Tusk Herd) are on the Plan screen. Please test them with the
>   App Store sandbox. Terms of Use and Privacy Policy links are on that screen and in Settings.
> - **Account deletion**: Settings -> Account & privacy -> Delete my account. It deletes the account and
>   its data, and revokes the Sign in with Apple token. Re-create the demo account before a retest.
> - **App lock** (optional): Settings -> Account & privacy -> Lock with Face ID.
