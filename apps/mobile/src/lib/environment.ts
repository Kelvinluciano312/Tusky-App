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
