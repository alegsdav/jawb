import { flattenDoc } from "@/lib/doc/model";
import type { DocJSON } from "@/lib/doc/types";
import { emptyResume, withDoc } from "@/lib/resume";
import { NoTextError, pdfToDoc } from "@/lib/import/pdfToDoc";
import type { Resume } from "@/lib/types";

export const EMPTY_PDF_MESSAGE = "Couldn't find any text in that file.";

const hasText = (doc: DocJSON) => flattenDoc(doc).some((p) => p.text.trim());

/**
 * A PDF as a version 4 resume: its document and page setup, no AI. Shared by the server route and the browser.
 * Throws NoTextError (with the message to show) when the PDF has no text.
 */
export async function resumeFromPdf(data: Uint8Array): Promise<Resume> {
  const { doc, page } = await pdfToDoc(data);
  if (!hasText(doc)) throw new NoTextError(EMPTY_PDF_MESSAGE);
  return withDoc({ ...emptyResume(), page }, doc);
}
