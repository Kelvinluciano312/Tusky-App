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

const MAX_CONTENT = 640;
const MAX_SHEET = 560;
const MAX_WIDE = 1040;


/**
 * Screen sizes (Phase 16g). Phones fill the width; on a tablet the content is a
 * centred column no wider than `maxContent` and sheets are capped at `maxSheet`,
 * so a row never stretches across a 10-inch landscape screen. Spread `column`
 * into a ScrollView's `contentContainerStyle` (or use `<Column>`); spread
 * `sheet` into a bottom sheet's panel. Headers and the tab bar stay full width.
 */
export const Layout = {
  /** Widest a screen's content gets, in dp. */
  maxContent: MAX_CONTENT,
  /** Widest a two-column screen gets, in dp. */
  maxWide: MAX_WIDE,
  /** Widest a bottom sheet gets, in dp. */
  maxSheet: MAX_SHEET,
  /** Widest a dialog card gets, in dp. */
  maxDialog: 420,
  /** Centre-and-cap style for a screen's content. */
  column: { width: '100%', maxWidth: MAX_CONTENT, alignSelf: 'center' },
  /** Centre-and-cap style for a screen shown in two columns. */
  wide: { width: '100%', maxWidth: MAX_WIDE, alignSelf: 'center' },
  /** Centre-and-cap style for a bottom sheet's panel. */
  sheet: { width: '100%', maxWidth: MAX_SHEET, alignSelf: 'center' },
} as const;
