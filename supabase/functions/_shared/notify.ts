/**
 * Push notification decisions (pure). Edge Functions load rows and call these;
 * nothing here talks to Expo or Postgres.
 *
 * Quiet hours defer non-urgent pushes until the window ends. Urgent ones
 * (a bank that needs reconnecting, a billing problem) still go out, without a
 * sound. Reconnect and a consent that's about to expire are not a preference:
 * they always send. Amounts from an account the recipient cannot see are never
 * put in a payload — the caller drops the push instead.
 */

export const NOTIFY_TYPES = [
  'question_asked',
  'question_answered',
  'review_digest',
  'herd_joined',
  'settle_nudge',
  'budget_alert',
  'weekly_recap',
  'large_transaction',
  'upcoming_bill',
  'price_change',
  'reconnect',
  'pending_expiration',
  'trial_ending',
  'billing_issue',
] as const;
export type NotifyType = (typeof NOTIFY_TYPES)[number];

export type Channel = 'default' | 'digest' | 'alerts' | 'silent';

/** Matches notification_prefs defaults. Timezone null means "not known yet". */
export type Prefs = {
  timezone: string | null;
  question_asked: boolean;
  question_answered: boolean;
  review_digest: boolean;
  review_threshold: number;
  review_hour: number;
  herd_joined: boolean;
  settle_nudge: boolean;
  budget_80: boolean;
  budget_100: boolean;
  weekly_recap: boolean;
  large_transaction: boolean;
  large_cents: number;
  upcoming_bill: boolean;
  price_change: boolean;
  trial_ending: boolean;
  billing_issue: boolean;
  quiet_start: number;
  quiet_end: number;
  hide_amounts: boolean;
};

export const DEFAULT_PREFS: Prefs = {
  timezone: null,
  question_asked: true,
  question_answered: true,
  review_digest: true,
  review_threshold: 10,
  review_hour: 19,
  herd_joined: true,
  settle_nudge: false,
  budget_80: false,
  budget_100: true,
  weekly_recap: true,
  large_transaction: false,
  large_cents: 50_000,
  upcoming_bill: false,
  price_change: true,
  trial_ending: true,
  billing_issue: true,
  quiet_start: 22,
  quiet_end: 8,
  hide_amounts: false,
};

/** Local hour the weekly recap goes out (Sunday). */
export const RECAP_HOUR = 18;
/** Local hour of the settle-up nudge (Sunday). */
export const SETTLE_HOUR = 17;
/** Local hour for bills, trial reminders, and the reconnect reminder. */
export const MORNING_HOUR = 9;
/** Days before a trial ends that we push. Matches the plan banner's window, but only these two mornings. */
export const TRIAL_DAYS = [3, 1] as const;
/** How long a dropped plan has before banks are archived. Matches enforce.ts CHOOSE_DAYS. */
export const CHOOSE_DAYS = 7;
const ASK_WINDOW_MS = 10 * 60 * 1000;
const DAY_MS = 86_400_000;

const ALWAYS_ON = new Set<NotifyType>(['reconnect', 'pending_expiration']);

export function prefsFrom(row: Partial<Prefs> | null | undefined): Prefs {
  if (!row) return { ...DEFAULT_PREFS };
  const threshold = row.review_threshold;
  return {
    ...DEFAULT_PREFS,
    ...row,
    timezone: row.timezone ?? null,
    review_threshold: threshold === 5 || threshold === 10 || threshold === 20 ? threshold : DEFAULT_PREFS.review_threshold,
    large_cents: typeof row.large_cents === 'number' && row.large_cents > 0 ? row.large_cents : DEFAULT_PREFS.large_cents,
  };
}

