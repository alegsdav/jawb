/**
 * The resume document laid out for display: blocks, lines and runs with their final font, size, alignment,
 * indents and list markers. The read-only page (ResumeView) and the PDF (ResumePdf) both draw this model, so
 * they match each other and the editor. Pure: no DOM and no PDF library.
 */
import { normalizeHref } from "./doc/model";
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
/** A run of text; href is set when a link mark covers it (http(s) or mailto). */
export type Run = { text: string; style: RunStyle; href?: string; tab?: true };
/**
 * One visual line (a hard break starts a new one). `left` holds `tab` runs for the earlier tabs (0.5in stops); with a
 * tab, `right` is the text after the last tab, right-aligned.
 */
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
  /** A thin full-width rule under the paragraph (an empty paragraph with a bottom border is a horizontal line). */
  rule: boolean;
  /** Left edge of the text in points (list levels indent it). */
  textIndentPt: number;
  /** The bullet or number of a list item's first paragraph. */
  marker: RenderMarker | null;
  /** True for a centered or right-aligned marker: it goes inline before the first line's text (see linesWithMarker). */
  markerInline: boolean;
  lines: RenderLine[];
};

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

/** The href of a link mark, if the marks carry one; checked again here (http(s)/mailto only) before anything renders it. */
function hrefOfMarks(marks: DocMark[] | undefined): string | undefined {
  const raw = marks?.find((m): m is Extract<DocMark, { type: "link" }> => m.type === "link")?.attrs.href;
  return raw ? normalizeHref(raw) ?? undefined : undefined;
}

/** Page geometry in px at 96dpi, as the editor draws it. */
export const PX_PER_IN = 96;
export const PAGE_HEIGHT_IN = 11;

/** Default tab stops, every 0.5in (at 96dpi). */
export const TAB_STOP_PX = 48;
/** A tab that would advance less than this skips to the following stop, so the gap is never a sliver. */
const MIN_TAB_PX = 8;

/**
 * The width of an earlier tab (an indent) that starts `offset` px from the line's content left: it ends on the next
 * 0.5in stop. The one stop rule shared by the editor, the read-only page and the PDF.
 */
export function tabGapPx(offset: number): number {
  const into = ((offset % TAB_STOP_PX) + TAB_STOP_PX) % TAB_STOP_PX;
  const w = TAB_STOP_PX - into;
  return Math.round(w < MIN_TAB_PX ? w + TAB_STOP_PX : w);
}

/**
 * The gaps of a line given the widths (px) of the parts between its earlier tabs: part i ends at the running x, and
 * the tab after it advances to the next stop. Returns one gap per tab (parts.length - 1).
 */
export function tabGapsPx(partWidths: number[]): number[] {
  const gaps: number[] = [];
  let x = 0;
  for (const w of partWidths.slice(0, -1)) {
    x += w;
    const gap = tabGapPx(x);
    gaps.push(gap);
    x += gap;
  }
  return gaps;
}

/** A line's runs split at its earlier tabs: the parts before, between and after them (one part without tabs). */
export function splitAtTabs(runs: Run[]): Run[][] {
  const parts: Run[][] = [[]];
  for (const r of runs) {
    if (r.tab) parts.push([]);
    else parts[parts.length - 1].push(r);
  }
  return parts;
}

/**
 * The top of the first line that does not fit on page 1, or null when all lines fit. A line that straddles the
 * bottom of the text area moves to page 2 whole, so its top is where page 2 starts. `pageBottom` is the bottom
 * edge of the text area in px from the page top.
 */
export function firstLineOnNextPage(lines: { top: number; bottom: number }[], pageBottom: number): number | null {
  const over = lines.filter((l) => l.bottom > pageBottom);
  return over.length ? Math.min(...over.map((l) => l.top)) : null;
}

/**
 * Lines of a paragraph: split at hard breaks, and each line at its LAST tab, which right-aligns what follows (the
 * editor's rule, see layoutTabs). An earlier tab is a `tab` run: an indent to the next 0.5in stop (tabGapPx).
 */
