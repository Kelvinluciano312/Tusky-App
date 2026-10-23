/**
 * Outstanding settle-up balances for the weekly nudge. The rules match
 * apps/mobile/src/lib/settle.ts (whole cents, split-only debts). Keep the two
 * together: a change to who owes whom belongs in both.
 */

export type SettleMember = { user_id: string; joined_at: string };
export type SharedLine = {
  id: string;
  date: string;
  /** Ledger sign: a purchase is negative. */
  amount: number;
  funded_by: string | null;
  split: Record<string, number> | null;
};
export type Settlement = { from_user: string; to_user: string; amount: number };

type Shares = Map<string, number>;

function toCents(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n) * 100 + 1e-7);
}

function equalShares(date: string, members: SettleMember[]): Shares {
  const joined = members.filter((m) => m.joined_at.slice(0, 10) <= date);
  const who = joined.length > 0 ? joined : members;
  return new Map(who.map((m) => [m.user_id, 1 / who.length]));
}

function fundingShares(line: SharedLine, members: SettleMember[]): Shares {
  if (line.funded_by === null) return equalShares(line.date, members);
  return members.some((m) => m.user_id === line.funded_by) ? new Map([[line.funded_by, 1]]) : new Map();
}

function benefitShares(line: SharedLine, members: SettleMember[]): Shares {
  if (line.split) {
    const present = Object.entries(line.split).filter(
      ([id, pct]) => pct > 0 && members.some((m) => m.user_id === id),
    );
    const total = present.reduce((sum, [, pct]) => sum + pct, 0);
    return total > 0 ? new Map(present.map(([id, pct]) => [id, pct / total])) : new Map();
  }
  return fundingShares(line, members);
}

/** Net position in dollars. Positive means the member is owed. */
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
  for (const [id, value] of net) net.set(id, value / 100);
  return net;
}

/** Members whose balance is at least a dollar either way. */
export function nudgeUserIds(net: Map<string, number>, minDollars = 1): string[] {
  return [...net].filter(([, value]) => Math.abs(value) >= minDollars).map(([id]) => id);
}
