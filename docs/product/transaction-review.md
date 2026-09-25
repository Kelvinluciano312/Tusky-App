# Transaction review & groups (planned, unscheduled)

Noted 2026-09-24. Not yet part of any phase.

## Transaction review: a core feature

This is a Monarch-Money-style review flow, with one payment per screen like an Instagram reel. It should
feel easy and even a bit fun, fast enough to clear a few transactions on a bathroom break. It does not
have to use Monarch's sideways swipe, only something close to it.

Each card lets the user:
- see the payment (merchant, amount, date, account)
- write a memo describing what it was
- fix the category when it is wrong
- set who made the payment

Open questions: gesture model (vertical reel vs. swipe), how an item counts as "reviewed", and whether
review happens after each sync or in batches.

## Groups / households

Accounts are often joint, and people have spouses or families. Users should be able to invite others
to share Tusky as a group. It needs a name, ideally on the elephant/tusk theme (e.g. *herd*). The
"who paid" field depends on this.

Data implications:
- Transactions, accounts and categories would be owned by a group, not a single `user_id`. Today's
  RLS assumes one owner (`(select auth.uid()) = user_id`), so this needs a redesign.
- Each transaction needs new fields: memo, payer (group member) and reviewed state.

## Subscription impact (undecided)

Either every member pays, or there is a family/group plan. See `monetization.md`.
Plaid bills per connected Item, so a shared bank linked once costs the same regardless of member count.

## Related

Category fixes made during review are the natural signal for the planned community categorization
(consent-based learning from category choices).