function linesOf(content: DocInline[] | undefined): RenderLine[] {
  const groups: DocInline[][] = [[]];
  for (const n of content ?? []) {
    if (n.type === "hardBreak") groups.push([]);
    else groups[groups.length - 1].push(n);
  }
  return groups.map((items) => {
    const last = items.map((n) => n.type).lastIndexOf("tab");
    const left: Run[] = [];
    const right: Run[] = [];
    items.forEach((n, i) => {
      const into = last >= 0 && i > last ? right : left;
      if (n.type === "tab") {
        if (i !== last) into.push({ text: "", style: styleOf(undefined), tab: true });
      } else if (n.type === "text" && n.text) {
        const run: Run = { text: n.text, style: styleOf(n.marks) };
        const href = hrefOfMarks(n.marks);
        if (href) run.href = href;
        into.push(run);
      }
    });
    return { left, right: right.length ? right : null };
  });
}

/** Position of a paragraph inside a list: its level (1 = top), its type, and whether it is the item's first paragraph. */
type ListPos = { depth: number; ordered: boolean; bullet: boolean; number: number };

function markerText(list: ListPos): string {
  return list.ordered ? `${list.number}.` : BULLETS[Math.min(list.depth, BULLETS.length) - 1];
}

/**
 * A left-aligned list paragraph hangs its marker in the indent before the text. A centered or right-aligned bullet
 * is marked inline (see linesWithMarker) and takes no indent.
 */
function paragraphBlock(p: DocParagraph, list: ListPos | null): RenderParagraph {
  const a = p.attrs;
  const align = a?.textAlign ?? "left";
  const inline = align === "center" || align === "right";
  const lines = linesOf(p.content);
  const firstRun = lines.flatMap((l) => [...l.left, ...(l.right ?? [])])[0];
  const style = firstRun?.style ?? DEFAULT_STYLE;

  // An empty line still takes one line of height, like a blank line in a document.
  for (const l of lines) {
    if (!l.left.length && !l.right) l.left.push({ text: " ", style });
  }

  const level = list && !inline ? list.depth : 0;
  return {
    kind: "paragraph",
    align,
    spaceBeforePt: a?.spaceBefore ?? 0,
    spaceAfterPt: a?.spaceAfter ?? 0,
    lineHeight: a?.lineHeight ?? DEFAULT_LINE_HEIGHT,
    rule: a?.borderBottom === true,
    textIndentPt: level * LIST_INDENT_PT,
    marker: list?.bullet ? { text: markerText(list), x: Math.max(0, level - 1) * LIST_INDENT_PT, style } : null,
    markerInline: list?.bullet === true && inline,
    lines,
  };
}

/** The marker drawn hanging in the indent (null when it is inline or absent). */
export function hangingMarkerOf(p: RenderParagraph): RenderMarker | null {
  return p.markerInline ? null : p.marker;
}

/**
 * The lines with an inline marker put before the first line's text, with one normal space after it. `glyph` maps
 * the marker to what the target can draw.
 */
export function linesWithMarker(p: RenderParagraph, glyph: (text: string) => string = (t) => t): RenderLine[] {
  if (!p.markerInline || !p.marker) return p.lines;
  const [first, ...rest] = p.lines;
  const marker = { text: `${glyph(p.marker.text)} `, style: p.marker.style };
  return [{ ...first, left: [marker, ...first.left] }, ...rest];
}

/** A list's items in order, nested lists one level deeper. Only an item's first paragraph carries the marker. */
function walkList(list: DocList, depth: number, out: RenderParagraph[]): void {
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

/** The document as display paragraphs, in order. A horizontal line is a paragraph with `rule` set. */
export function renderBlocks(doc: DocJSON): RenderParagraph[] {
  const out: RenderParagraph[] = [];
  for (const b of doc.content ?? []) {
    if (b.type === "paragraph") out.push(paragraphBlock(b, null));
    else walkList(b, 1, out);
  }
  return out;
}
