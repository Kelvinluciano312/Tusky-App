# Phase 14: monetization

Tusky charges for the one thing that costs us money every month: a connected bank. Every new user gets
a 30-day Tusk trial. When it ends, their banks are removed at Plaid and everything they built stays
readable. Paying keeps banks live. The tiers differ in **how much**, not **what**: every paid plan opens
every feature.

This replaces the build plan in `docs/superpowers/specs/2026-09-23-stripe-subscriptions-design.md`
(Stripe Checkout). The cost analysis below shows why store billing wins. Product direction lives in
`docs/product/monetization.md`.

## What we decided with Pedro (2026-09-28)

- **Plans:** Free, Tusklet, Tusk, and a herd plan, **Tusk Herd**, that gives Tusk to everyone in the
  payer's herd.
- **Prices stay as set:** Tusklet $3.99/mo or $45/yr, Tusk $6.99/mo or $75/yr, and Tusk Herd $9.99/mo
  or $99/yr (the yearly price is new).
- **Free is a 30-day Tusk trial, then read-only.** The trial starts automatically at signup, with no
  card. It allows **2 banks**.
- **Billing goes through the stores**, Google Play Billing now and the App Store later, with
  **RevenueCat** over both. Stripe is not used.
- **Tusklet keeps 12 months of history**; Tusk and Tusk Herd keep 24.
- **The herd plan's payer brings people in with a shareable invite link.**
- **Later, not in this phase:** a conversational assistant on Haiku (see "Later"). It is what credits
  are for.

## What things cost (2026-09-28)

### Per subscription, after the store's cut

| Route | Tusklet $3.99 | Tusk $6.99 | Tusk Herd $9.99 |
| --- | --- | --- | --- |
| **Google Play Billing** (15%; Google handles tax) | **$3.39** | **$5.94** | **$8.49** |
| Stripe Managed Payments (6.4% + 30¢) + Google's 10% link-out fee | $3.04 | $5.54 | $8.05 |
| Plain Stripe + Stripe Tax + Google's 10% link-out fee | $3.16 | $5.75 | $8.35 |

- Since 2026-10-01, Google charges **10% on US subscriptions bought through an external link** (its
  external content links program). That erases Stripe's advantage.
- Apple's Small Business Program also takes **15%**, so the same margins hold on iOS. A US court
  order currently bars Apple from charging on link-out purchases, but the Supreme Court took Apple's
  appeal in July 2026. We do not build around it. RevenueCat can add Stripe web checkout later if
  the ruling stands.
- RevenueCat is free up to $2,500 in monthly tracked revenue, then 1%.

### Running costs

| Item | Cost | Notes |
| --- | --- | --- |
| Plaid | **Unknown**, per bank per month | The only real variable cost. It is not public. Kelvyn's Plaid dashboard shows the production rate. Billed per calendar month, not prorated. |
| Supabase Pro (production) | $25/mo fixed | About 8 Tusklet subscribers cover it. |
| Jev | ~$0.05 per user per month | $0.042 per million input tokens, output free. |
| Haiku | $0 | Unused until the assistant ships. |

### Bank limits the margin allows

Each plan can hold this many banks at its cap and still keep **20% of what the store leaves us**,
after Jev:

| Plaid per bank/mo | Tusklet | Tusk | Tusk Herd |
| --- | --- | --- | --- |
| $0.30 | 8 | 15 | 21 |
| $0.60 | 4 | 7 | 10 |
| $1.00 | 2 | 4 | 6 |

The prices hold. **The bank limits are what we tune** once we know Plaid's rate, and they live in a
table, so tuning needs no app release. The starting limits below (3 / 10 / 15) are safe up to about
**$0.45 per bank**.

### Why Free has no live bank

A free user with a live bank costs the Plaid rate every month and pays nothing. At $0.60 a bank, one
Tusklet subscriber covers about 3 such users, but freemium apps usually convert 2 to 5%. That means 20
to 50 free users for each paying one. A trial that ends in read-only caps each non-paying user's cost:
at most 2 banks for at most 2 calendar months, about $2.40 at $0.60 per bank.

## Plans and who gets what

### `plans`

A table (seeded by the migration) so limits change without a release. Readable by `authenticated`,
writable by no client.

| plan | max_banks | history_days | ai | scope |
| --- | --- | --- | --- | --- |
| `free` | 0 | 0 | no | self |
| `trial` | 2 | 730 | yes | self |
| `tusklet` | 3 | 365 | yes | self |
| `tusk` | 10 | 730 | yes | self |
| `tusk_herd` | 15 | 730 | yes | herd |

`rank` orders them (free < trial < tusklet < tusk < tusk_herd) for picking the best of several.

### `subscriptions`

One row per user: `user_id` (pk), `plan`, `store` (`play | app_store | comp | trial`), `status`
(`active | grace | expired`), `expires_at`, `over_limit_since` (null unless the user is over their
bank limit; see below), `updated_at`. The RevenueCat app user id is the Supabase user id, so no
separate id column is needed.

