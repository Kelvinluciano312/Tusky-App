// What a signed-in user sees first (Phase 15c): the terms when they have not
// accepted the current version, then the first-run steps until they finish
// them, then the app. Pure, so the gate is tested apart from the router.

export type FirstRunState = { termsVersion: string | null; onboarded: boolean };
export type Gate = 'terms' | 'onboarding' | 'app';

/**
 * `state` is null while loading or when the read failed. A failed read opens
 * the app rather than locking someone out of their money while offline; the
 * gate asks again on the next launch.
 */
export function gateFor(state: FirstRunState | null, currentTerms: string): Gate {
  if (!state) return 'app';
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
