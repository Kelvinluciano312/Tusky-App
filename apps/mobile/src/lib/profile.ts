/**
 * People's display names (Phase 9a). Pure, so `node --test` runs it.
 */

export const NAME_MAX = 40;

/** A display name as stored: trimmed, 1–NAME_MAX characters (the profiles check matches). Null when invalid. */
export function validatePersonName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 && name.length <= NAME_MAX ? name : null;
}
