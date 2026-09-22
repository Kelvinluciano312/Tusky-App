/**
 * Tusky theme — forest-ink + tusk-ivory, brand green drawn from the elephant mark.
 * Dark is the primary appearance; light is a warm-paper inversion of the same system.
 */

export const Palette = {
  dark: {
    /** Deep forest ink — app background */
    bg: '#121A15',
    /** Cards and tab bar */
    surface: '#1B2620',
    /** Raised elements: inputs, chips */
    elevated: '#243229',
    /** Hairline borders */
    border: 'rgba(239,234,224,0.08)',
    /** Tusk ivory — primary text */
    text: '#EFEAE0',
    /** Secondary text */
    textDim: '#94A198',
    /** Brand green, lifted from the logo for dark-bg contrast */
    brand: '#3E9B6C',
    /** Text/icons on brand-filled surfaces */
    onBrand: '#0C1410',
    /** Money in */
    positive: '#55C084',
    /** Money out / destructive */
    negative: '#E07856',
    /** Reserved for rare highlights (net-worth spark) */
    gold: '#D9A441',
  },
  light: {
    bg: '#F7F4EC',
    surface: '#FFFFFF',
    elevated: '#EFEBE0',
    border: 'rgba(31,42,35,0.12)',
    text: '#1F2A23',
    textDim: '#5C6B60',
    brand: '#2F7B54',
    onBrand: '#F7F4EC',
    positive: '#237A50',
    negative: '#BC5138',
    gold: '#A97A1F',
  },
} as const;

export type ThemeColors = { [K in keyof typeof Palette.dark]: string };

/**
 * Type roles. Fraunces carries the brand voice (wordmark, greetings, section
 * headers); Figtree does the UI work; IBM Plex Mono is the "ledger voice" —
 * every monetary amount in the app is set in it, always tabular.
 */
export const Type = {
  display: 'Fraunces_600SemiBold',
  displayMedium: 'Fraunces_500Medium',
  body: 'Figtree_400Regular',
  bodyMedium: 'Figtree_500Medium',
  bodySemiBold: 'Figtree_600SemiBold',
  bodyBold: 'Figtree_700Bold',
  mono: 'IBMPlexMono_500Medium',
  monoSemiBold: 'IBMPlexMono_600SemiBold',
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;
