// Store rules want these beside every purchase and in Settings (Phase 14d).
// The pages live in `site/`, published by GitHub Pages. `||` not `??`: unset
// EXPO_PUBLIC_ vars arrive as ''. Apple's standard EULA serves as the terms
// until Tusky has its own.
const PAGES = 'https://kelvinluciano312.github.io/Tusky-App';

export const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL || `${PAGES}/privacy.html`;
export const DELETE_URL = process.env.EXPO_PUBLIC_DELETE_URL || `${PAGES}/delete-account.html`;
export const TERMS_URL =
  process.env.EXPO_PUBLIC_TERMS_URL || 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';