- RLS allows a user to read their own row, **and a herd mate's row when it is `tusk_herd`**, so the
  app can say "covered by Kel's plan". Clients get `select` only. Every write comes from the webhook,
  the signup trigger or the daily job (service role), the same pattern as `plaid_tokens`.
- `handle_new_user` also inserts `('trial', store 'trial', expires_at now() + 30 days)`.
- Existing users (Pedro, Kelvyn, the test users) get `comp` Tusk rows with no expiry, so nobody loses a
  bank when this ships.

### The effective plan

`private.effective_plan(user_id)` returns the best-ranked of:

1. the user's own row, when `status in ('active','grace')` and `expires_at` is null or in the future;
2. a live `tusk_herd` row belonging to any member of the user's herd;
3. `free`.

Everything asks this one function: the Edge Functions, sync, the daily job, and the app (through a
`my_plan()` RPC that returns the plan row, the source (own, herd or trial), `expires_at` and bank usage).

### Counting banks

- A bank is a live `plaid_items` row (`status <> 'archived'`), counted against the plan of the
  member who connected it (`plaid_items.user_id`).
- Under `tusk_herd`, every live bank in the herd counts against one shared pool of 15, whoever
  connected it.
- Reconnecting a broken bank (Link update mode) is never a new bank.

## Enforcing the limits

Every check runs on the server. The app only shows what the server decided.

- **`plaid-create-link-token`** refuses a new bank at the limit with `402 { error: 'plan_limit' }`,
  which opens the paywall. It sets `transactions.days_requested` from the plan's `history_days`.
  Today it sets nothing, so every bank gets Plaid's default of 90 days. Update mode skips the check.
- **`plaid-exchange-token`** checks again. This is the check that counts, because the Item, and
  Plaid's bill, is created here. If a race let a bank past the limit, it calls `/item/remove` at once
  and returns `plan_limit`.
- **`aiAllowed()`** in `_shared/ai.ts` stops being a stub. It takes the connector's user id and
  returns `effective_plan(user).ai`. `jevEnabled` still also requires the key and the connector's
  `ai_categorize` switch.
- **Free** (0 banks) is refused at link-token time, so a lapsed user sees the paywall, not Link.

## When a plan ends or shrinks

A trial ends, a subscription lapses after the store's grace period, or a Tusk Herd payer cancels or
leaves the herd. A **daily job** (pg_cron calling a new `plan-enforcer` function) compares each user's
live banks with their effective plan:

- **Dropping to Free:** every bank the user connected is removed that day through Phase 6's
  keep-history path (`/item/remove`, token deleted, `status = 'archived'`). Transactions, budgets,
  categories, rules, splits and settle-up all stay and keep working on the existing data.
- **Dropping to a smaller plan:** the user has **7 days** to choose which banks to keep, from the bank
  screen. After that, the job removes the most recently linked banks until they are under the limit.
  `subscriptions.over_limit_since` records when the 7 days started.
- **Warnings:** 3 days before a trial ends or a removal happens, Home and the bank screen show a
  banner that links to the paywall. No push notifications in this phase.
- A Plaid failure other than `ITEM_NOT_FOUND` leaves that bank connected and retries the next day,
  exactly as disconnect does today. The token is never deleted after a transient error.
- The job is idempotent: running it twice in a day removes nothing extra.

Idle-bank removal from `monetization.md` is **dropped**: Free has no banks, and paid banks are inside
the margin.

## Reconnecting merges the history

Phase 6 records a known limit: reconnecting a bank whose history was kept shows the overlap **twice**.
With trials that end and subscriptions that reconnect, that becomes the normal path, so this phase
fixes it.

- **Matching accounts.** On the first sync of a new Item, each new account is matched to an archived
  account in the same herd with the same institution, account name and mask (the same rule as
  `isDuplicateLink`).
- **Matching rows.** In the date range the two copies share, each archived row is matched to a new
  row by date, amount and `merchant_key`. The pure logic goes in `_shared/merge.ts` and is unit-tested
  like `carryForward`.
- **Carrying edits.** The user's edits move to the new row: a manual category (with
  `corrected_from`), `notes`, a hand-picked `paid_by`, `split`, and `reviewed_at`. Then the archived
  rows in the overlap are deleted, matched or not, because the new copy is the complete one.
- **Older rows stay.** Archived rows older than the new Item's window stay on the archived account, so
  no history is lost.
- **Recurring streams** are re-derived by the next detection, as always.

## Buying

### Stores and RevenueCat

- **Products:** Tusklet, Tusk and Tusk Herd, each monthly and yearly, created in the Play Console by
  Pedro or Kelvyn. The App Store comes later.
- **Entitlements in RevenueCat:** `tusklet`, `tusk`, `tusk_herd`.
- **User ids:** the app calls `Purchases.logIn(<supabase user id>)`, so a purchase is always tied to
  the signed-in user. RevenueCat's public SDK key goes in `apps/mobile/.env` per project.
- **App SDK:** `react-native-purchases`, which runs in dev builds. Expo Go cannot, and we already do
  not use it.

