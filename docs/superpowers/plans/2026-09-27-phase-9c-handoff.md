# Handoff: Phase 9c done, herd membership (2026-09-27)

Branch `pedro-9c`, off `master` (with #12 merged). Spec: `docs/superpowers/specs/2026-09-25-phase-9-herds-design.md` (section 9c).

## What shipped

**DB: `20260927120000_phase9c_herd_membership.sql` (pushed to dev).**
- `herd_invites`: single-use codes, 7-day expiry, readable by the herd, written only by the server.
- Herd mates can read each other's profiles. The owner can rename the herd (RLS plus `grant update (name)`).
- `grant update (is_private)` on accounts, guarded by the `accounts_private_by_connector` trigger.
- `merge_into_herd(user, code, private_account_ids)`:
  - checks the code, that the joiner is alone, and that the herd is under 6;
  - makes the chosen accounts private;
  - moves custom categories, then non-conflicting overrides and rules, then budgets (only if the herd has none), then the banks (the cascade moves the rest);
  - hides accounts the herd already has, and returns them;
  - swaps membership, deletes the old herd, and marks the invite used.
- `leave_herd(user)`:
  - creates the leaver's new herd, remaps custom categories on the leaver's rows to their group, and moves the leaver's banks;
  - deletes the leaver's open invites, swaps membership, and promotes the earliest-joined member if the owner left.
- Both functions are executable by service_role only.

**Function: `herd` (deployed to dev).** Actions:
- `create_invite` (owner; max 5 open invites);
- `revoke_invite` (owner);
- `preview_invite`, with a `blocked` reason when the caller can't join;
- `join`, `leave`;
- `remove_member` (owner, not self).

Pure logic and tests live in `_shared/herd.ts`.

**App.**
- `/herd`: rename, members with initials, invites (share sheet, cancel), leave, and "Join someone else's herd".
- `/join-herd` (type a code) and `/join/[code]` (also the `tusky:///join/<code>` link): a preview, a Share switch per account, then join, with a notice about any duplicate accounts.
- Settings has a herd row. Its bank rows say "Connected by X" and show Reconnect only to the connector.
- Bank screen: a "Who sees it" card with Private switches, for the connector only. Reconnect, disconnect and the dev tools are also connector-only.
- `NameSheet` takes a title and caption.
- The cache resets after join, leave and remove.

`/join-herd` rather than `/join/index`: typed routes listed the nested index as `/join/index`, not `/join`.

**Harness.** `rls-check.mjs --join | --join-leave <joiner> <host>` (see CLAUDE.md). It also checks:
- herd_invites visibility;
- that no member ever sees another member's private account;
- that a member can't make a mate's account private;
- that only the owner can rename;
- that each user's own banks are always in their own herd.

**Tests.** Deno 101 (was 92). App 33 (was 28).

## Verified on dev

**`rls-check`.** All PASS in plain mode (4 users), and in `--join` and `--join-leave` with `33c789b7` joining the test user's herd.
- After the join, the joiner sees 35 accounts; the host sees 34, without the joiner's private one. Transactions: 450 vs 447.
- The third herd is unchanged.
- After the leave, both herds are back to 14/48 and 21/402.

**End to end:**
1. The test user created an invite on the emulator: the share sheet showed the code and link, the invite appeared in the list, and cancelling it removed it.
2. A new user, Kel Test, created an invite through the function.
3. On the emulator, the test user typed the code and saw the preview ("Kel Test invited you · 1 member"). They kept Plaid HSA private and joined.
4. The herd screen showed 2 members, and "Only Kel Test can invite people".
5. Kel Test, through the API:
   - saw 20 of the 21 accounts (no HSA), both profiles, and the 4 budgets that moved over;
   - trying to make the test user's account private was refused (403).
6. Kel left. The test user became owner and alone; Kel saw no accounts.
7. The herd was renamed back to "Pedro Test's herd" in the app, and HSA was shared again from the bank screen.
8. The test user ended with 21 accounts, 402 transactions, 4 budgets and 3 overrides, as before. No private accounts are left.

**Error paths:**
- leave while alone: 409;
- unknown action: 400;
- a cancelled or used code: 404;
- removing a non-member: 404;
- removing yourself: 400.

## Things to know

- **Not exercised in the app:**
  - `remove_member`'s success path. It is `leave_herd`, which the harness rehearses.
  - The duplicate-account notice on join (Kel had no banks; the harness's join did hide duplicates).
  - The invite deep link on the phone.
- **Duplicates stay hidden after leaving.** Accounts hidden as duplicates at join stay hidden after the joiner leaves, because the app can't tell them from ones the user hid. Unhide them on the bank screen.
- **Signed-out links lose the code.** An invite link opened while signed out loses the code (known v1 limit); the shared message carries the code as text.
- **Prod (Track P)** gets this migration with the rest, after Pedro's go-ahead.
- **Next: 9d, who paid.** Its leave step "accounts owned by the leaver become Joint" lands with `owner_id`.
