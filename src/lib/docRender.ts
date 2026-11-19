/**
 * The resume document laid out for display: blocks, lines and runs with their final font, size, alignment,
 * indents and list markers. The read-only page (ResumeView) and the PDF (ResumePdf) both draw this model, so
 * they match each other and the editor. Pure: no DOM and no PDF library.
 */
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE_PT,
  DEFAULT_LINE_HEIGHT,
  PAGE_DEFAULTS,
  type DocInline,
  type DocJSON,
  type DocList,
  type DocMark,
  type DocParagraph,
  type PageSetup,
} from "./doc/types";

/** Left indent of each list level: a quarter inch. */
export const LIST_INDENT_PT = 18;
const BULLETS = ["•", "◦", "▪"];

export type RunStyle = { bold: boolean; italic: boolean; underline: boolean; sizePt: number; fontFamily: string };
export type Run = { text: string; style: RunStyle };
/** One visual line (a hard break starts a new one). With a tab, `right` is the text after the first tab. */
export type RenderLine = { left: Run[]; right: Run[] | null };
/** A bullet or number at x (points from the left margin); the paragraph's text starts at textIndentPt. */
export type RenderMarker = { text: string; x: number; style: RunStyle };
export type RenderParagraph = {
  kind: "paragraph";
  align: "left" | "center" | "right" | "justify";
  spaceBeforePt: number;
  spaceAfterPt: number;
  /** Line spacing multiplier. */
  lineHeight: number;
  /** A thin full-width rule under the paragraph. */
  rule: boolean;
  /** Left edge of the text in points (list levels indent it). */
  textIndentPt: number;
  marker: RenderMarker | null;
  lines: RenderLine[];
};
export type RenderRule = { kind: "rule" };
export type RenderBlock = RenderParagraph | RenderRule;

const DEFAULT_STYLE: RunStyle = {
  bold: false,
  italic: false,
  underline: false,
  sizePt: DEFAULT_FONT_SIZE_PT,
  fontFamily: DEFAULT_FONT_FAMILY,
};

/** The page setup of a resume (PAGE_DEFAULTS when it has none). */
export const pageOf = (r: { page?: PageSetup }): PageSetup => r.page ?? PAGE_DEFAULTS;

/** Run style from its marks; anything not set keeps the document default. */
export function styleOf(marks: DocMark[] | undefined): RunStyle {
  const style = { ...DEFAULT_STYLE };
  for (const m of marks ?? []) {
    if (m.type === "bold") style.bold = true;
    else if (m.type === "italic") style.italic = true;
    else if (m.type === "underline") style.underline = true;
    else if (m.type === "textStyle") {
      const pt = parseFloat(m.attrs?.fontSize ?? "");
      if (Number.isFinite(pt)) style.sizePt = pt;
      if (m.attrs?.fontFamily) style.fontFamily = m.attrs.fontFamily;
    }
  }
  return style;
}

/** Lines of a paragraph: split at hard breaks, and each line at its first tab (text after a second tab joins the right). */
function linesOf(content: DocInline[] | undefined): RenderLine[] {
  const lines: RenderLine[] = [];
  let cur: RenderLine = { left: [], right: null };
  for (const n of content ?? []) {
    if (n.type === "hardBreak") {
      lines.push(cur);
      cur = { left: [], right: null };
    } else if (n.type === "tab") {
      cur.right ??= [];
    } else if (n.text) {
      (cur.right ?? cur.left).push({ text: n.text, style: styleOf(n.marks) });
    }
  }
  lines.push(cur);
  return lines.map((l) => ({ left: l.left, right: l.right?.length ? l.right : null }));
}

/** Position of a paragraph inside a list: its level (1 = top), its type, and whether it is the item's first paragraph. */
type ListPos = { depth: number; ordered: boolean; bullet: boolean; number: number };

function markerText(list: ListPos): string {
  return list.ordered ? `${list.number}.` : BULLETS[Math.min(list.depth, BULLETS.length) - 1];
}

/**
 * A left-aligned list paragraph hangs its marker in the indent before the text. A centered or right-aligned bullet
 * puts the marker inline before the text, with one normal space, and takes no indent.
 */
function paragraphBlock(p: DocParagraph, list: ListPos | null): RenderParagraph {
  const a = p.attrs;
  const align = a?.textAlign ?? "left";
  const inline = align === "center" || align === "right";
  const lines = linesOf(p.content);
  const firstRun = lines.flatMap((l) => [...l.left, ...(l.right ?? [])])[0];
  const style = firstRun?.style ?? DEFAULT_STYLE;

  let marker: RenderMarker | null = null;
  if (list?.bullet) {
    const text = markerText(list);
    if (inline) lines[0].left.unshift({ text: `${text} `, style });
    else marker = { text, x: (list.depth - 1) * LIST_INDENT_PT, style };
  }
  // An empty line still takes one line of height, like a blank line in a document.
  for (const l of lines) {
    if (!l.left.length && !l.right) l.left.push({ text: " ", style });
  }

  const indented = list !== null && !inline;
  return {
    kind: "paragraph",
    align,
    spaceBeforePt: a?.spaceBefore ?? 0,
    spaceAfterPt: a?.spaceAfter ?? 0,
    lineHeight: a?.lineHeight ?? DEFAULT_LINE_HEIGHT,
    rule: a?.borderBottom === true,
    textIndentPt: indented ? list.depth * LIST_INDENT_PT : 0,
    marker,
    lines,
  };
}

/** A list's items in order, nested lists one level deeper. Only an item's first paragraph carries the marker. */
function walkList(list: DocList, depth: number, out: RenderBlock[]): void {
  const start = list.type === "orderedList" ? (list.attrs?.start ?? 1) : 1;
  list.content.forEach((item, i) => {
    item.content.forEach((child, j) => {
      if (child.type === "paragraph") {
        const pos = { depth, ordered: list.type === "orderedList", bullet: j === 0, number: start + i };
        out.push(paragraphBlock(child, pos));
      } else {
        walkList(child, depth + 1, out);
      }
    });
  });
}

/** The document as display blocks, in order. */
export function renderBlocks(doc: DocJSON): RenderBlock[] {
  const out: RenderBlock[] = [];
  for (const b of doc.content ?? []) {
    if (b.type === "paragraph") out.push(paragraphBlock(b, null));
    else if (b.type === "horizontalRule") out.push({ kind: "rule" });
    else walkList(b, 1, out);
  }
  return out;
}
