// Store rules want these beside every purchase and in Settings (Phase 14d).
// The pages live on the studio site (Ouroboros-Inc repo, `public/tusky/`).
// `||` not `??`: unset EXPO_PUBLIC_ vars arrive as ''. Apple's standard EULA
// serves as the terms until Tusky has its own.
const PAGES = 'https://studiosouroboros.com/tusky';

export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL || `${PAGES}/privacy`;
export const DELETE_URL = process.env.EXPO_PUBLIC_DELETE_URL || `${PAGES}/delete-account`;
export const TERMS_URL =
  process.env.EXPO_PUBLIC_TERMS_URL || 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
