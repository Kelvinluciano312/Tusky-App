/**
 * Herds (Phase 9c): invite codes and how members are shown. Pure, so
 * `node --test` runs it. normalizeCode mirrors the server's
 * (`supabase/functions/_shared/herd.ts`); change both together.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 8;

/**
 * What a person typed or pasted, as a stored code, or null. Case, dashes and
 * spaces don't matter, and look-alikes are forgiven (O→0, I/L→1). A pasted
 * invite link works too.
 */
export function normalizeCode(input: string): string | null {
  const tail = input.trim().split('/').pop() ?? '';
  const code = tail.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!ALPHABET.includes(ch)) return null;
  return code;
}

/** XXXX-XXXX, the way codes are shown and shared. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** The invite as shared. The code is in the text too: a link opened while signed out loses it. */
export function inviteMessage(herdName: string, code: string): string {
  const shown = formatCode(code);
  return `Join ${herdName} on Tusky: open tusky:///join/${code}, or in Tusky go to Settings, tap your herd, choose "Join someone else's herd" and enter ${shown}.`;
}

/** Up to two initials for a member's avatar. */
export function initials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return letters.map((w) => Array.from(w)[0]?.toUpperCase() ?? '').join('') || '?';
}

/** "in 7 days" for a new invite, "within a day" for its last day: when it stops working. */
export function expiresIn(expiresAt: string, now: Date = new Date()): string {
  const days = Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 86_400_000);
  return days <= 1 ? 'within a day' : `in ${days} days`;
}
