/**
 * The Harvard look, as a template. It is applied when a resume is created (builder), imported (AI
 * parse) or migrated from version 2 (normalizeResume). Nothing reads it at display time: once applied,
 * the formatting is explicit data on the resume (marks/para), and the user can change any of it like in
 * a text editor.
 */
import type { Format } from "./richText";
import type { Para } from "./types";

type Look = { format: Format; para: Para };

export const TEMPLATE = {
  name: { format: { bold: true, size: 16 }, para: { align: "center" } } satisfies Look,
  contact: { format: { size: 10 }, para: { align: "center" } } satisfies Look,
  heading: { format: { bold: true }, para: { rule: true, caps: true, spaceBefore: 6 } } satisfies Look,
  entry: { para: { spaceBefore: 3 } } satisfies { para: Para },
};

/**
 * Whether an imported resume gets the template. Pasted text and uploaded .txt/.md files do (the AI output
 * is plain, so the Harvard look is applied to it); an uploaded PDF does not, and comes in as plain text the
 * user formats. A later "reformat to our template" button can apply the template on demand.
 */
export const templateForImport = (source: "pdf" | "text") => source === "text";
