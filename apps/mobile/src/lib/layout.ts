import { Layout } from '../constants/theme.ts';

/** Android's own line between a phone and a tablet: 600dp on the shorter side. */
export const TABLET_MIN_WIDTH = 600;

/** The width a screen's content column gets in a window `windowWidth` wide. */
export function contentWidth(windowWidth: number, max: number = Layout.maxContent): number {
  return Math.max(0, Math.min(windowWidth, max));
}

/** True on a window wide enough to be a tablet (or a phone turned sideways). */
export function isWide(windowWidth: number): boolean {
  return windowWidth >= TABLET_MIN_WIDTH;
}

/** A window this wide shows Home in two columns (a landscape tablet, not a phone or a 7-inch). */
export const TWO_COLUMN_MIN_WIDTH = 900;

export function twoColumns(windowWidth: number): boolean {
  return windowWidth >= TWO_COLUMN_MIN_WIDTH;
}
