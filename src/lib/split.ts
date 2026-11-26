/**
 * The desktop split between the document editor and the review panel (lg and up). Pure, so the limits can be tested
 * without a DOM. The reviewer's share of the split (its width over the width left after the divider) is the value kept.
 */
export const SPLIT_DEFAULT = 0.5;
/** The reviewer's smallest share of the split. */
export const SPLIT_MIN = 0.3;
/** The reviewer's largest share: the editor always keeps at least 40%. */
export const SPLIT_MAX = 0.6;
/** The reviewer is never narrower than this, in px. */
export const REVIEW_MIN_PX = 340;
/** The divider's grid column. */
export const DIVIDER_PX = 9;
/** One arrow-key press moves the divider by this share. */
export const SPLIT_STEP = 0.02;

/** The reviewer's allowed share for a split this many px wide (the width after the divider). */
export function splitLimits(freePx: number): { min: number; max: number } {
  const floor = freePx > 0 ? REVIEW_MIN_PX / freePx : 0;
  const min = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, floor));
  return { min, max: SPLIT_MAX };
}

/** A reviewer share forced inside the limits for this width. A non-number falls back to the default. */
export function clampSplit(fraction: number, freePx: number): number {
  const f = Number.isFinite(fraction) ? fraction : SPLIT_DEFAULT;
  const { min, max } = splitLimits(freePx);
  return Math.min(max, Math.max(min, f));
}

/** A saved share read back from storage, or null when there is nothing usable there. */
export function parseSplit(raw: string | null): number | null {
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** The grid columns for a reviewer share: editor, divider, reviewer. */
export function splitColumns(fraction: number): string {
  return `minmax(0,${(1 - fraction).toFixed(4)}fr) ${DIVIDER_PX}px minmax(0,${fraction.toFixed(4)}fr)`;
}
