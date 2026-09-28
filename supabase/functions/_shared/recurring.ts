/**
 * Recurring detection: which merchants come back on a schedule.
 *
 * Pure on purpose — posted transactions in, stream rows out — so every rule
 * below is pinned by recurring.test.ts. refreshRecurring (Task 3) does the I/O.
 * Our own heuristics rather than Plaid's /transactions/recurring/get, which is
 * a separate per-Item monthly fee and wants 180+ days of history; see the
 * Phase 5 spec.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { JEV_CONCURRENCY, JEV_PASS_BUDGET_MS, type JevAsk, type JevQuestion, mapLimit, readNoul } from './jev.ts';

export type Cadence = 'weekly' | 'biweekly' | 'monthly';
export type Direction = 'outflow' | 'inflow';

/** One posted transaction, as refreshRecurring selects it. */
export type DetectInput = {
  account_id: string;
  /** 'YYYY-MM-DD' */
  date: string;
  /** Ledger sign, as in transactions.amount: negative = money out. */
  amount: number;
  name: string;
  merchant_name: string | null;
  category_id: string | null;
};

export type StreamRow = {
  account_id: string;
  merchant_key: string;
  direction: Direction;
  name: string;
  category_id: string | null;
  frequency: Cadence;
  average_amount: number;
  last_amount: number;
  previous_amount: number;
  /** |last| − |previous|, set only when a fixed price moved. */
  amount_change: number | null;
  first_date: string;
  last_date: string;
  next_date: string;
  occurrences: number;
};

export type ExistingStream = {
  id: string;
  account_id: string;
  direction: Direction;
  merchant_key: string;
  dismissed: boolean;
};

export const MIN_OCCURRENCES = 3;

/** Interval window per cadence, and how far an amount may sit from the run's median. */
export const CADENCES: Record<Cadence, { minDays: number; maxDays: number; tolerance: number }> = {
  weekly: { minDays: 5, maxDays: 9, tolerance: 0.2 },
  biweekly: { minDays: 11, maxDays: 17, tolerance: 0.2 },
  monthly: { minDays: 25, maxDays: 35, tolerance: 0.35 },
};

/**
 * A monthly prediction lands no sooner than this after the last charge. It is
 * what makes a Sep-1 bill paid early on Aug 30 predict Oct 1 rather than Sep 1.
 */
const MONTHLY_MIN_GAP_DAYS = 20;
const PRICE_CHANGE_MIN = 1;
const PRICE_CHANGE_PCT = 0.05;

/**
 * How far past the amount tolerance a regular run may stray and still be
 * worth asking Jev about (12d). Twice the tolerance: a bill whose amount
 * varies, not a shop visited on a whim.
 */
export const NEAR_MISS_FACTOR = 2;
/** Near misses sent to Jev per Item per sync. The rest are kept, not asked. */
export const RECURRING_ASK_MAX = 20;
/** Jev's `is_recurring` at or above this tips a near miss in. */
export const RECURRING_YES_AT = 0.5;

const DAY_MS = 86_400_000;

/** Days since the epoch, in UTC. Calendar dates only — no timezone enters. */
function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function isoFromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Lowercase letters only: store numbers, dates and punctuation drop out. */
export function normalizeMerchant(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

function cadenceFor(gapDays: number): Cadence | null {
  for (const cadence of Object.keys(CADENCES) as Cadence[]) {
    const { minDays, maxDays } = CADENCES[cadence];
    if (gapDays >= minDays && gapDays <= maxDays) return cadence;
  }
  return null;
}

/** Distance between two days of the month on a 31-day circle: the 30th and the 1st are 2 apart. */
function circularDayDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 31 - d);
}

/**
 * The run's anchor day: the day it actually paid on that sits closest to all
 * the others, measured around the month. A plain median breaks when payments
 * straddle a month boundary — [30, 1, 31, 1] has median 15.5. Ties go to the
 * day paid most often, then to the one nearest the latest payment.
 */
function anchorDay(days: number[]): number {
  const latest = days[days.length - 1];
  const score = (c: number) => days.reduce((sum, d) => sum + circularDayDistance(c, d), 0);
  const count = (c: number) => days.filter((d) => d === c).length;
  return [...new Set(days)].sort((a, b) =>
    score(a) - score(b) ||
    count(b) - count(a) ||
    circularDayDistance(a, latest) - circularDayDistance(b, latest)
  )[0];
}

function withinTolerance(amount: number, center: number, tolerance: number): boolean {
  return Math.abs(Math.abs(amount) - Math.abs(center)) <= tolerance * Math.abs(center);
}

