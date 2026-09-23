import type { RecurringStream } from '@/lib/queries';

/**
 * Date math for the radar. LOCAL dates throughout — "due tomorrow" means the
 * user's tomorrow — so never toISOString(), which is UTC. Every parse appends
 * T00:00:00 for the reason given in lib/month.ts.
 */

const CADENCE_DAYS = { weekly: 7, biweekly: 14, monthly: 31 } as const;
const MONTHLY_FACTOR = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1 } as const;

const parse = (iso: string) => new Date(`${iso}T00:00:00`);

function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Today as 'YYYY-MM-DD' in the device's timezone. */
export function todayLocal(now = new Date()): string {
  return isoLocal(now);
}

export function addDays(iso: string, n: number): string {
  const d = parse(iso);
  d.setDate(d.getDate() + n);
  return isoLocal(d);
}

/** At most one missed occurrence; beyond that the stream has probably ended. */
export function isActive(s: RecurringStream, today: string): boolean {
  return today <= addDays(s.next_date, CADENCE_DAYS[s.frequency]);
}

/** Bills (not income) the user has not dismissed, due today through today + days. Input is next_date-ordered. */
export function upcomingBills(streams: RecurringStream[], today: string, days: number): RecurringStream[] {
  const end = addDays(today, days);
  return streams.filter(
    (s) => !s.dismissed && s.direction === 'outflow' && s.next_date >= today && s.next_date <= end,
  );
}

/** A stream's typical amount as a positive per-month figure. */
export function monthlyEquivalent(s: RecurringStream): number {
  return Math.abs(s.average_amount) * MONTHLY_FACTOR[s.frequency];
}

export function frequencyLabel(f: RecurringStream['frequency']): string {
  return f === 'weekly' ? 'Weekly' : f === 'biweekly' ? 'Every 2 weeks' : 'Monthly';
}

/** 'Today', 'Tomorrow', 'Fri 26' within a week, else 'Oct 1'. */
export function relativeDay(iso: string, today: string): string {
  const diff = Math.round((parse(iso).getTime() - parse(today).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  // Composed by hand: Android's Intl orders { weekday, day } as '25 Fri'.
  if (diff > 1 && diff < 7) {
    const d = parse(iso);
    return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getDate()}`;
  }
  return parse(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
