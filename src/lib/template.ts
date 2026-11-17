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
