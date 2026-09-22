# Monetization — direction, not a commitment

Status: idea recorded 2026-09-22. Nothing here is built, and no price is fixed.

Tusky will stay usable for free and charge for the parts that cost us money or clearly save the user
money. Three tiers:

| Tier | Working name | Idea |
| --- | --- | --- |
| Free | — | One connected bank, recent history, no AI. Good enough to be genuinely useful. |
| Premium | **Tusklet** | Every feature, with limits (banks, history depth, AI allowance). |
| Pro | **Tusk** | The same features with the limits raised or removed. |

Names are provisional. Billing would go through **Stripe**; there is no Stripe account yet.

The tiers differ by *how much*, not by *what*. Both paid tiers open every feature — the ceilings are
what separate them.

## What things actually cost us

Two numbers drive every decision below, and one of them is the opposite of what we assumed.

### Plaid charges per connected bank per month — not per pull

From [Plaid's billing docs](https://plaid.com/docs/account/billing/): *"an Item will incur a monthly
subscription fee as long as a valid `access_token` exists for the Item."* An "Item" is one bank login.

- **Syncing is free.** `/transactions/sync` and webhooks cost nothing per call, so refreshing often
  costs nothing. The one exception is `/transactions/refresh`, billed per request — we don't use it.
- **Only `/item/remove` stops the meter.** A bank that is disconnected, broken, or ignored keeps
  billing us monthly until the Item is deleted at Plaid.
- **Investments and Liabilities are per-Item monthly too**, so they pay for themselves only in a paid
  tier.
- Sandbox is free, which is why none of this has cost anything so far.

The consequence: charging for pulls would charge for the free thing. **The number of connected banks
is the lever**, plus how long we keep idle ones alive.

### AI is cheap by comparison

Anthropic list prices per million tokens (2026-06):

| Model | Input | Output |
| --- | --- | --- |
| Claude Haiku 4.5 | $1 | $5 |
| Claude Sonnet 5 | $2 | $10 |
| Claude Opus 5 | $5 | $25 |

The Batch API runs at half price for work that isn't interactive, and prompt caching cuts repeated
input further. Categorizing one transaction is on the order of 100 tokens, so categorizing ~10,000
transactions costs cents — far less than a single bank connection for a month.

Model choice is deliberately **not decided**. Haiku 4.5 for bulk work with Sonnet 5 for anything
user-facing and open-ended is the obvious starting point. Pedro also raised "Jev from Typesafe AI",
which is unevaluated — pending a link.

## How the tiers work

**Free**
- One connected bank.
- Recent history only (90 days is the starting assumption).
- No AI features.
- Unlimited syncing — it costs us nothing.
- **Idle connections are removed.** After a period of no activity we warn the user, then call
  `/item/remove`. Their transactions stay readable in Tusky; reconnecting creates a fresh connection.

**Tusklet / Tusk**
- More banks (the main cost difference between them).
- Deeper history, up to Plaid's 24 months.
- An AI allowance per month.

**Credits ("Tusky points") buy AI, not pulls.** AI is the thing with a real per-use cost, so it is the
thing worth metering. A free or Premium user who wants more AI than their tier includes can top up
instead of upgrading. Nobody ever pays to refresh their transactions.

## What makes a subscription worth buying

### AI money assistant
- Ask questions in plain language — "how much did I spend on coffee in July?"
- A monthly check-in written in prose: what changed, what to watch.
- Anomaly alerts: this month's spending in a category is unlike the last six.
- Budget suggestions built from actual history instead of a blank form.

### Recurring and bills radar
- Detect subscriptions and recurring bills automatically.
- Flag price increases ("your streaming bill went up 20%") and free trials about to convert.
- A bill calendar, and a cash-flow forecast to the next payday.

### Depth
- 24 months of backfill instead of 90 days.
- Net worth history over time, not just today's number.
- Investments (holdings) and Liabilities (loan and card APRs) — both cost extra per bank, so they sit
  in paid tiers naturally.

### Control and household
- Custom categories and auto-rules, split transactions, merchant renaming.
- CSV/PDF export, including a tax-season export.
- Share a household budget with a partner.

## What this means for the code we already have

Nothing needs changing now. When the time comes:

- **Tier limits belong in Edge Functions, never the client** — the same reasoning that keeps
  `plaid_tokens` server-only. A client-side check is a suggestion, not a limit.
- **A bank-count limit goes in `supabase/functions/plaid-exchange-token/index.ts`**, the only place an
  Item is ever created.
- **Auto-removal conflicts with the schema as it stands.** `accounts` and `transactions` cascade on
  delete from `plaid_items`, so deleting the row would destroy the history we just promised to keep.
  The archive path instead: call `/item/remove` at Plaid, delete the `plaid_tokens` row, and keep the
  `plaid_items` row with a new `archived` status. That also keeps it out of `plaid-sync-transactions`,
  which selects only `active` and `login_required`.
- **Auto-removal needs** a last-activity signal per user and a scheduled job (pg_cron or a scheduled
  function) to do the warning and the removal.
- **AI credits need** a ledger table and an Edge Function that debits before calling the model, so a
  balance is never client-trusted.
- **`transactions.category_is_manual` stays the training seed** for community-informed categorization,
  and AI categorization must obey the existing rule: never overwrite a user's manual category.

## Open questions

- Price points for Tusklet and Tusk, and what a credit costs.
- How many days of inactivity before we remove a free Item, and how we warn.
- Free-tier history window: 90 days or 30?
- Does Tusklet include any AI allowance, or is AI a Tusk and credits-only feature?
- What is Jev from Typesafe AI, and how does it compare to Haiku on cost and quality?
- What Plaid actually charges us at production volume — the public page defers to sales, so the
  per-Item price is still unknown. That number decides the free-tier bank limit.
