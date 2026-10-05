// What a signed-in user sees first (Phase 15c): the terms when they have not
// accepted the current version, then the first-run steps until they finish
// them, then the app. Since 16e a first gate sits ahead of all three: the email
// code, for users who turned on two-step sign-in. Pure, so the gate is tested
// apart from the router.

import { needsSecondStep } from './two-factor.ts';

export type FirstRunState = {
  termsVersion: string | null;
  onboarded: boolean;
  /** profiles.two_factor; absent (older callers) means off. */
  twoFactor?: boolean | null;
};
export type Gate = 'verify' | 'terms' | 'onboarding' | 'app';

/**
 * `state` is null while loading or when the read failed. A failed read opens
 * the app rather than locking someone out of their money while offline; the
 * gate asks again on the next launch.
 *
 * `amr` is the session JWT's amr claim (`amrOfAccessToken`). With two-step on
 * and no otp entry in it, the answer is `verify`, before anything else.
 */
export function gateFor(state: FirstRunState | null, currentTerms: string, amr?: unknown): Gate {
  if (!state) return 'app';
  if (needsSecondStep({ two_factor: state.twoFactor ?? null }, amr)) return 'verify';
  if (state.termsVersion !== currentTerms) return 'terms';
  if (!state.onboarded) return 'onboarding';
  return 'app';
}

export const ONBOARDING_STEPS = ['welcome', 'name', 'bank', 'budget', 'sharing', 'plans'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** "Step 2 of 6", counted from one. */
export function stepLabel(step: OnboardingStep): string {
  return `Step ${ONBOARDING_STEPS.indexOf(step) + 1} of ${ONBOARDING_STEPS.length}`;
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1] ?? null;
}

export function previousStep(step: OnboardingStep): OnboardingStep | null {
  const i = ONBOARDING_STEPS.indexOf(step);
  return i > 0 ? ONBOARDING_STEPS[i - 1] : null;
}
