import { flattenDoc } from "@/lib/doc/model";
import type { DocJSON } from "@/lib/doc/types";
import { emptyResume, withDoc } from "@/lib/resume";
import { docxToDoc, DocxError } from "@/lib/import/docxToDoc";
import type { Resume } from "@/lib/types";

export const EMPTY_DOCX_MESSAGE = "Couldn't find any text in that file.";

const hasText = (doc: DocJSON) => flattenDoc(doc).some((p) => p.text.trim());

/**
 * A .docx as a version 4 resume: its document and page setup, no AI. Runs in the browser (nothing is uploaded).
 * Throws DocxError with a message to show when the file is not a readable .docx or has no text.
 */
export function resumeFromDocx(data: Uint8Array): Resume {
  const { doc, page } = docxToDoc(data);
  if (!hasText(doc)) throw new DocxError(EMPTY_DOCX_MESSAGE);
  return withDoc({ ...emptyResume(), page }, doc);
}
