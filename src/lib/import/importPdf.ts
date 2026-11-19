/**
 * Browser entry for PDF import: the PDF is read on the user's machine, so nothing is uploaded. Loaded on demand
 * (the import UI prefetches it) so pdf.js stays out of the pages' first bundle.
 */
import type { Resume } from "@/lib/types";
import { withPdfWorker } from "@/lib/import/pdfWorker";
import { resumeFromPdf } from "@/lib/import/resumeFromPdf";

export { NoTextError } from "@/lib/import/pdfToDoc";

export async function importPdfInBrowser(file: File): Promise<Resume> {
  const data = new Uint8Array(await file.arrayBuffer());
  return withPdfWorker(() => resumeFromPdf(data));
}
