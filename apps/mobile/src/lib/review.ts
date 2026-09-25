/**
 * Transaction review (Phase 8). Pure, so `node --test` runs it.
 */

export const NOTE_MAX = 500;

/** A memo as stored: trimmed, at most NOTE_MAX characters; blank means no memo (null). Matches the SQL check. */
export function normalizeNote(raw: string): string | null {
  const note = raw.trim().slice(0, NOTE_MAX).trim();
  return note.length > 0 ? note : null;
}

/** The cards to mark reviewed when the reel moves from one page to another: every one passed going forward, none going back. */
export function leftBehind(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, i) => from + i);
}
