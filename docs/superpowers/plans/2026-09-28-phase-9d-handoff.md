# Handoff: Phase 9d done, who paid (2026-09-28)

Branch `pedro-9d`, off `master` (with #13 and Kelvyn's #14 merged). Spec: `docs/superpowers/specs/2026-09-25-phase-9-herds-design.md` (section 9d).

With 9d, milestones 9a–9d are built. Phase 9's remaining work is Track P (the production project), which waits on Pedro.

## What shipped

**DB: `20260928120000_phase9d_who_paid.sql` (pushed to dev).**
- `accounts.owner_id` and `transactions.paid_by` (null = Joint for both), plus `paid_by_is_manual`. They were backfilled, so every account is owned by its connector and every row's payer is its account's owner.
- **Triggers:**
  - `ab_accounts_owner` defaults the owner to the connector on insert.
  - `ab_transactions_paid_by` copies the account's owner onto new rows.
  - Both refuse an owner or payer outside the row's herd (`private.is_herd_member`).
  - `accounts_owner_reapply` re-applies a new owner to rows nobody set by hand.
- **Grants:** `update (owner_id)` on accounts, and `update (paid_by, paid_by_is_manual)` on transactions. `service_role` now has usage on `private`, because sync fires these triggers.
- **`leave_herd` replaced.** The leaver's banks leave with the leaver as owner and payer, and accounts they owned on banks staying in the herd become Joint.

**Sync.** `carryForward` also returns hand-picked payers, and sync copies them from the pending row to the posted row, never over one already picked, and never a payer who has left the herd. Sync's upsert payload never names `paid_by`: the database sets it. `plaid-sync-transactions` and `plaid-webhook` are redeployed.

**App.**
- `components/ui/chips.tsx`.
- `components/who-paid.tsx`: a "Who paid" row on the transaction screen and the review card.
- A "Whose account?" card on the bank screen.
- `payerLabel` in `lib/herd.ts`.
- All of it hides in a herd of one.

**Harness.** `rls-check` gains three checks:
- no owner or payer is outside their herd;
- choosing a payer from another herd is refused;
- changing a mate's account owner re-applies it to that account's rows.

`--join-leave` now tangles ownership before the leave: the host owns one of the joiner's accounts and paid on one of its transactions, and the joiner owns one of the host's accounts.

**Tests.** Deno 104. App 34.

## Verified on dev

**`rls-check`.** All PASS in plain, `--join` and `--join-leave` modes (4 users). After the tangled leave, no owner or payer is outside their herd.

**End to end.** Kel Test joined the test user's herd through the API.
1. On the emulator, the bank screen showed Pedro, Kel and Joint for each account.
2. Setting Plaid Saving to Kel moved all 6 of its rows to Kel.
3. On one transaction's screen, choosing Joint saved it as a manual choice, and the "From whose account" hint went away.
4. Kel set the owner back to Pedro through the API: 5 rows followed and the manual Joint stayed. Making an outsider the owner was refused (400, check violation).
5. Cleanup: that row was reset and Kel left. The test user is alone again, with 0 manual payers, every owner equal to the connector, and every payer equal to the owner.

## Things to know

- **Not exercised end to end:**
  - the review card's "Who paid" (the same component as the transaction screen);
  - carrying a payer from a pending to a posted row (unit-tested only: Sandbox rarely posts pending rows on demand).
- **No undo for a hand-picked payer.** There is no "back to the account's owner" button; picking the owner's chip sets it by hand to the same person.
- **Next**, from the spec's "Later" list: spending by person in Reports, a payer filter on the feed, and splits or settle-up. Track P is still waiting on Pedro: add him to the Ouroboros org, and he enters the prod Plaid secret.
