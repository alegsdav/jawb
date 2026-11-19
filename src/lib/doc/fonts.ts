import { DEFAULT_FONT_FAMILY } from "./types";

/** The font menu. Carlito and Arimo/Tinos are metric-compatible fallbacks loaded as web fonts. */
export const FONT_CHOICES = ["Calibri", "Arial", "Times New Roman", "Georgia", "Garamond"] as const;

const SERIF_HINTS = [
  "times", "garamond", "georgia", "cambria", "book antiqua", "palatino", "baskerville", "didot", "minion", "caslon", "serif",
];

/** A rough guess from the family name: serif when it looks like a serif face and is not a sans one. */
export function isSerifFamily(family: string): boolean {
  const name = family.toLowerCase();
  if (name.includes("sans")) return false;
  return SERIF_HINTS.some((hint) => name.includes(hint));
}

/** CSS font-family value for a document family name, with fallbacks so a missing font degrades sensibly. */
export function cssFontStack(family: string | null | undefined): string {
  const name = (family ?? "").trim();
  if (!name) return cssFontStack(DEFAULT_FONT_FAMILY);
  switch (name.toLowerCase()) {
    case "calibri":
      return `Calibri, Carlito, "Segoe UI", Arial, sans-serif`;
    case "arial":
    case "helvetica":
      return `Arial, Helvetica, Arimo, sans-serif`;
    case "times new roman":
    case "times":
      return `"Times New Roman", Times, Tinos, serif`;
    case "georgia":
      return `Georgia, "Times New Roman", serif`;
    case "garamond":
    case "eb garamond":
      return `Garamond, "EB Garamond", "Times New Roman", serif`;
    default: {
      const quoted = `"${name.replace(/["\\]/g, "\\$&")}"`;
      return `${quoted}, ${isSerifFamily(name) ? "serif" : "sans-serif"}`;
    }
  }
}