export function typeEnabled(prefs: Prefs, type: NotifyType): boolean {
  if (ALWAYS_ON.has(type)) return true;
  switch (type) {
    case 'question_asked':
      return prefs.question_asked;
    case 'question_answered':
      return prefs.question_answered;
    case 'review_digest':
      return prefs.review_digest;
    case 'herd_joined':
      return prefs.herd_joined;
    case 'settle_nudge':
      return prefs.settle_nudge;
    case 'budget_alert':
      return prefs.budget_80 || prefs.budget_100;
    case 'weekly_recap':
      return prefs.weekly_recap;
    case 'large_transaction':
      return prefs.large_transaction;
    case 'upcoming_bill':
      return prefs.upcoming_bill;
    case 'price_change':
      return prefs.price_change;
    case 'trial_ending':
      return prefs.trial_ending;
    case 'billing_issue':
      return prefs.billing_issue;
    default:
      return false;
  }
}

/** True when `hour` sits in [start, end), wrapping past midnight. Equal ends means quiet hours are off. */
export function inQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function localParts(now: Date, timeZone: string): { hour: number; weekday: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(now)) bag[part.type] = part.value;
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    hour,
    weekday: WEEKDAY[bag.weekday] ?? 0,
    ymd: `${bag.year}-${bag.month}-${bag.day}`,
  };
}

