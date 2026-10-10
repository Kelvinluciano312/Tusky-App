/**
 * Plaid sends the person back from an OAuth bank through our universal link
 * (https://studiosouroboros.com/tusky/plaid/oauth?oauth_state_id=…). Plaid's SDK
 * resumes Link itself, so the router must not try to open that URL as a screen.
 */
export function isPlaidOAuthReturn(path: string): boolean {
  return /\/tusky\/plaid\//.test(path);
}
