/**
 * Settle-up (Phase 11b). Pure, so `node --test` runs it.
 *
 * Every shared line has two sides: who paid (the account's owner, `funded_by`;
 * a Joint account is everyone equally) and who it was for (`paid_by`, a
 * person or Joint = everyone equally, or a custom `split` in percents). Where
 * the two differ, someone owes someone. Settlements are the payments that
 * square it.
 *
 * "Everyone" means the members who had joined by the line's date, so a new
 * member never inherits old Joint purchases. Anyone no longer in the herd is
 * dropped: a split renormalizes over who is left, and a line with nobody left
 * on one side counts for nothing.
 */

export type SettleMember = { user_id: string; joined_at: string };

export type SharedLine = {
  id: string;
  date: string;
  /** Ledger sign: a purchase is negative, a refund positive. */
  amount: number;
  funded_by: string | null;
  paid_by: string | null;
  split: Record<string, number> | null;
};

export type Settlement = { id: string; from_user: string; to_user: string; amount: number };

export type Transfer = { from: string; to: string; amount: number };

type Shares = Map<string, number>;

const cents = (n: number) => toCents(n) / 100 + 0;

function equalShares(date: string, members: SettleMember[]): Shares {
  const joined = members.filter((m) => m.joined_at.slice(0, 10) <= date);
  const who = joined.length > 0 ? joined : members;
  return new Map(who.map((m) => [m.user_id, 1 / who.length]));
}

function personShares(userId: string, members: SettleMember[]): Shares {
  return members.some((m) => m.user_id === userId) ? new Map([[userId, 1]]) : new Map();
}

/** Who a line was for, as fractions summing to 1 (or empty: nobody left). */
export function benefitShares(line: SharedLine, members: SettleMember[]): Shares {
  if (line.split) {
    const present = Object.entries(line.split).filter(
      ([id, pct]) => pct > 0 && members.some((m) => m.user_id === id),
    );
    const total = present.reduce((sum, [, pct]) => sum + pct, 0);
    return total > 0 ? new Map(present.map(([id, pct]) => [id, pct / total])) : new Map();
  }
  return line.paid_by === null ? equalShares(line.date, members) : personShares(line.paid_by, members);
}

/** Whose money paid for a line, as fractions summing to 1 (or empty). */
export function fundingShares(line: SharedLine, members: SettleMember[]): Shares {
  return line.funded_by === null ? equalShares(line.date, members) : personShares(line.funded_by, members);
}

/** Whole cents, halves away from zero, so a debtor and a creditor round alike (-316.5 → -317). */
function toCents(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-7);
}

/**
 * Each member's net position, to the cent: positive means they are owed,
 * negative that they owe. Kept in whole cents line by line, and each line's
 * odd cent goes to its largest share, so every line nets to exactly zero and a
 * recorded payment of the shown amount squares the balance exactly.
 */
export function balances(lines: SharedLine[], settlements: Settlement[], members: SettleMember[]): Map<string, number> {
  const net = new Map(members.map((m) => [m.user_id, 0]));
  for (const line of lines) {
    const funded = fundingShares(line, members);
    const benefit = benefitShares(line, members);
    if (funded.size === 0 || benefit.size === 0) continue;
    const cost = -line.amount;
    const delta = new Map<string, number>();
    for (const [id, share] of funded) delta.set(id, (delta.get(id) ?? 0) + cost * share);
    for (const [id, share] of benefit) delta.set(id, (delta.get(id) ?? 0) - cost * share);
    const rounded = [...delta].map(([id, d]) => ({ id, d, c: toCents(d) }));
    const residual = rounded.reduce((sum, r) => sum + r.c, 0);
    if (residual !== 0) rounded.sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0].c -= residual;
    for (const r of rounded) net.set(r.id, net.get(r.id)! + r.c);
  }
  for (const s of settlements) {
    if (!net.has(s.from_user) || !net.has(s.to_user)) continue;
    const c = toCents(s.amount);
    net.set(s.from_user, net.get(s.from_user)! + c);
    net.set(s.to_user, net.get(s.to_user)! - c);
  }
  for (const [id, value] of net) net.set(id, value / 100 + 0);
  return net;
}

/**
 * The payments that square everyone, fewest first: the biggest debtor pays the
 * biggest creditor until one of them is even. For two people, one payment.
 */
export function settleTransfers(net: Map<string, number>): Transfer[] {
  const debtors = [...net].filter(([, v]) => v < -0.004).map(([id, v]) => ({ id, left: -v }));
  const creditors = [...net].filter(([, v]) => v > 0.004).map(([id, v]) => ({ id, left: v }));
  const transfers: Transfer[] = [];
  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort((a, b) => b.left - a.left);
    creditors.sort((a, b) => b.left - a.left);
    const debtor = debtors[0];
    const creditor = creditors[0];
    const amount = cents(Math.min(debtor.left, creditor.left));
    if (amount > 0) transfers.push({ from: debtor.id, to: creditor.id, amount });
    debtor.left = cents(debtor.left - amount);
    creditor.left = cents(creditor.left - amount);
    if (debtor.left <= 0.004) debtors.shift();
    if (creditor.left <= 0.004) creditors.shift();
  }
  return transfers;
}

/** What one line alone makes someone owe, e.g. for its caption. Empty when it squares itself. */
export function lineTransfers(line: SharedLine, members: SettleMember[]): Transfer[] {
  return settleTransfers(balances([line], [], members));
}

/** Percents for an even split: two decimals, summing to exactly 100 (the first takes the odd cents). */
export function evenSplit(userIds: string[]): Record<string, number> {
  if (userIds.length === 0) return {};
  const base = Math.floor(10000 / userIds.length) / 100;
  const extra = cents(100 - base * userIds.length);
  return Object.fromEntries(userIds.map((id, i) => [id, i === 0 ? cents(base + extra) : base]));
}

/** Why a split can't be saved, or null. Zero shares are fine: they're dropped on save. */
export function validateSplit(percents: Record<string, number>): string | null {
  const values = Object.values(percents);
  if (values.some((v) => !Number.isFinite(v) || v < 0 || v > 100)) return 'Each share is between 0% and 100%.';
  if (values.filter((v) => v > 0).length < 2) return 'A split needs at least two people.';
  const total = values.reduce((sum, v) => sum + v, 0);
  if (Math.abs(total - 100) > 0.01) return `Shares add up to ${cents(total)}%, not 100%.`;
  return null;
}

/** A split ready to save: zero shares dropped. */
export function cleanSplit(percents: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(percents).filter(([, v]) => v > 0));
}