/** The first instant, up to a day out, whose local hour is outside quiet hours. */
export function quietEndsAt(now: Date, timeZone: string, start: number, end: number): Date {
  for (let step = 1; step <= 24; step++) {
    const at = new Date(now.getTime() + step * 60 * 60 * 1000);
    if (!inQuietHours(localParts(at, timeZone).hour, start, end)) return at;
  }
  return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

/** "$1,234.56". Negative amounts keep the sign; spending copy passes the absolute value. */
export function formatMoney(amount: number): string {
  const negative = amount < 0;
  const cents = Math.round(Math.abs(amount) * 100);
  const dollars = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, '0');
  const withCommas = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}$${withCommas}.${frac}`;
}

/** Lock-screen privacy: dollar amounts become an ellipsis. Merchants stay. */
export function redactAmounts(text: string): string {
  return text.replace(/-?\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g, '…');
}

export type DeliveryPlan =
  | { action: 'skip'; reason: 'disabled' | 'duplicate' }
  | { action: 'defer'; deliverAfter: string }
  | { action: 'send'; title: string; body: string; sound: boolean };

/**
 * Whether this push goes out, waits for quiet hours to end, or is dropped.
 * `duplicate` is a notification_log row for the same user and dedupe key.
 * The returned title and body are what the lock screen may show.
 */
export function planDelivery(input: {
  type: NotifyType;
  prefs: Prefs;
  now: Date;
  duplicate: boolean;
  urgent: boolean;
  sound: boolean;
  title: string;
  body: string;
}): DeliveryPlan {
  if (!typeEnabled(input.prefs, input.type)) return { action: 'skip', reason: 'disabled' };
  if (input.duplicate) return { action: 'skip', reason: 'duplicate' };
  const zone = input.prefs.timezone;
  const hour = zone ? localParts(input.now, zone).hour : null;
  const quiet = hour !== null && inQuietHours(hour, input.prefs.quiet_start, input.prefs.quiet_end);
  if (quiet && !input.urgent) {
    return { action: 'defer', deliverAfter: quietEndsAt(input.now, zone!, input.prefs.quiet_start, input.prefs.quiet_end).toISOString() };
  }
  const hide = input.prefs.hide_amounts;
  const sound = input.sound && !(quiet && input.urgent);
  return {
    action: 'send',
    title: hide ? redactAmounts(input.title) : input.title,
    body: hide ? redactAmounts(input.body) : input.body,
    sound,
  };
}

/** One ask per asker per 10 minutes. A later ask in the window is the same key, so it collapses. */
export function askCollapseKey(askerId: string, now: Date): string {
  return `qask:${askerId}:${Math.floor(now.getTime() / ASK_WINDOW_MS)}`;
}

export function canSeeAccount(viewerId: string, account: { isPrivate: boolean; connectorId: string }): boolean {
  return !account.isPrivate || account.connectorId === viewerId;
}

export function questionAskedCopy(input: {
  askerName: string;
  askerId: string;
  merchant: string | null;
  amount: number | null;
  body: string | null;
  transactionId: string;
  now: Date;
  canSee: boolean;
}): { title: string; body: string; url: string; dedupeKey: string } | null {
  if (!input.canSee) return null;
  const merchant = input.merchant?.trim() || 'A purchase';
  const amount = input.amount === null ? '' : ` (${formatMoney(Math.abs(input.amount))})`;
  const note = input.body?.trim() ? ` — ${input.body.trim()}` : '';
  return {
    title: `${input.askerName} asked about a transaction`,
    body: `${merchant}${amount}${note}`.slice(0, 180),
    url: `/transaction/${input.transactionId}`,
    dedupeKey: askCollapseKey(input.askerId, input.now),
  };
}

export function questionAnsweredCopy(input: {
  answererName: string;
  merchant: string | null;
  transactionId: string;
  questionId: string;
  canSee: boolean;
}): { title: string; body: string; url: string; dedupeKey: string } | null {
  if (!input.canSee) return null;
  const merchant = input.merchant?.trim() || 'a purchase';
  return {
    title: 'Your question was answered',
    body: `${input.answererName} answered your question about ${merchant}.`,
    url: `/transaction/${input.transactionId}`,
    dedupeKey: `qans:${input.questionId}`,
  };
}

export function digestDue(input: {
  enabled: boolean;
  localHour: number;
  reviewHour: number;
  count: number;
  threshold: number;
  newSinceLast: number;
  sentToday: boolean;
}): boolean {
  return input.enabled
    && input.localHour === input.reviewHour
    && !input.sentToday
    && input.count >= input.threshold
    && input.newSinceLast > 0;
}

export function digestBody(count: number, flags: { priority: boolean; split: boolean }): string {
  const waiting = count === 1 ? '1 transaction is waiting for review' : `${count} transactions are waiting for review`;
  if (flags.priority && flags.split) return `${waiting}, including some worth a second look and one you may want to split.`;
  if (flags.split) return `${waiting}, including one you may want to split.`;
  if (flags.priority) return `${waiting}, including some worth a second look.`;
  return `${waiting}.`;
}

/** 100 when spending has reached the budget, 80 when it has reached 80%, else none. */
export function budgetLevel(spent: number, budget: number): 80 | 100 | null {
  if (!(budget > 0) || !(spent >= 0)) return null;
  if (spent >= budget) return 100;
  if (spent >= budget * 0.8) return 80;
  return null;
}

/**
 * The single level to push. Crossing straight to 100 sends 100 when that alert
 * is on, and does not also send the 80% one. 80% sends only when it is on and
 * spending is in that band, or when 100% is off and spending is already over.
 */
export function budgetLevelToSend(
  level: 80 | 100 | null,
  prefs: Pick<Prefs, 'budget_80' | 'budget_100'>,
  sent: ReadonlySet<80 | 100>,
): 80 | 100 | null {
  if (level === null) return null;
  if (level === 100 && prefs.budget_100 && !sent.has(100)) return 100;
  if (prefs.budget_80 && !sent.has(80) && (level === 80 || !prefs.budget_100)) return 80;
  return null;
}

export type SpendLine = {
  categoryId: string;
  parentId: string | null;
  name: string;
  connectorId: string;
  isPrivate: boolean;
  spent: number;
};

/**
 * Rows a viewer may be told about. Pass null to keep shared accounts only
 * (one number that is safe to send every herd member). A user id also keeps
 * that person's own private accounts.
 */
export function visibleSpend(rows: SpendLine[], viewerId: string | null): SpendLine[] {
  return rows.filter((row) => !row.isPrivate || (viewerId !== null && row.connectorId === viewerId));
}

/**
 * What a budget's bar measures. A group budget (no parent) is its own rows
 * plus its children's. A category budget is only its own. Matches Budgets.
 */
export function spentAgainstBudget(
  budget: { categoryId: string; parentId: string | null },
  rows: SpendLine[],
): number {
  let total = 0;
  for (const row of rows) {
    const counts = budget.parentId
      ? row.categoryId === budget.categoryId
      : row.categoryId === budget.categoryId || row.parentId === budget.categoryId;
    if (counts) total += row.spent;
  }
  return total;
}

/** How many expense budgets are still under their cap. */
export function budgetsOnTrack(
  budgets: { categoryId: string; parentId: string | null; amount: number; kind: string | null }[],
  rows: SpendLine[],
): { onTrack: number; total: number } {
  const expense = budgets.filter((budget) => !budget.kind || budget.kind === 'expense');
  let onTrack = 0;
  for (const budget of expense) {
    if (spentAgainstBudget(budget, rows) < budget.amount) onTrack++;
  }
  return { onTrack, total: expense.length };
}

/** Total spent and the three category names that took the most. */
export function recapFromSpend(rows: SpendLine[]): { spent: number; top: string[] } {
  const byName = new Map<string, number>();
  let spent = 0;
  for (const row of rows) {
    spent += row.spent;
    const name = row.name.trim() || 'Other';
    byName.set(name, (byName.get(name) ?? 0) + row.spent);
  }
  const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
  return { spent, top };
}

export function budgetCopy(category: string, level: 80 | 100, spent: number, budget: number): { title: string; body: string } {
  if (level === 100) {
    return {
      title: `${category} is at its budget`,
      body: `${formatMoney(spent)} spent of ${formatMoney(budget)} this month.`,
    };
  }
  return {
    title: `${category} is at 80% of its budget`,
    body: `${formatMoney(spent)} spent of ${formatMoney(budget)} this month.`,
  };
}

/** Posted money out, above the threshold, and not a transfer or a card payment. */
export function isLargeOutflow(input: {
  amount: number;
  pending: boolean;
  kind: string | null;
  slug: string | null;
  thresholdCents: number;
}): boolean {
  if (input.pending || !(input.amount < 0)) return false;
  if (input.kind === 'transfer' || input.slug === 'credit_card_payment') return false;
  return Math.round(-input.amount * 100) >= input.thresholdCents;
}

export function largeCopy(merchant: string, amount: number): { title: string; body: string } {
  return {
    title: 'Large purchase',
    body: `${merchant} · ${formatMoney(Math.abs(amount))}`,
  };
}

export type StreamPrice = {
  id: string;
  amount_change: number | null;
  name?: string;
  last_amount?: number;
  account_id?: string;
  dismissed?: boolean;
};

/** Streams whose price-change figure is new or different since the last sync. */
export function changedPrices(before: { id: string; amount_change: number | null }[], after: StreamPrice[]): StreamPrice[] {
  const prev = new Map(before.map((row) => [row.id, row.amount_change === null ? null : Number(row.amount_change)]));
  return after.filter((row) => {
    if (row.dismissed) return false;
    if (row.amount_change === null) return false;
    const next = Number(row.amount_change);
    if (!Number.isFinite(next) || next === 0) return false;
    return prev.get(row.id) !== next;
  });
}

export function priceCopy(name: string, change: number, last: number): { title: string; body: string } {
  const direction = change > 0 ? 'went up' : 'went down';
  return {
    title: `${name} ${direction}`,
    body: `It's now ${formatMoney(Math.abs(last))}, ${formatMoney(Math.abs(change))} ${change > 0 ? 'more' : 'less'} than last time.`,
  };
}