/** The anchor day in the first month on or after last + MONTHLY_MIN_GAP_DAYS, clamped to month end. */
function nextMonthlyDate(lastDate: string, anchor: number): string {
  const earliest = dayNumber(lastDate) + MONTHLY_MIN_GAP_DAYS;
  const start = new Date(earliest * DAY_MS);
  let year = start.getUTCFullYear();
  let month0 = start.getUTCMonth();
  for (;;) {
    const candidate = Date.UTC(year, month0, Math.min(anchor, daysInMonth(year, month0))) / DAY_MS;
    if (candidate >= earliest) return isoFromDay(candidate);
    month0 += 1;
    if (month0 === 12) {
      month0 = 0;
      year += 1;
    }
  }
}

type Occurrence = { date: string; day: number; amount: number; source: DetectInput };
type Detected = Omit<StreamRow, 'account_id' | 'merchant_key' | 'direction'>;

/**
 * One merchant's occurrences, oldest first → a stream it is sure of, a near
 * miss, or null. A near miss (12d) has a regular cadence and enough payments,
 * but amounts that stray past the tolerance while staying within
 * NEAR_MISS_FACTOR times it. The heuristic cannot tell a variable bill from a
 * shop visited on a schedule, so Jev is asked instead.
 */
function classifyGroup(occ: Occurrence[]): { detected: Detected; sure: boolean } | null {
  const n = occ.length;
  if (n < MIN_OCCURRENCES) return null;

  // The newest interval picks the cadence; walk back while intervals fit it.
  const cadence = cadenceFor(occ[n - 1].day - occ[n - 2].day);
  if (!cadence) return null;
  const { minDays, maxDays, tolerance } = CADENCES[cadence];
  let start = n - 1;
  while (start > 0) {
    const gap = occ[start].day - occ[start - 1].day;
    if (gap < minDays || gap > maxDays) break;
    start--;
  }
  const run = occ.slice(start);

  // Drop leading amount outliers — a prorated first charge.
  while (
    run.length > MIN_OCCURRENCES &&
    !withinTolerance(run[0].amount, median(run.slice(1).map((o) => o.amount)), tolerance)
  ) {
    run.shift();
  }
  if (run.length < MIN_OCCURRENCES) return null;

  const amounts = run.map((o) => o.amount);
  const center = median(amounts);
  const within = (factor: number) => amounts.every((a) => withinTolerance(a, center, tolerance * factor));
  if (!within(NEAR_MISS_FACTOR)) return null;
  const sure = within(1);

  const last = run[run.length - 1];
  const previous = run[run.length - 2];

  // Flag only a FIXED price that moved, so variable utilities never flag.
  const earlier = amounts.slice(0, -1);
  const fixed = earlier.every((a) => Math.round(a * 100) === Math.round(earlier[0] * 100));
  const delta = round2(Math.abs(last.amount) - Math.abs(previous.amount));
  const moved = Math.abs(delta) >= Math.max(PRICE_CHANGE_MIN, PRICE_CHANGE_PCT * Math.abs(previous.amount));

  const next_date = cadence === 'monthly'
    ? nextMonthlyDate(last.date, anchorDay(run.map((o) => Number(o.date.slice(8, 10)))))
    : isoFromDay(last.day + (cadence === 'weekly' ? 7 : 14));

  return {
    sure,
    detected: {
      name: last.source.merchant_name ?? last.source.name,
      category_id: last.source.category_id,
      frequency: cadence,
      average_amount: round2(amounts.reduce((sum, a) => sum + a, 0) / amounts.length),
      last_amount: round2(last.amount),
      previous_amount: round2(previous.amount),
      amount_change: fixed && moved ? delta : null,
      first_date: run[0].date,
      last_date: last.date,
      next_date,
      occurrences: run.length,
    },
  };
}

/** A stream's identity, as the upsert's conflict target and Jev's verdicts see it. */
export const streamKey = (s: { account_id: string; direction: Direction; merchant_key: string }) =>
  `${s.account_id}|${s.direction}|${s.merchant_key}`;

/**
 * The categories detection ignores: every transfer — money moving between
 * your own accounts is not a bill — except Credit Card Payment, which is a
 * transfer for spending purposes but still a recurring bill with a due date.
 */
export function ignoredCategoryIds(categories: { id: string; kind: string; slug: string | null }[]): string[] {
  return categories.filter((c) => c.kind === 'transfer' && c.slug !== 'credit_card_payment').map((c) => c.id);
}

