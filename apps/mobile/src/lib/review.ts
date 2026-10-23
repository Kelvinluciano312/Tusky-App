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
  /** Cards handed to a herd mate with Ask. They leave this visit and are not a review. */
  handed: number;
};

export type DeckMove = { type: 'accept' } | { type: 'skip' } | { type: 'undo' } | { type: 'handOff'; id: string };

export function newDeck(ids: string[]): Deck {
  return { queue: [...ids], skipped: [], history: [], accepted: 0, handed: 0 };
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
        handed: deck.handed,
      };
    case 'skip':
      if (top === undefined) return deck;
      return {
        queue: [...rest, top],
        skipped: deck.skipped.includes(top) ? deck.skipped : [...deck.skipped, top],
        history: [...deck.history, { id: top, move: 'skip' }],
        accepted: deck.accepted,
        handed: deck.handed,
      };
    case 'handOff':
      // Asking already moved the row to that person's queue. Undo cannot put it
      // back here without taking the question back, which the transaction screen does.
      if (!deck.queue.includes(move.id)) return deck;
      return {
        queue: deck.queue.filter((id) => id !== move.id),
        skipped: deck.skipped.filter((id) => id !== move.id),
        history: deck.history,
        accepted: deck.accepted,
        handed: deck.handed + 1,
      };
    case 'undo': {
      const last = deck.history.at(-1);
      if (!last) return deck;
      const history = deck.history.slice(0, -1);
      if (last.move === 'accept') {
        return {
          queue: [last.id, ...deck.queue],
          skipped: deck.skipped,
          history,
          accepted: deck.accepted - 1,
          handed: deck.handed,
        };
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
        handed: deck.handed,
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

/**
 * Whether a row belongs in this member's review queue.
 *
 * An open ask sets `review_assignee`. Only that person sees the row, even when
 * someone else already marked it reviewed. With no assignee, the shared queue
 * is every posted row still unreviewed. Pending rows are left out by the query.
 */
export function inMyReview(
  row: { reviewed_at: string | null; review_assignee: string | null },
  me: string | null,
): boolean {
  if (row.review_assignee) return me !== null && row.review_assignee === me;
  return row.reviewed_at === null;
}

/** PostgREST `or` filter with the same rule as `inMyReview`. `me` is a user id. */
export function reviewQueueFilter(me: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(me)) {
    throw new Error('review queue filter needs a user id');
  }
  return `and(reviewed_at.is.null,review_assignee.is.null),review_assignee.eq.${me}`;
}

/** "Waiting on Annie" (ask routing): questions I sent that are still open. */
export function waitingLine(questions: { asked_to: string }[], name: (id: string) => string): string {
  const people = [...new Set(questions.map((q) => q.asked_to))].map(name);
  const who =
    people.length <= 2 ? people.join(' and ') : `${people.slice(0, -1).join(', ')} and ${people[people.length - 1]}`;
  const n = questions.length;
  if (n <= 1) return `Waiting on ${who}`;
  return `Waiting on ${who} · ${n}`;
}

/** "Annie asked about 2 of them" (15d): who is waiting on me, under the review count. */
export function askedLine(questions: { asked_by: string }[], name: (id: string) => string): string {
  const askers = [...new Set(questions.map((q) => q.asked_by))].map(name);
  const who =
    askers.length <= 2 ? askers.join(' and ') : `${askers.slice(0, -1).join(', ')} and ${askers[askers.length - 1]}`;
  const n = questions.length;
  return `${who} asked about ${n === 1 ? 'one' : n} of them`;
}

/**
 * The deck's order (12d): Jev's "likely needs a fix" first, then "worth a
 * glance", then everything else, keeping the queue's oldest-first order within
 * each. Unjudged rows count as routine, so with Jev off the order is exactly
 * the old one.
 *
 * Since 15d, rows a herd mate asked me about come before all of that, oldest
 * question first, whether or not they made the queue's batch.
 */
export function orderQueue(
  rows: { id: string; review_priority: number | null }[],
  askedOfMe: string[] = [],
): string[] {
  const asked = [...new Set(askedOfMe)];
  const rest = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (b.row.review_priority ?? 0) - (a.row.review_priority ?? 0) || a.index - b.index)
    .map(({ row }) => row.id)
    .filter((id) => !asked.includes(id));
  return [...asked, ...rest];
}