export function billCopy(name: string, amount: number): { title: string; body: string } {
  return {
    title: `${name} is due tomorrow`,
    body: `${formatMoney(Math.abs(amount))} comes out tomorrow.`,
  };
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export function recapCopy(input: { spent: number; top: string[]; onTrack: number; budgets: number }): { title: string; body: string } | null {
  if (!(input.spent > 0)) return null;
  const top = input.top.filter(Boolean).slice(0, 3);
  const where = top.length > 0 ? ` Most went to ${joinAnd(top)}.` : '';
  const budgets = input.budgets > 0 ? ` ${input.onTrack} of ${input.budgets} budgets are on track.` : '';
  return {
    title: 'Your week in Tusky',
    body: `You spent ${formatMoney(input.spent)} this week.${where}${budgets}`,
  };
}

export function settleCopy(balance: number): { title: string; body: string } {
  if (balance > 0) {
    return { title: 'Settle up', body: `You're owed ${formatMoney(balance)}. A minute in Settle up squares it.` };
  }
  return { title: 'Settle up', body: `You owe ${formatMoney(Math.abs(balance))}. A minute in Settle up squares it.` };
}

/** Whole days until expiry, rounded up the same way as the plan banner. 3 and 1 are the push days. */
export function trialPushDay(expiresAt: string, now: Date): 3 | 1 | null {
  const left = Math.ceil((Date.parse(expiresAt) - now.getTime()) / DAY_MS);
  return left === 3 || left === 1 ? left : null;
}

export function trialCopy(days: number): { title: string; body: string } {
  const word = days === 1 ? '1 day' : `${days} days`;
  return {
    title: `Your trial ends in ${word}`,
    body: 'After that, Tusky disconnects your banks. Everything you have tracked stays here.',
  };
}

export function daysRemaining(sinceIso: string, now: Date, windowDays = CHOOSE_DAYS): number {
  const left = Math.ceil((Date.parse(sinceIso) + windowDays * DAY_MS - now.getTime()) / DAY_MS);
  return Math.max(1, left);
}

export function overLimitCopy(maxBanks: number, banksUsed: number, daysLeft: number): { title: string; body: string } {
  const banks = maxBanks === 1 ? '1 bank' : `${maxBanks} banks`;
  const left = daysLeft === 1 ? '1 day' : `${daysLeft} days`;
  return {
    title: `Your plan connects up to ${banks}`,
    body: `You have ${banksUsed}. Disconnect ${banksUsed - maxBanks} in Settings within ${left}, or Tusky disconnects the most recently added.`,
  };
}

export function graceCopy(): { title: string; body: string } {
  return {
    title: "There's a problem with your payment",
    body: 'Update your payment method to keep your plan. Your banks stay connected while the store retries the charge.',
  };
}

export function reconnectCopy(institution: string): { title: string; body: string } {
  return {
    title: `Reconnect ${institution}`,
    body: 'Your bank needs you to sign in again. Until you do, new transactions will not arrive.',
  };
}

export function reconnectReminderCopy(institution: string): { title: string; body: string } {
  return {
    title: `${institution} is still disconnected`,
    body: 'It has been a few days. Reconnect it in Settings so Tusky can keep reading new transactions.',
  };
}

export function pendingExpirationCopy(institution: string): { title: string; body: string } {
  return {
    title: `${institution} needs a refresh soon`,
    body: 'Your bank connection is close to expiring. Reconnect it in Settings to keep it syncing.',
  };
}

export function herdJoinedCopy(name: string): { title: string; body: string } {
  return {
    title: `${name} joined your herd`,
    body: 'You can see shared accounts together. Their private accounts stay private.',
  };
}

/** Calendar date plus whole days, on the date itself (no timezone shift). */
export function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export type ExpoTicket = { status?: string; details?: { error?: string } };

/** Tokens Expo says are dead. Anything else (a bad key, a 500) keeps the token. */
export function tokensToDrop(tokens: string[], tickets: ExpoTicket[]): string[] {
  const drop: string[] = [];
  tickets.forEach((ticket, index) => {
    if (ticket?.details?.error === 'DeviceNotRegistered' && tokens[index]) drop.push(tokens[index]);
  });
  return drop;
}
