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

/** Latin Modern is named first (when installed); CMU Serif, the same design, is the loaded web face (src/app/fonts.css). */
const LATIN_MODERN_SERIF = `"Latin Modern Roman", "LM Roman 10", "CMU Serif", Tinos, "Times New Roman", serif`;
const LATIN_MODERN_SANS = `"Latin Modern Sans", "LM Sans 10", "CMU Sans Serif", Arial, Helvetica, sans-serif`;

/** True for a LaTeX serif face by name, not a sans one: "Latin Modern Roman", "LMRoman12", "CMR10", "CMU Serif". */
export function isTexSerifFamily(family: string): boolean {
  const name = family.toLowerCase();
  return !isSansFamily(name) && TEX_SERIF.test(name);
}

/** True for sans-serif families, by name ("Verdana Sans", "Open Sans") or LaTeX sans naming. */
export function isSansFamily(family: string): boolean {
  const name = family.toLowerCase();
  return name.includes("sans") || TEX_SANS.test(name);
}

/** A rough guess from the family name: serif when it looks like a serif face and is not a sans one. */
export function isSerifFamily(family: string): boolean {
  const name = family.toLowerCase();
  if (isSansFamily(name)) return false;
  return isTexSerifFamily(name) || SERIF_HINTS.some((hint) => name.includes(hint));
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

/**
 * Word's single line height as a multiple of the font size, per family (ascent + descent + line gap, over the em).
 * Word sets a "single" line with this, so a CSS line-height that matches it gives the same line pitch as Word.
 */
const WORD_SINGLE_LINE = new Map<string, number>([
  ["calibri", 1.2207], ["carlito", 1.2207], ["calibri light", 1.2207],
  ["arial", 1.1499], ["helvetica", 1.1499], ["arimo", 1.1499], ["liberation sans", 1.1499],
  ["times new roman", 1.1499], ["times", 1.1499], ["tinos", 1.1499], ["liberation serif", 1.1499],
  ["georgia", 1.1362], ["garamond", 1.1235], ["eb garamond", 1.1235], ["cambria", 1.1719], ["aptos", 1.2],
  ["verdana", 1.2153], ["tahoma", 1.2071], ["trebuchet ms", 1.1611], ["segoe ui", 1.3301],
  ["book antiqua", 1.1328], ["palatino", 1.1328], ["palatino linotype", 1.1328], ["century gothic", 1.2251],
  ["gill sans mt", 1.1499], ["franklin gothic book", 1.1338], ["lato", 1.2], ["open sans", 1.3618],
  ["roboto", 1.1719], ["helvetica neue", 1.2],
]);

/** Word's single line height for a family (see WORD_SINGLE_LINE). LaTeX faces are 1.2; unknown families 1.17. */
export function wordSingleLineFactor(family: string | null | undefined): number {
  const name = (family ?? "").trim().toLowerCase();
  const known = WORD_SINGLE_LINE.get(name);
  if (known !== undefined) return known;
  if (isTexSerifFamily(name) || TEX_SANS.test(name)) return 1.2;
  return 1.17;
}
