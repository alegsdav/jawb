import { isSansFamily, isSerifFamily, isTexSerifFamily } from "./doc/fonts";

/**
 * The PDF resume uses Carlito (the metric-compatible stand-in for Calibri, see src/app/fonts.css) for Calibri and
 * for unknown sans families, CMU Serif (Computer Modern, the face of LaTeX's Latin Modern) for the LaTeX serif
 * families, DejaVu Serif and DejaVu Sans for the families of those names (imported resumes name them, and the PDF
 * must match the original's wrapping), and the built-in PDF Times and Helvetica for the others.
 * This file is pure: the .docx importer imports it through pdfTextWidths, so it must not pull in @react-pdf/renderer
 * (pdfFonts.ts registers the files with that library).
 */
export type WebFace = "carlito" | "dejavuSerif" | "dejavuSans" | "cmuSerif";

/**
 * The family each web face is registered under, its file prefix in public/fonts (400, 400-italic, 700, 700-italic)
 * and the file type react-pdf reads: woff for the DejaVu and Carlito files, ttf for CMU Serif.
 */
export const WEB_FACES: Record<WebFace, { family: string; file: string; ext: "woff" | "ttf" }> = {
  carlito: { family: "Carlito", file: "carlito", ext: "woff" },
  dejavuSerif: { family: "DejaVu Serif", file: "dejavu-serif", ext: "woff" },
  dejavuSans: { family: "DejaVu Sans", file: "dejavu-sans", ext: "woff" },
  cmuSerif: { family: "CMU Serif", file: "cmu-serif", ext: "ttf" },
};

/** Style props for one run in @react-pdf: a registered family with weight/style, or a built-in face by its name. */
export type PdfFont = { fontFamily: string; fontWeight?: 700; fontStyle?: "italic" };

type BuiltInFace = "times" | "helvetica";
export type FaceKind = WebFace | BuiltInFace;

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
