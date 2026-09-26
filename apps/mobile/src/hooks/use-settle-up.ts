import { useMemo } from 'react';

import { isShared, payerLabel } from '@/lib/herd';
import { useHerd, useSettlements, useSharedLines } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { balances, settleTransfers, type Transfer } from '@/lib/settle';

/**
 * Where the herd stands (Phase 11b): everyone's balance, the payments that
 * would square it, and the signed-in member's own position. Loads nothing in a
 * herd of one.
 */
export function useSettleUp() {
  const { session } = useSession();
  const { data: herd } = useHerd();
  const shared = isShared(herd);
  const lines = useSharedLines(shared);
  const settlements = useSettlements(shared);
  const me = session?.user.id ?? null;

  const members = useMemo(() => herd?.members ?? [], [herd]);
  const net = useMemo(
    () => balances(lines.data ?? [], settlements.data ?? [], members),
    [lines.data, settlements.data, members],
  );
  const transfers = useMemo(() => settleTransfers(net), [net]);

  return {
    shared,
    herd,
    me,
    members,
    net,
    transfers,
    /** Positive: you are owed. Negative: you owe. */
    myNet: me ? (net.get(me) ?? 0) : 0,
    /** The payments you are part of. */
    mine: transfers.filter((t) => t.from === me || t.to === me),
    lines: lines.data ?? [],
    settlements: settlements.data ?? [],
    ready: lines.isSuccess && settlements.isSuccess,
    error: lines.error ?? settlements.error,
    name: (userId: string) => payerLabel(userId, members),
  };
}

/** "Kel owes you", "You owe Kel", or "Kel owes Pedro", for one payment. */
export function transferLabel(t: Transfer, me: string | null, name: (id: string) => string): string {
  if (t.to === me) return `${name(t.from)} owes you`;
  if (t.from === me) return `You owe ${name(t.to)}`;
  return `${name(t.from)} owes ${name(t.to)}`;
}
