import type { AppStateStatus } from 'react-native';

/**
 * iOS passes through 'inactive' for Face ID, the Passwords bar, Control Center and
 * system alerts without the person leaving the app. Only coming back from
 * 'background' counts as returning, so those overlays never refetch every screen.
 *
 * `settled` is the last state that was not 'inactive': iOS returns from the
 * background as background -> inactive -> active, so compare against that, never
 * against the transient 'inactive'.
 *
 * Returns true (returned), false (left), or null (no change worth reporting).
 */
export function focusTransition(settled: AppStateStatus, next: AppStateStatus): boolean | null {
  if (next === 'background') return false;
  if (next === 'active' && settled === 'background') return true;
  return null;
}

/** Remembers the settled state between events, so each listener needs one call. */
export function createFocusTracker(initial: AppStateStatus): (next: AppStateStatus) => boolean | null {
  let settled = initial;
  return (next) => {
    const result = focusTransition(settled, next);
    if (next !== 'inactive') settled = next;
    return result;
  };
}