### `revenuecat-webhook`

Public (`verify_jwt = false`), like `plaid-webhook`, so it needs equivalent verification:

- It first compares the `Authorization` header with `REVENUECAT_WEBHOOK_SECRET` in constant time, and
  refuses everything else.
- It never trusts the event body. It re-fetches the subscriber from RevenueCat's REST API
  (`REVENUECAT_SECRET_KEY`) and upserts `subscriptions` from that state. Out-of-order and repeated
  events are therefore harmless.
- A billing issue maps to `grace`, an expiration to `expired`. Anything unexpected is logged and
  answered 200, so RevenueCat does not retry forever.

### The app

- **A Plan screen** (Settings) shows the plan, where it comes from ("Your trial: 12 days left", or
  "Covered by Kel's Tusk Herd"), bank usage ("2 of 3 banks"), **Restore purchases** (required by
  Apple), and **Manage subscription**, which deep-links to the store. Cancelling happens in the store.
- **A paywall** built with our own theme components, not RevenueCat's prebuilt paywall. It opens from
  the Plan screen, from `plan_limit`, and from the warning banners.
- After a purchase or restore, the app refetches `my_plan()`. The webhook is what grants access.
  The app never decides access itself.
- **The herd invite link.** "Invite" on the Herd screen shares `tusky://join/<code>` through the
  share sheet, with the code written in the message too. Opening the link starts the existing join
  flow with the code filled in. Invites are unchanged: single-use, 7 days, 6 members at most.
- **Deleting an account** while subscribed first tells the user to cancel in the store, because a
  store subscription outlives our account.

## Milestones

One plan, handoff and PR per milestone, as usual. Pedro merges.

- **14a: plans and limits.** `plans`, `subscriptions`, `effective_plan`, `my_plan`, the trial at
  signup, comp rows, limits in link-token and exchange-token, `days_requested`, and `aiAllowed`. No
  store yet: rows are set by hand to act out every plan.
- **14b: lifecycle and merge.** `plan-enforcer` and its cron, the 7-day window, the banners, and the
  reconnect merge.
- **14c: purchases.** RevenueCat, the Play products, `revenuecat-webhook`, the Plan screen, the
  paywall and the invite link.
- **iOS** is its own later step: App Store Connect products under the same entitlements and the same
  webhook. It needs an Apple developer account ($99/yr).

## Testing

- **Unit tests:** the bank-count and limit helpers (`_shared/plans.ts`); the plan resolution itself
  is proved in SQL by `scripts/plan-check.sql`, so it is never mirrored. Also the merge matcher (`_shared/merge.ts`), and the webhook's event-to-row mapping, with a fake
  RevenueCat client.
- **`rls-check.mjs`:** a user reads only their own subscription and herd mates' `tusk_herd`, cannot
  write any row, and cannot write `plans`.
- **Sandbox (dev):**
  - At the limit, link-token and exchange-token refuse.
  - A trial row set to expire yesterday has its banks removed by `plan-enforcer`, and the history is
    still readable.
  - Link, archive and relink First Platypus: every row shows once, and a hand-picked category and
    memo in the overlap survive.
  - Run the job twice: the second run removes nothing.
- **Purchases:** Play Billing works only on a build installed from the **internal testing track**,
  with license-tester accounts. There a monthly plan renews every 5 minutes, so buy, renew, cancel,
  grace, restore and upgrade (Tusklet to Tusk) can all be tested in an afternoon.

## Rollout

- Each milestone's migration and functions go to production only after Pedro's go-ahead.
- Production gets comp rows for real users before 14a's limits go live there.
- **Store purchases stay off in production** until Pedro and Kelvyn decide to launch. Until then
  there is no RevenueCat key in the production app, so the paywall reports "coming soon".

## Needs from Pedro and Kelvyn

- **Plaid's production rate per Item per month** (Kelvyn's dashboard). It sets the final bank limits.
- A RevenueCat account (free tier), and the Play Console products at 14c.
- An Apple developer account whenever iOS starts.

## Later

- **The Tusky assistant**, a chat on Haiku for budgeting tips, help with the app, and questions
  about your own spending. It is its own phase, and it is what credits meter. Before launch:
  - **Education, not advice.** General budgeting education and explaining a user's own spending are
    fine. Recommending specific investments, securities or tax positions is regulated advice. The
    system prompt and a visible "not financial advice" line hold that boundary. Get a legal review.
  - **Privacy.** Sending a user's transactions to Anthropic needs opt-in consent (off by default, like
    `ai_categorize`) and a line in the privacy policy. Anthropic's API terms do not allow training on
    the data.
  - **Store rules.** Google Play and Apple both require apps with generative AI to let users report
    offensive AI output from inside the app.
- **Web checkout** through RevenueCat and Stripe, if Apple's link-out ruling stands.
- **Brazil:** the stores act as merchant of record, which may remove the tax and NF-e concern the
  Stripe plan had. Verify Brazil's store tax handling, and decide BRL pricing, before launching there.
