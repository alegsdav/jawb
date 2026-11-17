import { Font } from "@react-pdf/renderer";

/**
 * The PDF resume is set in Carlito, the metric-compatible stand-in for Calibri (see src/app/fonts.css).
 * @react-pdf/renderer can only use fonts it is given as files, so they are registered here once.
 */
export const PDF_FONT = "Carlito";

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
    family: PDF_FONT,
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
