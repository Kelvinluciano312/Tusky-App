import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import type { PlaidApi } from 'npm:plaid@30';

/** An accounts row as this module writes and reads it. */
export type AccountRow = {
  id: string;
  /** Who connected it; each snapshot row keeps it, like every Plaid row (herd_id is filled in SQL). */
  user_id: string;
  current_balance: number | null;
  /** On an archived (disconnected) Item: frozen, so never carried forward. */
  archived?: boolean;
};

export type SnapshotRow = {
  account_id: string;
  user_id: string;
  balance: number;
};

/**
 * Refresh an Item's accounts from Plaid.
 *
 * Upsert, not update: this is also how a newly-opened account gets a row. That
 * matters more than the balances — syncItem filters transactions against the
 * accounts it knows (see sync.ts) and then advances the cursor regardless, so a
 * transaction on an unknown account is dropped and never re-delivered. Calling
 * this BEFORE that map is built is what closes the hole.
 *
 * /accounts/get is covered by the per-Item monthly subscription; the per-request
 * one is /accounts/balance/get, which we never call. What comes back is Plaid's
 * CACHED balance, refreshed on their own cadence (roughly daily) — syncing more
 * often does not move it, which is what makes a daily snapshot converge.
 */
export async function syncAccounts(
  admin: SupabaseClient,
  plaid: PlaidApi,
  accessToken: string,
  userId: string,
  itemId: string,
): Promise<void> {
  const { data } = await plaid.accountsGet({ access_token: accessToken });

  // `hidden` is deliberately absent. PostgREST builds DO UPDATE SET only from
  // the keys present, so leaving it out preserves the user's choice; including
  // it would silently un-hide every hidden account on every sync — and since
  // daily_net_worth filters on hidden, that would reshape the whole chart.
  // Every other key is always emitted, nulls included: a ragged key set across
  // array elements is PGRST102.
  const rows = data.accounts.map((a) => ({
    user_id: userId,
    item_id: itemId,
    plaid_account_id: a.account_id,
    name: a.name,
    official_name: a.official_name,
    mask: a.mask,
    type: a.type,
    subtype: a.subtype,
    current_balance: a.balances.current,
    available_balance: a.balances.available,
    iso_currency_code: a.balances.iso_currency_code ?? 'USD',
  }));

  const { error } = await admin.from('accounts').upsert(rows, { onConflict: 'plaid_account_id' });
  if (error) throw error;
}

/**
 * Snapshot rows for one day, from every account the herd holds.
 *
 * Every account, not just the synced Item's: otherwise a day where Item A synced
 * and Item B did not would sum to a partial net worth and the chart would
 * sawtooth. Snapshotting all of them makes each date complete by construction,
 * which is what lets daily_net_worth be a plain group-by with no carry-forward.
 *
 * Archived banks' accounts are skipped: their balance is frozen, and Home no
 * longer counts them. Their past rows stay, so earlier days still include them.
 *
 * `date` is omitted so the column default (current_date) applies — one clock,
 * and defaults resolve before ON CONFLICT arbitration.
 */
export function buildSnapshotRows(accounts: AccountRow[]): SnapshotRow[] {
  return accounts
    .filter((a) => !a.archived)
    // Sorted so two concurrent invocations take row locks in the same order.
    // The claim in syncItem is per-Item and the webhook path runs in
    // waitUntil, so two Items of one user really can snapshot at once; without
    // a deterministic order that can deadlock and lose a write.
    .map((a) => ({
      account_id: a.id,
      user_id: a.user_id,
      // Mirrors signedBalance's `?? 0`. The column is nullable and Plaid returns
      // null for some brokerage accounts; since this is one multi-row insert, a
      // single null would abort the whole day rather than one account.
      balance: a.current_balance ?? 0,
    }))
    .sort((a, b) => (a.account_id < b.account_id ? -1 : a.account_id > b.account_id ? 1 : 0));
}
