# Stripe subscriptions: design (ready to build, not scheduled)

Status: **not started**. Stripe setup paused on 2026-09-23. Done: account, sandbox, onboarding
answers, and both products with their prices. Still to do in the Dashboard: accept the Managed
Payments ToS, set Tusklet's monthly `tax_behavior` to exclusive, and add lookup keys. We will build this in the monetization phase. Product direction lives in
`docs/product/monetization.md`. This file covers the build.

## Decision: Managed Payments (Stripe as merchant of record)

We do not want to handle tax filings ourselves. With Managed Payments, Stripe is the merchant of
record. It calculates, collects, files and remits sales tax, VAT and GST in 80+ countries (US included),
and it also handles fraud, disputes and transaction-level customer support. Receipts show
"Sold through Link".

Constraints this imposes (from Stripe docs, 2026-09):

- **Checkout Sessions or Payment Links only.** Subscriptions must be created through Checkout. Elements,
  embedded components and `POST /v1/subscriptions` are not allowed. This fits our plan (Checkout).
- **Only Stripe Tax** as the tax engine; we don't set `automatic_tax` or tax params ourselves, because
  Stripe manages them when `managed_payments.enabled` is on.
- Products must use an eligible digital tax code. Ours use `txcd_10103000` (SaaS).
- The business must be in a supported location (US qualifies). No Connect.
- **Brazil is NOT in the covered-country list.** Brazilian sales would still go through, but tax
  compliance there (registration, NFS-e invoices) stays our job. Decide on Brazil before
  launching there.
- Its fees are higher than plain Stripe Tax. Check the current rate at stripe.com/pricing before launch.
- We have to accept the Managed Payments Terms of Service in Dashboard → Settings → Managed Payments.
- Stripe also publishes a guide for accepting mobile app payments with Managed Payments
  (docs.stripe.com/payments/managed-payments/set-up-mobile). Read it first, because the app-store rules
  (see monetization.md) decide how the app opens Checkout.
- API version: Managed Payments shipped as `2026-02-25.preview` and went GA in `2026-04-22.dahlia`.
  Pin the SDK to a version that includes it. The blueprint's `2026-02-25.preview` header is no longer
  needed if the SDK is on dahlia or later. Verify this when building.

## Sandbox resources (Ouroboros Studios sandbox, `acct_1UIthOPdafp3yx2H`)

| Product | Product id | Monthly price | Yearly price |
| --- | --- | --- | --- |
| Tusklet | `prod_VJXiodsa3ydlZK` | `price_1UIudIPdafp3yx2Hx36G5VYS` ($3.99) | `price_1UIudIPdafp3yx2HuF3W7Et9` ($45) |
| Tusk | `prod_VJXjQY0uiQZtLM` | `price_1UIueQPdafp3yx2HSFOydM8T` ($6.99) | `price_1UIufxPdafp3yx2Ho8bysy10` ($75) |

Before building, give these prices **lookup keys** (`tusklet_monthly`, `tusklet_yearly`,
`tusk_monthly`, `tusk_yearly`) so the code never hardcodes a price id. Live-mode ids will differ.
Also: the Tusklet monthly price has `tax_behavior: unspecified` while the others use `exclusive`.
Set it to `exclusive` for consistency. Managed Payments may override it either way.

## Architecture (follows repo conventions)

The secret key lives only in Edge Function secrets (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`).
The app never calls Stripe with a secret. It needs no publishable key either, because Checkout is
hosted.

### Table: `subscriptions`

`user_id` (pk, fk auth.users), `stripe_customer_id`, `stripe_subscription_id`, `tier`
(`tusklet`|`tusk`), `status` (Stripe's subscription status), `current_period_end`, `updated_at`.
RLS enabled, with a select-only policy `(select auth.uid()) = user_id` and `grant select` to
`authenticated`. **No client insert or update**: only the webhook (service role) writes, the same
pattern as `plaid_tokens`. Tier limits are enforced in Edge Functions that read this table.

### Edge Function: `stripe-create-checkout-session` (JWT required)

Input: `{ lookup_key }`. It:

1. Resolves the user from the JWT.
2. Reuses `subscriptions.stripe_customer_id`, or creates a Customer with `metadata.user_id`.
3. `POST /v1/checkout/sessions` with `mode: subscription`, the price found by lookup key,
   `customer`, `client_reference_id: user_id`, `subscription_data.metadata.user_id`,
   `managed_payments: { enabled: true }`, and `success_url`/`cancel_url` pointing to app deep links.
4. Returns `{ url }`. The app opens it (`expo-web-browser`).

### Edge Function: `stripe-webhook` (`verify_jwt = false`)

Public like `plaid-webhook`, so it **must** verify `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`
before doing anything else (`stripe.webhooks.constructEventAsync`, since Deno needs the async form).
Handle:

- `checkout.session.completed`: upsert `subscriptions` (customer, subscription, tier, status).
- `customer.subscription.updated` / `.deleted`: update the status, tier and period end.
- `invoice.payment_failed`: the status follows from the subscription update. Optionally notify the user.

Handle each event idempotently: upsert on `user_id`, and when events arrive out of order, trust the
subscription's current state, re-fetched from Stripe, over the event payload.

### Manage or cancel

Use the Stripe **Customer Portal** (a `stripe-create-portal-session` function that returns a URL), not
custom UI. Before building, check whether Managed Payments supports the portal.

## Testing

Sandbox with test card `4242 4242 4242 4242`. Try several billing addresses (the blueprint suggests
it) to see tax change by location. For local webhooks, `stripe listen --forward-to <function url>`.
Test these cases: successful subscribe, a declined card (`4000 0000 0000 0002`), cancel via the
portal, and upgrading from Tusklet to Tusk.

## Source

Adapted from Stripe Workbench's "Set up Managed Payments" blueprint (create product, create a
Checkout Session with `managed_payments[enabled]=true`, test payment, listen for
`checkout.session.completed`). Products and prices already exist, so we skip that step.
