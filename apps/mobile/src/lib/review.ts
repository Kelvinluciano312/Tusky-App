/**
 * Transaction review (Phase 8; card deck since Phase 10). Pure, so `node --test`
 * runs it.
 */

export const NOTE_MAX = 500;

/** A memo as stored: trimmed, at most NOTE_MAX characters; blank means no memo (null). Matches the SQL check. */
export function normalizeNote(raw: string): string | null {
  const note = raw.trim().slice(0, NOTE_MAX).trim();
  return note.length > 0 ? note : null;
}

/**
 * The review deck. Swipe right accepts (the card leaves the deck), swipe left
 * skips (the card goes to the back, still unreviewed). Undo reverses the last
 * move. The deck is done when it is empty, or when every card left has been
 * skipped this visit, so skipping everything never loops forever.
 */
export type Deck = {
  queue: string[];
  skipped: string[];
  history: { id: string; move: 'accept' | 'skip' }[];
  accepted: number;
};

export type DeckMove = { type: 'accept' } | { type: 'skip' } | { type: 'undo' };

export function newDeck(ids: string[]): Deck {
  return { queue: [...ids], skipped: [], history: [], accepted: 0 };
}

export function deckReducer(deck: Deck, move: DeckMove): Deck {
  const [top, ...rest] = deck.queue;
  switch (move.type) {
    case 'accept':
      if (top === undefined) return deck;
      return {
        queue: rest,
        skipped: deck.skipped.filter((id) => id !== top),
        history: [...deck.history, { id: top, move: 'accept' }],
        accepted: deck.accepted + 1,
      };
    case 'skip':
      if (top === undefined) return deck;
      return {
        queue: [...rest, top],
        skipped: deck.skipped.includes(top) ? deck.skipped : [...deck.skipped, top],
        history: [...deck.history, { id: top, move: 'skip' }],
        accepted: deck.accepted,
      };
    case 'undo': {
      const last = deck.history.at(-1);
      if (!last) return deck;
      const history = deck.history.slice(0, -1);
      if (last.move === 'accept') {
        return { queue: [last.id, ...deck.queue], skipped: deck.skipped, history, accepted: deck.accepted - 1 };
      }
      // A skip put the card at the back; bring it to the front again. It stays
      // counted as skipped only if an earlier skip of it is still in history.
      const queue = [last.id, ...deck.queue.filter((id) => id !== last.id)];
      const stillSkipped = history.some((h) => h.id === last.id && h.move === 'skip');
      return {
        queue,
        skipped: stillSkipped ? deck.skipped : deck.skipped.filter((id) => id !== last.id),
        history,
        accepted: deck.accepted,
      };
    }
  }
}

/** The card on top, or null once the deck is done. */
export function topCard(deck: Deck): string | null {
  const top = deck.queue[0];
  if (top === undefined) return null;
  return deck.queue.every((id) => deck.skipped.includes(id)) ? null : top;
}
