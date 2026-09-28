/**
 * The warning a plan owes the user before the daily check acts (Phase 14b):
 * 3 days before a trial ends, and through the 7-day window after dropping to a
 * smaller plan. Pure; the server decides and acts, this only words it.
 */
export type PlanInfo = {
  plan: string;
  source: 'own' | 'herd' | 'trial' | 'free';
  expires_at: string | null;
  max_banks: number;
  banks_used: number;
  over_limit_since: string | null;
};

const DAY = 86_400_000;
const CHOOSE_DAYS = 7; // _shared/enforce.ts
const TRIAL_WARN_DAYS = 3;

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

export function planBanner(p: PlanInfo, now: Date): { title: string; body: string } | null {
  if (p.max_banks > 0 && p.banks_used > p.max_banks) {
    const since = p.over_limit_since ? Date.parse(p.over_limit_since) : now.getTime();
    const left = Math.max(1, Math.ceil((since + CHOOSE_DAYS * DAY - now.getTime()) / DAY));
    return {
      title: `Your plan connects up to ${p.max_banks === 1 ? '1 bank' : `${p.max_banks} banks`}`,
      body: `You have ${p.banks_used}. Disconnect ${p.banks_used - p.max_banks} in Settings within ${days(left)}, or Tusky disconnects the most recently added.`,
    };
  }
  if (p.source === 'trial' && p.expires_at) {
    const left = Math.ceil((Date.parse(p.expires_at) - now.getTime()) / DAY);
    if (left >= 1 && left <= TRIAL_WARN_DAYS) {
      return {
        title: `Your trial ends in ${days(left)}`,
        body: 'After that, Tusky disconnects your banks. Everything you have tracked stays here.',
      };
    }
  }
  return null;
}
