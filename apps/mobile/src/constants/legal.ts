// Store rules want these beside every purchase and in Settings (Phase 14d).
// The pages live on the studio site (Ouroboros-Inc repo, `public/tusky/`).
// `||` not `??`: unset EXPO_PUBLIC_ vars arrive as ''.
const PAGES = 'https://studiosouroboros.com/tusky';

export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL || `${PAGES}/privacy`;
export const DELETE_URL = process.env.EXPO_PUBLIC_DELETE_URL || `${PAGES}/delete-account`;
export const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL || `${PAGES}/terms`;

/** The terms a user accepts (Phase 15c). Bump it with the page's effective date. */
export const TERMS_VERSION = '2026-10-01';
