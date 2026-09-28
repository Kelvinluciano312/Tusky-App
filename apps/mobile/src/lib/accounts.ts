/**
 * What kind of money an account holds (Phase 10), from Plaid's account type.
 * Pure, so `node --test` runs it.
 */

import type { Account } from './queries.ts';

export type AccountGroup = 'cash' | 'credit' | 'investment' | 'loan' | 'other';

/** Home lists groups in this order. */
export const GROUP_ORDER: AccountGroup[] = ['cash', 'credit', 'investment', 'loan', 'other'];

export const GROUP_LABEL: Record<AccountGroup, string> = {
  cash: 'Cash',
  credit: 'Credit cards',
  investment: 'Investments',
  loan: 'Loans',
  other: 'Other',
};

/** Plaid's `type`: depository, credit, loan, investment (formerly brokerage), other. */
export function accountGroup(type: string): AccountGroup {
  switch (type) {
    case 'depository':
      return 'cash';
    case 'credit':
      return 'credit';
    case 'investment':
    case 'brokerage':
      return 'investment';
    case 'loan':
      return 'loan';
    default:
      return 'other';
  }
}

type Balanced = Pick<Account, 'type' | 'current_balance' | 'hidden' | 'in_totals'>;

/** Credit and loan balances are owed, so they count against you. */
export function signedBalance(account: Pick<Account, 'type' | 'current_balance'>): number {
  const balance = account.current_balance ?? 0;
  return account.type === 'credit' || account.type === 'loan' ? -balance : balance;
}

/** Net worth: every shown account that counts in totals. Matches the daily_net_worth view. */
export function netWorth(accounts: Balanced[]): number {
  return accounts.filter((a) => !a.hidden && a.in_totals).reduce((sum, a) => sum + signedBalance(a), 0);
}

/**
 * Shown accounts by group, in GROUP_ORDER, skipping empty groups. Each group's
 * total counts only the accounts in totals, like the headline.
 */
export function groupAccounts<A extends Balanced>(accounts: A[]): { group: AccountGroup; accounts: A[]; total: number }[] {
  return GROUP_ORDER.map((group) => {
    const members = accounts.filter((a) => !a.hidden && accountGroup(a.type) === group);
    return { group, accounts: members, total: netWorth(members) };
  }).filter((g) => g.accounts.length > 0);
}
