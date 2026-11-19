import { DEFAULT_FONT_FAMILY } from "./types";

/** The font menu. Carlito (Calibri) and Tinos (Times) are metric-compatible fallbacks loaded as web fonts (src/app/fonts.css). */
export const FONT_CHOICES = ["Calibri", "Arial", "Times New Roman", "Georgia", "Garamond"] as const;

const SERIF_HINTS = [
  "times", "garamond", "georgia", "cambria", "book antiqua", "palatino", "baskerville", "didot", "minion", "caslon", "serif",
  "nimbus roman", "tex gyre termes", "tex gyre pagella",
];

/** LaTeX serif faces as TeX names them: "Latin Modern Roman", "LMRoman12", "CMR10", "CMU Serif", "CMBX12". */
const TEX_SERIF = /latin modern roman|lm ?roman|computer modern|cmu serif|^cm(r|bx|ti|sl)\d/;
/** LaTeX sans faces: "Latin Modern Sans", "LMSans10", "Computer Modern Sans", "CMSS10". */
const TEX_SANS = /latin modern sans|lm ?sans|computer modern sans|cmu sans|^cmss/;

/** Latin Modern has no web file here, so the stack names it, then the Times-like serif that is loaded. */
const LATIN_MODERN_SERIF = `"Latin Modern Roman", "LM Roman 10", "CMU Serif", Tinos, "Times New Roman", serif`;
const LATIN_MODERN_SANS = `"Latin Modern Sans", "LM Sans 10", "CMU Sans Serif", Arial, Helvetica, sans-serif`;

/** True for sans-serif families, by name ("Verdana Sans", "Open Sans") or LaTeX sans naming. */
export function isSansFamily(family: string): boolean {
  const name = family.toLowerCase();
  return name.includes("sans") || TEX_SANS.test(name);
}

/** A rough guess from the family name: serif when it looks like a serif face and is not a sans one. */
export function isSerifFamily(family: string): boolean {
  const name = family.toLowerCase();
  if (isSansFamily(name)) return false;
  return TEX_SERIF.test(name) || SERIF_HINTS.some((hint) => name.includes(hint));
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
    case "dejavu serif":
      return `"DejaVu Serif", Tinos, "Times New Roman", serif`;
    case "dejavu sans":
      return `"DejaVu Sans", Arial, Helvetica, sans-serif`;
    default:
      return texOrGenericStack(name);
  }
}

/** LaTeX faces get the Latin Modern stacks (the sans check comes first: "Computer Modern Sans" is sans). */
function texOrGenericStack(name: string): string {
  const lower = name.toLowerCase();
  if (TEX_SANS.test(lower)) return LATIN_MODERN_SANS;
  if (TEX_SERIF.test(lower)) return LATIN_MODERN_SERIF;
  const quoted = `"${name.replace(/["\\]/g, "\\$&")}"`;
  return `${quoted}, ${isSerifFamily(name) ? "serif" : "sans-serif"}`;
}
