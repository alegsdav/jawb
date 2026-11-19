import { Font } from "@react-pdf/renderer";
import { isSansFamily, isSerifFamily } from "./doc/fonts";

/**
 * The PDF resume uses Carlito (the metric-compatible stand-in for Calibri, see src/app/fonts.css) for Calibri and
 * for unknown sans families, and the built-in PDF Times and Helvetica for the others. @react-pdf/renderer can only
 * use fonts it is given as files, so Carlito is registered here once.
 */
const CARLITO = "Carlito";

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
  Font.register({
    family: CARLITO,
    fonts: [
      { src: fontSrc("carlito-400.woff"), fontWeight: 400 },
      { src: fontSrc("carlito-400-italic.woff"), fontWeight: 400, fontStyle: "italic" },
      { src: fontSrc("carlito-700.woff"), fontWeight: 700 },
      { src: fontSrc("carlito-700-italic.woff"), fontWeight: 700, fontStyle: "italic" },
    ],
  });
  // Never split a word across lines in the PDF (ATS-friendly, and keeps Calibri-like wrapping).
  Font.registerHyphenationCallback((word) => [word]);
}

/** Style props for one run in @react-pdf: a registered family with weight/style, or a built-in face by its name. */
export type PdfFont = { fontFamily: string; fontWeight?: 700; fontStyle?: "italic" };

type FaceKind = "carlito" | "helvetica" | "times";

/** Which PDF face a document family maps to (see the file comment). */
export function pdfFaceKind(family: string | null): FaceKind {
  const name = (family ?? "").trim().toLowerCase();
  if (name === "arial" || name === "helvetica" || isSansFamily(name)) return "helvetica";
  if (name && name !== "calibri" && isSerifFamily(name)) return "times";
  return "carlito";
}

const BUILT_IN: Record<Exclude<FaceKind, "carlito">, [regular: string, bold: string, italic: string, boldItalic: string]> = {
  times: ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
  helvetica: ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"],
};

/** The PDF font for a document family with bold and italic: the style props to spread on a Text. */
export function pdfFontFor(family: string | null, bold: boolean, italic: boolean): PdfFont {
  const kind = pdfFaceKind(family);
  if (kind !== "carlito") {
    const [regular, boldName, italicName, boldItalic] = BUILT_IN[kind];
    return { fontFamily: bold ? (italic ? boldItalic : boldName) : italic ? italicName : regular };
  }
  return {
    fontFamily: CARLITO,
    ...(bold ? { fontWeight: 700 as const } : {}),
    ...(italic ? { fontStyle: "italic" as const } : {}),
  };
}