const byStreamKey = (a: StreamRow, b: StreamRow) =>
  streamKey(a) < streamKey(b) ? -1 : streamKey(a) > streamKey(b) ? 1 : 0;

/**
 * Posted transactions → the streams detection is sure of, and the near misses
 * Jev may tip in (12d). One per (account, direction, merchant). Transfer-kind
 * categories are excluded by OUR category_id, so a manual recategorization to
 * Transfer takes a stream out at the next sync.
 */
export function detectCandidates(
  rows: DetectInput[],
  opts: { transferCategoryIds: string[] },
): { streams: StreamRow[]; nearMisses: StreamRow[] } {
  const transfers = new Set(opts.transferCategoryIds);
  const groups = new Map<
    string,
    { account_id: string; merchant_key: string; direction: Direction; byDate: Map<string, Occurrence> }
  >();

  for (const r of rows) {
    if (r.amount === 0) continue;
    if (r.category_id && transfers.has(r.category_id)) continue;
    const merchant_key = normalizeMerchant(r.merchant_name ?? r.name);
    if (!merchant_key) continue;
    const direction: Direction = r.amount < 0 ? 'outflow' : 'inflow';
    const key = streamKey({ account_id: r.account_id, direction, merchant_key });

    let group = groups.get(key);
    if (!group) {
      group = { account_id: r.account_id, merchant_key, direction, byDate: new Map() };
      groups.set(key, group);
    }
    // Same-day charges at one merchant are one payment.
    const sameDay = group.byDate.get(r.date);
    if (sameDay) {
      sameDay.amount = round2(sameDay.amount + r.amount);
      sameDay.source = r;
    } else {
      group.byDate.set(r.date, { date: r.date, day: dayNumber(r.date), amount: r.amount, source: r });
    }
  }

  const streams: StreamRow[] = [];
  const nearMisses: StreamRow[] = [];
  for (const g of groups.values()) {
    const found = classifyGroup([...g.byDate.values()].sort((a, b) => a.day - b.day));
    if (!found) continue;
    const row = { account_id: g.account_id, merchant_key: g.merchant_key, direction: g.direction, ...found.detected };
    (found.sure ? streams : nearMisses).push(row);
  }
  return { streams: streams.sort(byStreamKey), nearMisses: nearMisses.sort(byStreamKey) };
}

/** The streams detection is sure of: what every sync stored before 12d, and still does with Jev off. */
export function detectStreams(rows: DetectInput[], opts: { transferCategoryIds: string[] }): StreamRow[] {
  return detectCandidates(rows, opts).streams;
}

/** Jev's verdict per streamKey. A missing key means "could not judge". */
export type RecurringDecide = (candidates: StreamRow[]) => Promise<Map<string, boolean>>;

/**
 * Fold Jev's verdicts on the near misses into the sure streams (12d). A near
 * miss Jev calls recurring joins them, and one it rejects is left out (and
 * deleted if it was stored). One it could not judge (cap reached, call failed)
 * is returned in `keep`: neither added nor deleted, so a flaky call never makes
 * a stream flicker. Without `decide` (Jev off) the heuristic alone stands,
 * exactly as before 12d.
 */
