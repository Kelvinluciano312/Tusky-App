/**
 * What the app says when the server refuses a bank for the plan (Phase 14a).
 * The server decides; this only words the 402 body `{ plan, max_banks }`.
 */
export function planLimitMessage(plan: unknown, maxBanks: unknown): string {
  if (plan === 'free') {
    return 'Your free trial has ended, so Tusky can no longer connect banks. Your history is still here.';
  }
  if (typeof maxBanks === 'number' && maxBanks > 0) {
    const banks = maxBanks === 1 ? '1 bank' : `${maxBanks} banks`;
    return `Your plan connects up to ${banks}, and you have reached it. Disconnect one, or choose a bigger plan.`;
  }
  return 'Your plan has reached its bank limit. Disconnect one, or choose a bigger plan.';
}
