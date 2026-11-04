// Pure helpers for transaction alert rules. No React / Supabase imports so
// node --test can run them.

export const FREE_ALERT_LIMIT = 3;

export type TransactionAlert = {
  id: string;
  user_id: string;
  merchant_entity_id: string | null;
  merchant_key: string | null;
  category_id: string | null;
  min_cents: number | null;
  enabled: boolean;
  merchant_label: string | null;
  category_label: string | null;
  created_at: string;
  updated_at: string;
};

export type AlertDraft = {
  merchantEntityId: string | null;
  merchantKey: string | null;
  merchantLabel: string | null;
  categoryId: string | null;
  categoryLabel: string | null;
  /** Dollars the user typed; null = no floor. */
  minDollars: number | null;
  enabled: boolean;
};

/** Premium / trial are unlimited; only the free plan is capped. */
export function alertsUnlimited(plan: string | null | undefined): boolean {
  return !!plan && plan !== 'free';
}

export function atFreeAlertLimit(activeCount: number, plan: string | null | undefined): boolean {
  if (alertsUnlimited(plan)) return false;
  return activeCount >= FREE_ALERT_LIMIT;
}

/** Cents for storage, or null when the user left the amount blank / invalid. */
export function dollarsToMinCents(dollars: number | null | undefined): number | null {
  if (dollars == null || !Number.isFinite(dollars) || dollars <= 0) return null;
  return Math.round(dollars * 100);
}

export function minCentsToDollars(cents: number | null | undefined): number | null {
  if (cents == null || !(cents > 0)) return null;
  return cents / 100;
}

/** Human line for the manage list and the bell's accessibility label. */
export function alertSummary(alert: Pick<
  TransactionAlert,
  'merchant_label' | 'merchant_key' | 'category_label' | 'min_cents'
>): string {
  const parts: string[] = [];
  const merchant = (alert.merchant_label || alert.merchant_key || '').trim();
  if (merchant) parts.push(merchant);
  if (alert.category_label) parts.push(alert.category_label);
  if (alert.min_cents != null && alert.min_cents > 0) {
    parts.push(`≥ ${formatDollars(alert.min_cents / 100)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Any transaction';
}

function formatDollars(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

/**
 * Find an existing rule that already covers this merchant and/or category with
 * the same amount floor, so the sheet can edit instead of insert a duplicate.
 */
export function findMatchingAlert(
  alerts: TransactionAlert[],
  draft: Pick<AlertDraft, 'merchantEntityId' | 'merchantKey' | 'categoryId' | 'minDollars'>,
): TransactionAlert | undefined {
  const minCents = dollarsToMinCents(draft.minDollars);
  return alerts.find((a) => {
    const sameMerchant =
      (draft.merchantEntityId && a.merchant_entity_id === draft.merchantEntityId) ||
      (!draft.merchantEntityId &&
        !!draft.merchantKey &&
        a.merchant_entity_id == null &&
        a.merchant_key === draft.merchantKey) ||
      (!draft.merchantEntityId && !draft.merchantKey && a.merchant_entity_id == null && a.merchant_key == null);
    const sameCategory =
      (draft.categoryId == null && a.category_id == null) ||
      (draft.categoryId != null && a.category_id === draft.categoryId);
    const sameAmount = (a.min_cents ?? null) === minCents;
    return sameMerchant && sameCategory && sameAmount;
  });
}

/**
 * True when any enabled alert targets this merchant (by entity or key) or this
 * category — used to fill the bell on review / detail.
 */
export function hasAlertForTransaction(
  alerts: TransactionAlert[],
  input: { merchantEntityId: string | null; merchantKey: string | null; categoryId: string | null },
): boolean {
  return alerts.some((a) => {
    if (!a.enabled) return false;
    if (a.merchant_entity_id && input.merchantEntityId && a.merchant_entity_id === input.merchantEntityId) {
      return true;
    }
    if (a.merchant_key && input.merchantKey && a.merchant_key === input.merchantKey) return true;
    if (a.category_id && input.categoryId && a.category_id === input.categoryId) return true;
    return false;
  });
}

/** Postgres / PostgREST error that means the free-tier trigger fired. */
export function isPlanLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { message?: string; code?: string; hint?: string };
  return e.code === 'P0001' || (typeof e.message === 'string' && e.message.includes('plan_limit'));
}
