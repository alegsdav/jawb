/**
 * Page setup helpers for the margin dialog: the allowed range, the presets and the conversions between the
 * page and the dialog's text inputs. Kept apart from the component so they test without a DOM.
 */
import { type PageSetup } from "@/lib/doc/types";

/** The margins a user can set, in inches. Narrower or wider than this is not a usable resume page. */
export const MARGIN_RANGE_IN = { min: 0.2, max: 3 } as const;
export const MARGIN_STEP_IN = 0.05;

export type MarginSide = keyof PageSetup;
/** The four margins in the order the dialog shows them. */
export const MARGIN_SIDES: MarginSide[] = ["marginTop", "marginBottom", "marginLeft", "marginRight"];

function allSides(v: number): PageSetup {
  return { marginTop: v, marginBottom: v, marginLeft: v, marginRight: v };
}

/** One click sets all four margins. */
export const PAGE_PRESETS: { label: string; page: PageSetup }[] = [
  { label: "Narrow (0.5 in)", page: allSides(0.5) },
  { label: "Normal (1 in)", page: allSides(1) },
  { label: "Moderate (0.75 in top/bottom, 0.75 sides)", page: allSides(0.75) },
];

/**
 * A margin clamped to the allowed range and rounded to the input's step (hundredths of an inch), so a typed or
 * imported value always lands on something the page can draw.
 */
export function clampMargin(inches: number): number {
  const v = Math.min(MARGIN_RANGE_IN.max, Math.max(MARGIN_RANGE_IN.min, inches));
  return Math.round(v * 100) / 100;
}

/**
 * The page the four typed values describe, clamped. Null when any value is not a number (an empty or
 * half-typed field): nothing is applied until every margin reads as one.
 */
export function pageFromInputs(values: Record<MarginSide, string>): PageSetup | null {
  const out = {} as PageSetup;
  for (const key of MARGIN_SIDES) {
    const n = Number(values[key].trim());
    if (values[key].trim() === "" || !Number.isFinite(n)) return null;
    out[key] = clampMargin(n);
  }
  return out;
}

/** The four inputs' text for a page: two decimals, so 0.42 reads as 0.42 and 0.5 as 0.50. */
export function inputsFromPage(page: PageSetup): Record<MarginSide, string> {
  return {
    marginTop: page.marginTop.toFixed(2),
    marginBottom: page.marginBottom.toFixed(2),
    marginLeft: page.marginLeft.toFixed(2),
    marginRight: page.marginRight.toFixed(2),
  };
}

