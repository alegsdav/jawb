/**
 * The Harvard look for a resume made by the builder: paragraph builders for the document, and the page setup.
 * Nothing reads this at display time: every paragraph carries its own font, size, tab stops and rules, and the
 * user can change any of it like in any document.
 *
 * TEMPLATE below is the look of version 2-3 resumes. It is LEGACY: only normalizeResume (resume.ts) reads it, to
 * migrate old data. Nothing new should use it.
 */
import { newId, type FlatEntry } from "./doc/model";
import type { DocInline, DocMark, DocParagraph, PageSetup, ParagraphAttrs } from "./doc/types";
import type { Format } from "./richText";
import type { Para } from "./types";

const HARVARD_FONT = "Times New Roman";

/** 0.5 in top and bottom, 0.75 in left and right. */
export const HARVARD_PAGE: PageSetup = { marginTop: 0.5, marginBottom: 0.5, marginLeft: 0.75, marginRight: 0.75 };

/** A run of text in one style. A "\t" in the text is a tab stop (the right-aligned part of a line). */
type Part = { text: string; bold?: boolean; italic?: boolean };

const runMarks = (part: Part, size: number): DocMark[] => [
  ...(part.bold ? [{ type: "bold" as const }] : []),
  ...(part.italic ? [{ type: "italic" as const }] : []),
  { type: "textStyle", attrs: { fontFamily: HARVARD_FONT, fontSize: `${size}pt` } },
];

/** One paragraph of Harvard text at `size` points, from its runs. */
function line(parts: Part[], size: number, attrs: Partial<ParagraphAttrs> = {}, id = newId()): DocParagraph {
  const content: DocInline[] = [];
  for (const part of parts) {
    part.text.split("\t").forEach((piece, i) => {
      if (i > 0) content.push({ type: "tab" });
      if (piece) content.push({ type: "text", text: piece, marks: runMarks(part, size) });
    });
  }
  const node: DocParagraph = { type: "paragraph", attrs: { ...attrs, id } };
  if (content.length) node.content = content;
  return node;
}

/** A paragraph outside any list. */
const block = (node: DocParagraph): FlatEntry => ({ node, listType: null, depth: 0, bullet: false });

/** The tab that puts the right-hand text at the right margin. Always present, so the line never reads as a heading. */
const tabbed = (right: string): Part[] => [{ text: "\t" }, { text: right }];

type LineOpts = { id?: string; spaceBefore?: number };
const spacing = (opts: LineOpts): Partial<ParagraphAttrs> => (opts.spaceBefore ? { spaceBefore: opts.spaceBefore } : {});

/** The name, 16pt bold, centered. */
export const harvardName = (text: string): FlatEntry => block(line([{ text, bold: true }], 16, { textAlign: "center" }));

/** The contact line, 10.5pt, centered. */
export const harvardContact = (text: string): FlatEntry => block(line([{ text }], 10.5, { textAlign: "center" }));

/** A section heading: 11pt bold capitals, with a rule under it. */
export const harvardHeading = (text: string): FlatEntry =>
  block(line([{ text: text.toUpperCase(), bold: true }], 11, { borderBottom: true, spaceBefore: 10 }));

/** An entry line: the organization (bold), then the location at the right margin. */
export const harvardEntry = (left: string, right: string, opts: LineOpts = {}): FlatEntry =>
  block(line([{ text: left, bold: true }, ...tabbed(right)], 11, spacing(opts), opts.id));

/** A role line under an entry: the role (italic), then the dates at the right margin. */
export const harvardRole = (left: string, right: string): FlatEntry => block(line([{ text: left, italic: true }, ...tabbed(right)], 11));

/** A bullet of the document's bulleted list (depth 1). */
export const harvardBullet = (text: string): FlatEntry => ({
  node: line([{ text }], 11),
  listType: "bulletList",
  depth: 1,
  bullet: true,
});

/** A "Label: value" line (skills), with the label in bold. */
export const harvardLabelLine = (label: string, value: string, opts: LineOpts = {}): FlatEntry =>
  block(line([{ text: `${label}: `, bold: true }, { text: value }], 11, spacing(opts)));

// ---- legacy (versions 2-3 only; read by normalizeResume) ----

type Look = { format: Format; para: Para };

export const TEMPLATE = {
  name: { format: { bold: true, size: 16 }, para: { align: "center" } } satisfies Look,
  contact: { format: { size: 10 }, para: { align: "center" } } satisfies Look,
  heading: { format: { bold: true }, para: { rule: true, caps: true, spaceBefore: 6 } } satisfies Look,
  entry: { para: { spaceBefore: 3 } } satisfies { para: Para },
};
