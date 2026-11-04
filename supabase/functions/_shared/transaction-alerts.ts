/**
 * Pure matching and copy for user-defined transaction alerts. The Edge Function
 * loads rows and visibility; nothing here talks to Postgres or Expo.
 *
 * A rule may target a merchant (prefer merchant_entity_id, fall back to
 * merchant_key), a category, an amount floor (absolute cents), or any
 * combination. Pending rows never match. Dedupe keys pin one push per
 * (rule, transaction) so a re-sync or pending→posted replay cannot double-send.
 */

export type AlertRule = {
  id: string;
  userId: string;
  merchantEntityId: string | null;
  merchantKey: string | null;
  categoryId: string | null;
  minCents: number | null;
  enabled: boolean;
};

export type AlertTx = {
  id: string;
  pending: boolean;
  /** Dollars, signed (negative = outflow). */
  amount: number;
  merchantEntityId: string | null;
  merchantKey: string | null;
  categoryId: string | null;
  merchantLabel: string;
  categoryLabel: string | null;
};

/** True when every dimension the rule sets is satisfied by the transaction. */
export function ruleMatchesTx(rule: AlertRule, tx: AlertTx): boolean {
  if (!rule.enabled || tx.pending) return false;

  const hasMerchant = !!(rule.merchantEntityId || rule.merchantKey);
  const hasCategory = !!rule.categoryId;
  const hasAmount = rule.minCents != null && rule.minCents > 0;
  if (!hasMerchant && !hasCategory && !hasAmount) return false;

  if (hasMerchant && !merchantMatches(rule, tx)) return false;
  if (hasCategory && tx.categoryId !== rule.categoryId) return false;
  if (hasAmount) {
    const cents = Math.round(Math.abs(tx.amount) * 100);
    if (cents < (rule.minCents as number)) return false;
  }
  return true;
}

/**
 * Prefer entity id when both sides have one. If the transaction has no entity
 * id yet, fall back to the normalized merchant_key the rule stored.
 */
function merchantMatches(rule: AlertRule, tx: AlertTx): boolean {
  if (rule.merchantEntityId) {
    if (tx.merchantEntityId) return tx.merchantEntityId === rule.merchantEntityId;
    return !!rule.merchantKey && !!tx.merchantKey && rule.merchantKey === tx.merchantKey;
  }
  return !!rule.merchantKey && !!tx.merchantKey && rule.merchantKey === tx.merchantKey;
}

/** Stable log key: one push per rule per transaction, forever. */
export function alertDedupeKey(ruleId: string, transactionId: string): string {
  return `tx_alert:${ruleId}:${transactionId}`;
}

export function alertCopy(rule: AlertRule, tx: AlertTx): { title: string; body: string } {
  const amount = formatAbs(tx.amount);
  const merchant = tx.merchantLabel.trim() || 'A purchase';
  const parts: string[] = [];
  if (rule.merchantEntityId || rule.merchantKey) parts.push(merchant);
  if (rule.categoryId && tx.categoryLabel) parts.push(tx.categoryLabel);
  if (rule.minCents != null) parts.push(`≥ ${formatCents(rule.minCents)}`);
  const why = parts.length > 0 ? parts.join(' · ') : merchant;
  return {
    title: 'Transaction alert',
    body: `${why} · ${amount}`,
  };
}

/**
 * Pick the outbound alerts for one transaction against one user's rules.
 * Caller already filtered visibility (own + shared non-private).
 */
export function matchesForUser(rules: AlertRule[], tx: AlertTx, userId: string): AlertRule[] {
  return rules.filter((rule) => rule.userId === userId && ruleMatchesTx(rule, tx));
}

function formatAbs(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(amount));
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

/** Free tier may keep this many enabled alerts. */
export const FREE_ALERT_LIMIT = 3;

export function alertsUnlimited(plan: string | null | undefined): boolean {
  return !!plan && plan !== 'free';
}

export function atFreeAlertLimit(activeCount: number, plan: string | null | undefined): boolean {
  if (alertsUnlimited(plan)) return false;
  return activeCount >= FREE_ALERT_LIMIT;
}
