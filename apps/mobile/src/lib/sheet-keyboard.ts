/**
 * Where a bottom sheet sits once the keyboard is open.
 *
 * Expo SDK 57 is edge-to-edge on Android, so `softwareKeyboardLayoutMode`
 * (the app leaves it at the default, `resize`) does not shrink the window,
 * and a `Modal` is its own window anyway. A content-sized sheet then
 * collapses to the bottom and a short result list disappears under the
 * keyboard. The lift is the keyboard's own height, and the cap is the band
 * left above it, so a short list sits on the keyboard and a long one scrolls
 * inside that band.
 */

export type KeyboardEnd = {
  height: number;
  screenY: number;
};

export type SheetKeyboardFrame = {
  /** Push the panel up so its bottom edge meets the keyboard. */
  marginBottom: number;
  /** The tallest the panel may be and still stay on screen above the keyboard. */
  maxHeight: number;
  /** Safe-area padding while the keyboard is closed; a small gap while it is open. */
  paddingBottom: number;
};

/** Scrollable sheet body: shrink into the band above the keyboard, and leave a short list short. */
export const sheetListStyle = {
  flexGrow: 0,
  flexShrink: 1,
  minHeight: 0,
} as const;

/** So the first tap on a row selects it while the keyboard is open. */
export const SHEET_KEYBOARD_PERSIST_TAPS = 'handled' as const;

function atLeastZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * How far the keyboard overlaps the window. `height` is what Android and iOS
 * report. Some edge-to-edge builds report height 0 and a `screenY` at the top
 * of the keyboard instead.
 */
export function keyboardOverlap(end: KeyboardEnd, windowHeight: number): number {
  const window = atLeastZero(windowHeight);
  const height = Number.isFinite(end.height) ? end.height : 0;
  if (height > 0) return Math.min(height, window);
  const screenY = Number.isFinite(end.screenY) ? end.screenY : 0;
  if (screenY > 0 && screenY < window) return window - screenY;
  return 0;
}

export function sheetKeyboardFrame(input: {
  windowHeight: number;
  keyboardHeight: number;
  topInset: number;
  bottomInset: number;
  gap: number;
}): SheetKeyboardFrame {
  const windowHeight = atLeastZero(input.windowHeight);
  const keyboardHeight = atLeastZero(input.keyboardHeight);
  const topInset = atLeastZero(input.topInset);
  const bottomInset = atLeastZero(input.bottomInset);
  const gap = atLeastZero(input.gap);
  const marginBottom = Math.min(keyboardHeight, windowHeight);
  return {
    marginBottom,
    maxHeight: Math.max(0, windowHeight - marginBottom - topInset - gap),
    paddingBottom: (marginBottom > 0 ? 0 : bottomInset) + gap,
  };
}

/**
 * Style applied on top of a caller's own height cap. Null while the keyboard
 * is closed, so a resting sheet keeps the cap it asked for.
 */
export function sheetLiftStyle(frame: SheetKeyboardFrame): { marginBottom: number; maxHeight: number } | null {
  if (frame.marginBottom <= 0) return null;
  return { marginBottom: frame.marginBottom, maxHeight: frame.maxHeight };
}

/** Extra padding so the last row of a screen list can scroll to sit above the keyboard. */
export function listPaddingAboveKeyboard(keyboardHeight: number, gap: number, bottomInset = 0): number {
  const height = atLeastZero(keyboardHeight);
  if (height === 0) return 0;
  return height + atLeastZero(gap) + atLeastZero(bottomInset);
}

/**
 * Padding for an edge-to-edge screen. Android reports a keyboard height that
 * already subtracts the navigation bar (`ime - systemBars`), while the screen
 * is drawn behind that bar, so the bar is added back. iOS reports the full
 * distance from the bottom of the screen to the top of the keyboard.
 */
export function screenKeyboardPadding(keyboardHeight: number, bottomInset: number, gap: number, os: string): number {
  return listPaddingAboveKeyboard(keyboardHeight, gap, os === 'android' ? bottomInset : 0);
}
