/**
 * Sign in with Apple, the parts that need no native module (Phase 17). Pure, so
 * `node --test` runs it; lib/apple-auth.ts does the I/O.
 */

import { NAME_MAX } from './profile.ts';

export type AppleFullName =
  | { givenName?: string | null; middleName?: string | null; familyName?: string | null }
  | null
  | undefined;

export const RELAY_DOMAIN = 'privaterelay.appleid.com';

/** "Given Family" from the name Apple sends on a first sign-in; null when Apple sent none. */
export function appleDisplayName(n: AppleFullName): string | null {
  const parts = [n?.givenName, n?.familyName].map((p) => p?.trim()).filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** A Hide My Email address, which Apple forwards to the person's real inbox. */
export function isRelayEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith(`@${RELAY_DOMAIN}`);
}

/**
 * What onboarding's name field starts with. `handle_new_user` falls back to the
 * email's local part, which for a relay address is random text: start empty then.
 */
export function nameSuggestion(displayName: string | undefined, email: string | undefined): string {
  const name = displayName?.trim() ?? '';
  if (!name) return '';
  if (isRelayEmail(email)) {
    const local = (email ?? '').split('@')[0].trim().slice(0, NAME_MAX).toLowerCase();
    if (name.toLowerCase() === local) return '';
  }
  return name;
}

export type IdentityLike = { provider: string; identity_data?: Record<string, unknown> | null };

export function hasProvider(identities: IdentityLike[] | undefined, provider: string): boolean {
  return !!identities?.some((i) => i.provider === provider);
}

/** Apple's stable id for this person (`sub`), from the linked Apple identity. */
export function appleSub(identities: IdentityLike[] | undefined): string | null {
  const sub = identities?.find((i) => i.provider === 'apple')?.identity_data?.sub;
  return typeof sub === 'string' && sub !== '' ? sub : null;
}

/**
 * Account deletion re-authenticates with Apple on iOS when an Apple identity
 * exists (only an Apple proof lets the server revoke Apple's token); otherwise
 * with the password.
 */
export function deleteProofKind(identities: IdentityLike[] | undefined, platform: string): 'apple' | 'password' {
  return platform === 'ios' && hasProvider(identities, 'apple') ? 'apple' : 'password';
}

export function appleCanceled(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'ERR_REQUEST_CANCELED';
}
