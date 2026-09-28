/**
 * Crowd labels (Phase 12c). Pure: callers load the tallies.
 *
 * Users who opt in contribute their category choices to a shared pool
 * (community_labels), keyed by merchant, direction and amount band and never by
 * who they are. A band is served to everyone only once enough distinct people
 * agree, so no single person's choice is ever visible through another user's
 * category.
 */

export const CROWD = {
  /** Fewer distinct contributors than this in a band serve nothing. */
  MIN_CONTRIBUTORS: 3,
  /** The winning category's share of the band's contributors. */
  MIN_SHARE: 0.7,
} as const;

/**
 * Amount band edges, on the absolute amount: [0,5) [5,15) [15,50) [50,150)
 * [150,500) 500+. Shared with 12b's AI cache key. The SQL twin is
 * private.amount_band: change both together.
 */
const BANDS = [5, 15, 50, 150, 500];

export function amountBand(amount: number): number {
  const magnitude = Math.abs(amount);
  const index = BANDS.findIndex((edge) => magnitude < edge);
  return index === -1 ? BANDS.length : index;
}

export function directionOf(amount: number): 'in' | 'out' {
  return amount > 0 ? 'in' : 'out';
}

/**
 * The pool keys a row can match, most specific first: Plaid's entity id, then
 * the normalized name. Entity ids are sparse, so the name is the common case.
 */
export function crowdMerchants(entityId: string | null | undefined, merchantKey: string): string[] {
  const out: string[] = [];
  if (entityId) out.push(entityId);
  if (merchantKey) out.push(`k:${merchantKey}`);
  return out;
}

export type Tally = {
  merchant: string;
  direction: 'in' | 'out';
  amount_band: number;
  category_id: string;
  /** Distinct contributors: the pool holds one row per contributor and band. */
  votes: number;
};

export function crowdKey(merchant: string, direction: 'in' | 'out', band: number): string {
  return `${merchant}|${direction}|${band}`;
}

/** The bands the crowd agrees on, as crowdKey → category id. */
export function communityAnswers(tallies: Tally[]): Map<string, string> {
  const byKey = new Map<string, { total: number; best: string | null; most: number; tied: boolean }>();
  for (const t of tallies) {
    const key = crowdKey(t.merchant, t.direction, t.amount_band);
    const s = byKey.get(key) ?? { total: 0, best: null, most: 0, tied: false };
    s.total += t.votes;
    if (t.votes > s.most) Object.assign(s, { best: t.category_id, most: t.votes, tied: false });
    else if (t.votes === s.most) s.tied = true;
    byKey.set(key, s);
  }
  const answers = new Map<string, string>();
  for (const [key, s] of byKey) {
    if (s.best && !s.tied && s.total >= CROWD.MIN_CONTRIBUTORS && s.most >= CROWD.MIN_SHARE * s.total) {
      answers.set(key, s.best);
    }
  }
  return answers;
}

/** The crowd's category for one row, or null. */
export function communityCategory(
  answers: Map<string, string>,
  entityId: string | null | undefined,
  merchantKey: string,
  amount: number,
): string | null {
  const direction = directionOf(amount);
  const band = amountBand(amount);
  for (const merchant of crowdMerchants(entityId, merchantKey)) {
    const hit = answers.get(crowdKey(merchant, direction, band));
    if (hit) return hit;
  }
  return null;
}
