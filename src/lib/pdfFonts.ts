import { Font } from "@react-pdf/renderer";
import { isSansFamily, isSerifFamily, isTexSerifFamily } from "./doc/fonts";

/**
 * The PDF resume uses Carlito (the metric-compatible stand-in for Calibri, see src/app/fonts.css) for Calibri and
 * for unknown sans families, CMU Serif (Computer Modern, the face of LaTeX's Latin Modern) for the LaTeX serif
 * families, DejaVu Serif and DejaVu Sans for the families of those names (imported resumes name them, and the PDF
 * must match the original's wrapping), and the built-in PDF Times and Helvetica for the others.
 * @react-pdf/renderer can only use fonts it is given as files (ttf or woff, not woff2), so the web faces are
 * registered here once.
 */
type WebFace = "carlito" | "dejavuSerif" | "dejavuSans" | "cmuSerif";

/**
 * The family each web face is registered under, its file prefix in public/fonts (400, 400-italic, 700, 700-italic)
 * and the file type react-pdf reads: woff for the DejaVu and Carlito files, ttf for CMU Serif.
 */
const WEB_FACES: Record<WebFace, { family: string; file: string; ext: "woff" | "ttf" }> = {
  carlito: { family: "Carlito", file: "carlito", ext: "woff" },
  dejavuSerif: { family: "DejaVu Serif", file: "dejavu-serif", ext: "woff" },
  dejavuSans: { family: "DejaVu Sans", file: "dejavu-sans", ext: "woff" },
  cmuSerif: { family: "CMU Serif", file: "cmu-serif", ext: "ttf" },
};

let registered = false;

/** Absolute URL in the browser (the PDF is built client-side); a file path on the server. */
function fontSrc(file: string): string {
  if (typeof window !== "undefined") return `${window.location.origin}/fonts/${file}`;
  return `${process.cwd()}/public/fonts/${file}`;
}

/** Idempotent: safe to call before every render. */
export function registerPdfFonts(): void {
  if (registered) return;
  registered = true;
  for (const { family, file, ext } of Object.values(WEB_FACES)) {
    Font.register({
      family,
      fonts: [
        { src: fontSrc(`${file}-400.${ext}`), fontWeight: 400 },
        { src: fontSrc(`${file}-400-italic.${ext}`), fontWeight: 400, fontStyle: "italic" },
        { src: fontSrc(`${file}-700.${ext}`), fontWeight: 700 },
        { src: fontSrc(`${file}-700-italic.${ext}`), fontWeight: 700, fontStyle: "italic" },
      ],
    });
  }
  // Never split a word across lines in the PDF (ATS-friendly, and keeps Calibri-like wrapping).
  Font.registerHyphenationCallback((word) => [word]);
}

/** Style props for one run in @react-pdf: a registered family with weight/style, or a built-in face by its name. */
export type PdfFont = { fontFamily: string; fontWeight?: 700; fontStyle?: "italic" };

type BuiltInFace = "times" | "helvetica";
type FaceKind = WebFace | BuiltInFace;

/** Which PDF face a document family maps to (see the file comment). The DejaVu names come first: "DejaVu Sans" is sans. */
export function pdfFaceKind(family: string | null): FaceKind {
  const name = (family ?? "").trim().toLowerCase();
  if (name === "dejavu serif") return "dejavuSerif";
  if (name === "dejavu sans") return "dejavuSans";
  if (name === "arial" || name === "helvetica" || isSansFamily(name)) return "helvetica";
  if (isTexSerifFamily(name)) return "cmuSerif";
  if (name && name !== "calibri" && isSerifFamily(name)) return "times";
  return "carlito";
}

const BUILT_IN: Record<BuiltInFace, [regular: string, bold: string, italic: string, boldItalic: string]> = {
  times: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
  helvetica: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
};

/** The PDF font for a document family with bold and italic: the style props to spread on a Text. */
export function pdfFontFor(family: string | null, bold: boolean, italic: boolean): PdfFont {
  const kind = pdfFaceKind(family);
  if (kind === "times" || kind === "helvetica") {
    const [regular, boldName, italicName, boldItalic] = BUILT_IN[kind];
    return { fontFamily: bold ? (italic ? boldItalic : boldName) : italic ? italicName : regular };
  }
  return {
    fontFamily: WEB_FACES[kind].family,
    ...(bold ? { fontWeight: 700 as const } : {}),
    ...(italic ? { fontStyle: "italic" as const } : {}),
  };
}
