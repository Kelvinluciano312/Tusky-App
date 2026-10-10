/**
 * Which backend the app talks to (Phase 9, Track P). Pure, so `node --test`
 * runs it; lib/backend.ts does the I/O.
 *
 * - `sandbox`: the dev Supabase project, with Plaid Sandbox.
 * - `real`: the production project (Ouroboros), with real banks.
 *
 * Dev builds choose in Settings. Release (Play) builds are always real data
 * once the production project is configured.
 */

export type Backend = 'sandbox' | 'real';

export function pickBackend({
  stored,
  isDev,
  realConfigured,
}: {
  stored: string | null;
  isDev: boolean;
  realConfigured: boolean;
}): Backend {
  if (!realConfigured) return 'sandbox';
  if (!isDev) return 'real';
  return stored === 'real' ? 'real' : 'sandbox';
}

export function backendLabel(backend: Backend): string {
  return backend === 'real' ? 'Real data' : 'Plaid Sandbox';
}

/**
 * RevenueCat's public key for this launch: one per store and per backend. Empty
 * means purchases are off, and the paywall says plans are coming soon.
 */
export function pickRevenueCatKey(i: {
  backend: Backend;
  platform: string;
  keys: { android: string; ios: string; prodAndroid: string; prodIos: string };
}): string {
  if (i.platform !== 'ios' && i.platform !== 'android') return '';
  if (i.backend === 'real') return i.platform === 'ios' ? i.keys.prodIos : i.keys.prodAndroid;
  return i.platform === 'ios' ? i.keys.ios : i.keys.android;
}
