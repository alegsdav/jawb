import { Font } from "@react-pdf/renderer";
import { WEB_FACES } from "./pdfFaces";

export { pdfFaceKind, pdfFontFor, type FaceKind, type PdfFont } from "./pdfFaces";

let registered = false;

/** Absolute URL in the browser (the PDF is built client-side); a file path on the server. */
function fontSrc(file: string): string {
  if (typeof window !== "undefined") return `${window.location.origin}/fonts/${file}`;
  return `${process.cwd()}/public/fonts/${file}`;
}

/**
 * Idempotent: safe to call before every render. @react-pdf/renderer can only use fonts it is given as files
 * (ttf or woff, not woff2), so the web faces (pdfFaces.ts) are registered here once.
 */
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