export async function settleNearMisses(
  sure: StreamRow[],
  nearMisses: StreamRow[],
  decide?: RecurringDecide,
): Promise<{ streams: StreamRow[]; keep: StreamRow[] }> {
  if (!decide || nearMisses.length === 0) return { streams: sure, keep: [] };
  let verdicts = new Map<string, boolean>();
  try {
    verdicts = await decide(nearMisses.slice(0, RECURRING_ASK_MAX));
  } catch (err) {
    console.warn(`recurring tiebreak skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
  return {
    streams: [...sure, ...nearMisses.filter((s) => verdicts.get(streamKey(s)) === true)],
    keep: nearMisses.filter((s) => !verdicts.has(streamKey(s))),
  };
}

/** The one question per near miss. */
export function recurringQuestions(): Record<string, JevQuestion> {
  return {
    is_recurring: {
      type: 'noul',
      instructions:
        'Are these transactions a recurring bill or subscription, rather than repeat purchases that happen to be regular?',
      criteria: {
        true: 'A bill, subscription, membership, rent, loan or insurance payment, or a regular paycheck',
        false: 'Everyday purchases at a shop or restaurant the user happens to visit often',
      },
    },
  };
}

/** What Jev sees about one near miss: the pattern, never the account. */
export function recurringState(s: StreamRow, categoryName: string | null) {
  return {
    merchant: s.name,
    cadence: s.frequency,
    occurrences: s.occurrences,
    amounts: {
      average: Math.abs(s.average_amount),
      previous: Math.abs(s.previous_amount),
      last: Math.abs(s.last_amount),
    },
    direction: s.direction === 'inflow' ? 'money in' : 'money out',
    category: categoryName ?? 'Uncategorized',
    first_date: s.first_date,
    last_date: s.last_date,
  };
}

/**
 * The RecurringDecide that sync uses: one Noul per near miss, bounded like
 * every Jev pass. A call that fails or answers unreadably has no verdict, so
 * settleNearMisses keeps that stream as it was.
 */
export function jevRecurringDecide(ask: JevAsk, categoryNames: Map<string, string>): RecurringDecide {
  return async (candidates) => {
    const deadline = Date.now() + JEV_PASS_BUDGET_MS;
    const questions = recurringQuestions();
    const settled = await mapLimit(candidates, JEV_CONCURRENCY, async (s) => {
      const name = s.category_id ? categoryNames.get(s.category_id) ?? null : null;
      const yes = readNoul((await ask(recurringState(s, name), questions, { deadline })).answers.is_recurring);
      if (yes === null) throw new Error('jev: unreadable is_recurring');
      return yes >= RECURRING_YES_AT;
    }, deadline);
    const verdicts = new Map<string, boolean>();
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') verdicts.set(streamKey(candidates[i]), s.value);
    });
    return verdicts;
  };
}

/**
 * Existing streams that detection no longer finds. Dismissed rows are never
 * returned: `dismissed` is the user's verdict, and keeping the row is what
 * lets it survive the stream re-qualifying later.
 */
export function staleStreamIds(
  existing: ExistingStream[],
  fresh: Pick<StreamRow, 'account_id' | 'direction' | 'merchant_key'>[],
): string[] {
  const keep = new Set(fresh.map(streamKey));
  return existing.filter((s) => !s.dismissed && !keep.has(streamKey(s))).map((s) => s.id);
}

/** How far back detection looks. Enough for six monthly occurrences. */
const LOOKBACK_DAYS = 180;
/** PostgREST's max_rows. A longer page would be truncated SILENTLY. */
const PAGE_SIZE = 1000;

/**
 * Detect and store one Item's streams. Throws on any database error — the
 * caller (syncItem) swallows it so a failed radar never fails a sync.
 *
 * Runs under syncItem's per-Item claim, and streams are per account, so no
 * other invocation can be writing these rows.
 */
export async function refreshRecurring(
  admin: SupabaseClient,
  item: { id: string; user_id: string },
  transferCategoryIds: string[],
  /** Jev's tiebreak for near misses (12d); absent when Jev is off. */
  decide?: RecurringDecide,
): Promise<void> {
  const since = isoFromDay(Math.floor(Date.now() / DAY_MS) - LOOKBACK_DAYS);

  const rows: DetectInput[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await admin
      .from('transactions')
      .select('account_id, date, amount, name, merchant_name, category_id')
      .eq('item_id', item.id)
      .eq('pending', false)
      .gte('date', since)
      .order('date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page.map((r) => ({ ...r, amount: Number(r.amount) })));
    if (page.length < PAGE_SIZE) break;
  }

  const { streams: sure, nearMisses } = detectCandidates(rows, { transferCategoryIds });
  const { streams, keep } = await settleNearMisses(sure, nearMisses, decide);

  if (streams.length > 0) {
    // `dismissed` is deliberately absent: DO UPDATE SET covers only the keys
    // present, so the user's verdict survives. Every other key is always
    // present, amount_change: null included — ragged keys are PGRST102.
    const { error } = await admin
      .from('recurring_streams')
      .upsert(streams.map((s) => ({ ...s, user_id: item.user_id })), {
        onConflict: 'account_id,direction,merchant_key',
      });
    if (error) throw error;
  }

  const { data: accounts, error: accountsError } = await admin
    .from('accounts').select('id').eq('item_id', item.id);
  if (accountsError) throw accountsError;

  const { data: existing, error: existingError } = await admin
    .from('recurring_streams')
    .select('id, account_id, direction, merchant_key, dismissed')
    .in('account_id', (accounts ?? []).map((a) => a.id));
  if (existingError) throw existingError;

  // A near miss Jev could not judge this time is neither refreshed nor deleted.
  const stale = staleStreamIds(existing ?? [], [...streams, ...keep]);
  if (stale.length > 0) {
    // Re-checked in the delete itself: a user can dismiss between the read above
    // and this statement, and their verdict must survive.
    const { error } = await admin.from('recurring_streams').delete().in('id', stale).eq('dismissed', false);
    if (error) throw error;
  }
}
