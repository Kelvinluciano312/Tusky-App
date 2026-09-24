/**
 * Pure checks for the category functions (Phase 7b), kept apart from the
 * handler so ownership and body shape are Deno-tested.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The body's category_id, or null when it is missing or not a UUID. Checked up
 * front: PostgREST would answer a malformed id with 22P02, a 500.
 */
export function readCategoryId(body: unknown): string | null {
  const id = (body as { category_id?: unknown } | null)?.category_id;
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

export type CategoryRow = { id: string; parent_id: string | null; user_id: string | null };

/**
 * Where a deleted category's transactions and streams go: its group. Null means
 * "not yours to delete" — a built-in, another user's row, or no row at all —
 * and the handler answers all three with the same 404, so ids never leak.
 */
export function planCategoryDelete(row: CategoryRow | null, callerId: string): { moveTo: string } | null {
  if (!row || row.user_id !== callerId || row.parent_id === null) return null;
  return { moveTo: row.parent_id };
}
