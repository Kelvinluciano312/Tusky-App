/** The crowd-label prompt (12c): asked once, after a user's third fix. Pure. */

export const CROWD_PROMPT_AFTER = 3;

export type PromptState = { fixes: number; asked: boolean };

export function parsePromptState(raw: string | null): PromptState {
  try {
    const s = raw ? JSON.parse(raw) : null;
    if (s && typeof s.fixes === 'number' && typeof s.asked === 'boolean') return { fixes: s.fixes, asked: s.asked };
  } catch {
    // fall through: start over
  }
  return { fixes: 0, asked: false };
}

/** Count one fix, and say whether to ask now. */
export function afterFix(state: PromptState, consented: boolean): { state: PromptState; ask: boolean } {
  const fixes = state.fixes + 1;
  const ask = !state.asked && !consented && fixes >= CROWD_PROMPT_AFTER;
  return { state: { fixes, asked: state.asked || ask }, ask };
}
