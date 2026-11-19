/**
 * The resume document (resume version 4): a plain rich-text document, like a Google Doc. It is the source of
 * truth for what the resume says and how it looks. There are no sections, line kinds or required spacing:
 * every paragraph is just a paragraph (optionally inside a bullet or numbered list) with explicit formatting.
 *
 * The JSON is TipTap's document JSON for the extensions in src/lib/doc/extensions.ts, so the editor reads and
 * writes it directly, and the read-only view, the PDF, the importers and the AI helpers read the same JSON.
 *
 * The AI features still need to know what is a "bullet", an "entry" or a "section heading". That is DERIVED
 * from the document by outlineFromDoc (src/lib/doc/outline.ts) and cached on the Resume as `header` +
 * `sections` (see withDoc in src/lib/resume.ts). The derived ids are paragraph ids, so AI feedback, facts and
 * the "changed from master" baseline stay attached to the paragraph they were about.
 */

/** Inline marks. textStyle carries the font size ("11pt") and font family ("Calibri"); absent = document default. */
export type DocMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "underline" }
  | { type: "textStyle"; attrs: { fontSize?: string | null; fontFamily?: string | null } }
  /** A hyperlink. href is always http(s): or mailto: (normalizeDoc drops anything else). */
  | { type: "link"; attrs: { href: string } };

export type DocText = { type: "text"; text: string; marks?: DocMark[] };
/**
 * A right-aligned tab: everything after it on the line is pushed to the right margin (how a resume puts the
 * location or dates on the right of "Company ⇥ City, ST"). At most one per paragraph is meaningful.
 */
export type DocTab = { type: "tab" };
/** A line break inside a paragraph (Shift+Enter). */
export type DocHardBreak = { type: "hardBreak" };
export type DocInline = DocText | DocTab | DocHardBreak;

/** Paragraph formatting. null / absent = default (left aligned, no extra space, single (1.15) spacing, no rule). */
export type ParagraphAttrs = {
  /** Stable unique id (8+ chars). Assigned automatically to every paragraph; never shown. */
  id: string;
  textAlign?: "left" | "center" | "right" | "justify" | null;
  /** Extra space above / below the paragraph, in points. */
  spaceBefore?: number | null;
  spaceAfter?: number | null;
  /** Line spacing multiplier (1, 1.15, 1.5, 2). null = 1.15. */
  lineHeight?: number | null;
  /**
   * A thin full-width line under the paragraph (Docs: paragraph border bottom). A horizontal line is an empty
   * paragraph with this set: there is no separate rule node, so every merge and save keeps it.
   */
  borderBottom?: boolean | null;
};

export type DocParagraph = { type: "paragraph"; attrs: ParagraphAttrs; content?: DocInline[] };
export type DocListItem = { type: "listItem"; content: (DocParagraph | DocList)[] };
export type DocList =
  | { type: "bulletList"; content: DocListItem[] }
  | { type: "orderedList"; attrs?: { start?: number; type?: string | null }; content: DocListItem[] };
export type DocBlock = DocParagraph | DocList;
export type DocJSON = { type: "doc"; content: DocBlock[] };

/** Page setup, in inches. Letter size. Defaults: PAGE_DEFAULTS. */
export type PageSetup = { marginTop: number; marginBottom: number; marginLeft: number; marginRight: number };

export const PAGE_DEFAULTS: PageSetup = { marginTop: 0.5, marginBottom: 0.5, marginLeft: 0.6, marginRight: 0.6 };
/** Document defaults: text without a fontFamily / fontSize mark uses these. */
export const DEFAULT_FONT_FAMILY = "Calibri";
export const DEFAULT_FONT_SIZE_PT = 11;
export const DEFAULT_LINE_HEIGHT = 1.15;

/**
 * A paragraph in document order with where it sits (the flat view every helper works on).
 * listType/depth describe the nearest list it is in (depth 1 = top-level list item, 0 = not in a list).
 * `bullet` is true for the FIRST paragraph of a list item (that is the line with the bullet / number).
 */
export type FlatParagraph = {
  id: string;
  node: DocParagraph;
  /** Plain text; a tab is "\t", a hard break is "\n". */
  text: string;
  listType: "bulletList" | "orderedList" | null;
  depth: number;
  bullet: boolean;
};
