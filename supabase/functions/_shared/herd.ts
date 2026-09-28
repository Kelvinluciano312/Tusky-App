/**
 * Herd membership (Phase 9c): invite codes, request validation, and what the
 * join/leave SQL functions' errors mean to the app. Pure; pinned by
 * herd.test.ts. The `herd` function does the I/O.
 */

/** Crockford base32: no I, L, O or U, so a code read aloud cannot be misheard. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 8;
export const MAX_MEMBERS = 6;

/** 8 random characters (40 bits). 256 is a multiple of 32, so `& 31` is unbiased. */
export function generateCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(random(CODE_LENGTH), (b) => ALPHABET[b & 31]).join('');
}

/**
 * What a person typed or pasted, as a stored code, or null. Case, dashes and
 * spaces don't matter, and the look-alikes Crockford maps are forgiven
 * (O→0, I/L→1). A pasted invite link works too: the code is its last segment.
 */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HerdRequest =
  | { action: 'create_invite' }
  | { action: 'revoke_invite'; code: string }
  | { action: 'preview_invite'; code: string }
  | { action: 'join'; code: string; private_account_ids: string[] }
  | { action: 'leave' }
  | { action: 'remove_member'; user_id: string };

/** The request body, checked up front: a malformed id would reach PostgREST as 22P02, a 500. */
export function parseHerdRequest(body: unknown): HerdRequest | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  switch (b.action) {
    case 'create_invite':
    case 'leave':
      return { action: b.action };
    case 'revoke_invite':
    case 'preview_invite': {
      const code = normalizeCode(b.code);
      return code ? { action: b.action, code } : { error: "That code doesn't look right" };
    }
    case 'join': {
      const code = normalizeCode(b.code);
      if (!code) return { error: "That code doesn't look right" };
      const ids = b.private_account_ids ?? [];
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && UUID.test(id))) {
        return { error: 'private_account_ids must be account ids' };
      }
      return { action: 'join', code, private_account_ids: ids as string[] };
    }
    case 'remove_member':
      return typeof b.user_id === 'string' && UUID.test(b.user_id)
        ? { action: 'remove_member', user_id: b.user_id }
        : { error: 'user_id is required' };
    default:
      return { error: 'Unknown action' };
  }
}

/**
 * The reasons merge_into_herd and leave_herd refuse, as the app shows them.
 * Anything else is a server fault (null).
 */
export function describeMembershipError(message: string | undefined): { status: number; error: string } | null {
  switch (message) {
    case 'invite_invalid':
      return { status: 404, error: 'This invite has expired or was already used. Ask for a new one.' };
    case 'already_member':
      return { status: 409, error: "You're already in this herd." };
    case 'not_alone':
      return { status: 409, error: 'Leave your current herd before joining another.' };
    case 'herd_full':
      return { status: 409, error: `This herd is full (${MAX_MEMBERS} members).` };
    case 'alone':
      return { status: 409, error: "You're the only member, so there is nothing to leave." };
    default:
      return null;
  }
}
