/**
 * Reads a PDF into a resume document (version 4) without changing how it looks. No AI: the text runs keep their
 * font, size, bold and italic; the lines and columns come from where the text sits; the rules drawn under lines
 * become paragraph borders; the page margins come from the blank space around the text.
 *
 * It reads text PDFs (Word, Google Docs, LaTeX, this app's export). A scan has no text and is refused.
 * Best effort: anything odd (text boxes, columns, rotated text) comes out as plain paragraphs in reading order.
 */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import { buildDoc, newId, normalizeDoc, type FlatEntry } from "@/lib/doc/model";
import type { DocBlock, DocInline, DocJSON, DocMark, DocParagraph, PageSetup, ParagraphAttrs } from "@/lib/doc/types";

export const NO_TEXT_MESSAGE =
  "This PDF has no selectable text (it may be a scan). Export it again as a text PDF, or paste the text.";

/** The PDF has no text to import (a scan or an image-only page). */
export class NoTextError extends Error {
  constructor() {
    super(NO_TEXT_MESSAGE);
    this.name = "NoTextError";
  }
}

// Layout tolerances, in font sizes (em) or points.
const LINE_TOLERANCE = 0.3; // items this close vertically (in em) share a baseline
const SPACE_GAP = 0.15; // a horizontal gap wider than this is a space between words
const TAB_GAP = 3; // the first gap wider than this on a line is a tab (the "Company ⇥ City" layout)
const PITCH = 1.2; // a normal line pitch, in em
const WRAP_PITCH = 1.6; // a line this close below the previous one continues its paragraph
const MAX_SPACE_BEFORE = 24;
const RULE_MIN_WIDTH = 0.5; // a rule must span this share of the content width
const RULE_MAX_HEIGHT = 2.5; // points: a filled rectangle this thin is a rule
const PT_PER_INCH = 72;

/** Bullet glyphs (incl. the Symbol-font bullet and a middle dot) followed by a space, at the start of a line. */
const BULLET_RE = /^\s*[•●▪◦‣⁃·\-–*o§]\s+/;
/** Font names pdf.js invents for fonts it does not know (g_d0_f1). They say nothing about the family. */
const GENERATED_NAME = /^g_d\d+_f\d+$/;
const SUBSET_PREFIX = /^[A-Z]{6}\+/;
const STYLE_SUFFIX = /(Bold|Italic|Oblique|Regular|Semibold|Black|Heavy|Medium|Light|Demi)+$/;
const BOLD_NAME = /bold|black|heavy|semibold|demi/i;
const ITALIC_NAME = /italic|oblique/i;

export type FontInfo = { family?: string; bold: boolean; italic: boolean };

/**
 * The family, bold and italic of a PDF font from its name (e.g. "ABCDEF+Calibri-Bold", "TimesNewRomanPSMT",
 * "Garamond,BoldItalic") and its flags. The family drops the subset prefix, the style and the PostScript suffixes
 * and spaces camel case: "TimesNewRomanPSMT" is "Times New Roman". No family when the name is generated.
 */
export function fontInfo(rawName: string, flags: { bold?: boolean; italic?: boolean } = {}): FontInfo {
  const name = rawName.replace(SUBSET_PREFIX, "");
  const base = name.split(/[-,]/)[0].replace(/(PSMT|MT|PS)$/, "").replace(STYLE_SUFFIX, "");
  const family = base.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return {
    family: family && !GENERATED_NAME.test(name) ? family : undefined,
    bold: !!flags.bold || BOLD_NAME.test(name),
    italic: !!flags.italic || ITALIC_NAME.test(name),
  };
}

/** The look of a run of text: its font and size in points. */
type Style = FontInfo & { size: number };

/** A run of text on a line, with where it starts and how wide it is. A tab is the piece "\t". */
type Piece = { text: string; style: Style; x: number; w: number };

/** One text item from pdf.js, in top-down page coordinates. Whitespace-only items are kept for their gaps. */
type TextItem = { str: string; x: number; y: number; w: number; style: Style; ws: boolean };

/** A visual line: its baseline (top-down), its size and extent, and its pieces left to right. */
type Line = { y: number; size: number; x0: number; x1: number; pieces: Piece[] };

/** A horizontal rule drawn on the page, in top-down coordinates. */
type Rule = { y: number; x0: number; x1: number };

type PageText = { width: number; height: number; lines: Line[]; rules: Rule[] };

/** A paragraph being assembled from one line (a bullet or plain) and any wrapped lines that continue it. */
type Para = { bullet: boolean; lines: Line[]; pieces: Piece[]; textX: number; depth: number };

/** Paragraphs and rules in reading order, ready to become document blocks. */
type Item = { y: number; entry: FlatEntry } | { y: number; rule: true };

/**
 * The document and page setup of a PDF. Throws NoTextError when the PDF has no text.
 * Each page is read in order and the pages are concatenated.
 */
export async function pdfToDoc(data: Uint8Array): Promise<{ doc: DocJSON; page: PageSetup }> {
  const task = pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  try {
    const pdf = await task.promise;
    const pages: PageText[] = [];
    for (let i = 1; i <= pdf.numPages; i++) pages.push(await readPage(await pdf.getPage(i)));
    const lines = pages.flatMap((p) => p.lines);
    if (!lines.length) throw new NoTextError();
    const items = pages.flatMap((p) => pageItems(p));
    return { doc: docFromItems(items), page: pageSetupOf(pages) };
  } finally {
    await task.destroy();
  }
}

// ---- reading the page ----

async function readPage(page: PDFPageProxy): Promise<PageText> {
  const ops = await page.getOperatorList();
  const content = await page.getTextContent();
  const { width, height } = page.getViewport({ scale: 1 });
  const fonts = new Map<string, FontInfo>();
  const items: TextItem[] = [];
  for (const it of content.items) {
    if (!("str" in it) || !it.str) continue;
    const [, , c, d, x, y] = it.transform;
    const size = Math.hypot(c, d);
    if (!size) continue;
    if (!fonts.has(it.fontName)) fonts.set(it.fontName, fontOf(page, it.fontName));
    items.push({
      str: it.str,
      x,
      y: height - y,
      w: it.width,
      style: { ...fonts.get(it.fontName)!, size },
      ws: !it.str.trim(),
    });
  }
  // Rules come out in PDF space (y up), like the text transforms; flip them to top-down like the lines.
  const rules = rulesOf(ops).map((r) => ({ ...r, y: height - r.y }));
  return { width, height, lines: linesOf(items), rules };
}

/** The font's family and style. pdf.js knows the name of an embedded font; a standard font has only its loaded name. */
function fontOf(page: PDFPageProxy, name: string): FontInfo {
  if (!page.commonObjs.has(name)) return { bold: false, italic: false };
  const f = page.commonObjs.get(name) as { name?: string; loadedName?: string; bold?: boolean; italic?: boolean };
  return fontInfo(f.name || f.loadedName || "", { bold: f.bold, italic: f.italic });
}

/** Groups items into lines by baseline, each line's items left to right. */
function linesOf(items: TextItem[]): Line[] {
  const groups: TextItem[][] = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(it.y - g[0].y) <= LINE_TOLERANCE * it.style.size) g.push(it);
    else groups.push([it]);
  }
  return groups
    .filter((g) => g.some((it) => !it.ws))
    .map((g) => lineOf(g.sort((a, b) => a.x - b.x)));
}

/**
 * One line from its items. Between two words: a space when the gap is wide enough or a whitespace item sits
 * between them. The first wide gap is a tab; later wide gaps are spaces.
 */
function lineOf(items: TextItem[]): Line {
  const real = items.filter((it) => !it.ws);
  const size = Math.max(...real.map((it) => it.style.size));
  const pieces: Piece[] = [];
  let prev: TextItem | undefined;
  let spaced = false;
  let tabbed = false;
  for (const it of items) {
    if (it.ws) {
      spaced = true;
      continue;
    }
    if (prev) {
      const last = pieces[pieces.length - 1];
      const gap = it.x - (prev.x + prev.w);
      const gapStart = prev.x + prev.w;
      if (gap > TAB_GAP * size && !tabbed) {
        pieces.push({ text: "\t", style: last.style, x: gapStart, w: 0 });
        tabbed = true;
      } else if ((gap > SPACE_GAP * size || spaced) && !/\s$/.test(last.text) && !/^\s/.test(it.str)) {
        pieces.push({ text: " ", style: last.style, x: gapStart, w: 0 });
      }
    }
    pieces.push({ text: it.str, style: it.style, x: it.x, w: it.w });
    prev = it;
    spaced = false;
  }
  return {
    y: real[0].y,
    size,
    x0: Math.min(...real.map((it) => it.x)),
    x1: Math.max(...real.map((it) => it.x + it.w)),
    pieces,
  };
}

// ---- rules drawn on the page ----

/** A 2D affine matrix [a, b, c, d, e, f] as pdf.js and PDF use it (points map as x' = a x + c y + e). */
type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Matrix product a × b: first a, then b. */
function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/** Path segment operators in pdf.js's path data, with how many numbers each takes. */
const PATH_ARGS: Record<number, number> = { 0: 2, 1: 2, 2: 6, 3: 4, 4: 0 };

/** The points of a path (after the current transform), from pdf.js's flat path data. */
function pathPoints(data: number[], ctm: Matrix): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < data.length; ) {
    const n = PATH_ARGS[data[i++]] ?? 0;
    for (let k = 0; k < n; k += 2) {
      const x = data[i + k];
      const y = data[i + k + 1];
      pts.push([x * ctm[0] + y * ctm[2] + ctm[4], x * ctm[1] + y * ctm[3] + ctm[5]]);
    }
    i += n;
  }
  return pts;
}

/**
 * The rules painted on the page: a stroked horizontal line (its width is the line width) or a filled rectangle
 * under 2.5 pt high. Clip paths and boxes are not rules.
 */
function rulesOf(ops: { fnArray: number[]; argsArray: unknown[] }): Rule[] {
  const { OPS } = pdfjs;
  const strokes = new Set<number>([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke]);
  const fills = new Set<number>([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke]);
  const rules: Rule[] = [];
  const stack: Matrix[] = [];
  let ctm: Matrix = IDENTITY;
  let lineWidth = 1;
  ops.fnArray.forEach((op, i) => {
    const args = ops.argsArray[i] as unknown[] | null;
    if (op === OPS.save) stack.push(ctm);
    else if (op === OPS.restore) ctm = stack.pop() ?? IDENTITY;
    else if (op === OPS.transform) ctm = mul(args as Matrix, ctm);
    else if (op === OPS.setLineWidth) lineWidth = (args as number[])[0];
    else if (op === OPS.constructPath) {
      const paint = (args as [number, number[][]])[0];
      const rule = ruleOf(pathPoints((args as [number, number[][]])[1][0], ctm), {
        stroke: strokes.has(paint) && lineWidth <= 3,
        fill: fills.has(paint),
      });
      if (rule) rules.push(rule);
    }
  });
  return rules;
}

function ruleOf(pts: [number, number][], paint: { stroke: boolean; fill: boolean }): Rule | null {
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const height = Math.max(...ys) - Math.min(...ys);
  const flat = paint.stroke && height <= 0.5;
  const thin = paint.fill && height <= RULE_MAX_HEIGHT;
  if (!flat && !thin) return null;
  return { y: (Math.max(...ys) + Math.min(...ys)) / 2, x0: Math.min(...xs), x1: Math.max(...xs) };
}

// ---- lines into paragraphs ----

function hasTab(line: Line): boolean {
  return line.pieces.some((p) => p.text === "\t");
}

function lineText(line: Line): string {
  return line.pieces.map((p) => p.text).join("");
}

/** The left edge of the character at `n` in a line (interpolated inside a piece). */
function xAtChar(pieces: Piece[], n: number): number {
  let pos = 0;
  for (const p of pieces) {
    if (n < pos + p.text.length) return p.x + ((n - pos) / p.text.length) * p.w;
    pos += p.text.length;
  }
  const last = pieces[pieces.length - 1];
  return last.x + last.w;
}

/** The pieces without their first `n` characters. */
function dropChars(pieces: Piece[], n: number): Piece[] {
  let left = n;
  const out: Piece[] = [];
  for (const p of pieces) {
    if (left >= p.text.length) {
      left -= p.text.length;
      continue;
    }
    out.push(left > 0 ? { ...p, text: p.text.slice(left) } : p);
    left = 0;
  }
  return out;
}

function startParagraph(line: Line): Para {
  const m = BULLET_RE.exec(lineText(line));
  if (!m) return { bullet: false, lines: [line], pieces: line.pieces, textX: line.x0, depth: 0 };
  return {
    bullet: true,
    lines: [line],
    pieces: dropChars(line.pieces, m[0].length),
    textX: xAtChar(line.pieces, m[0].length),
    depth: 0,
  };
}

/**
 * Whether the line is the next line of the paragraph: a wrapped bullet starts at the bullet's text; a plain
 * paragraph starts at the same left edge and its previous line runs to the right margin.
 */
function continues(para: Para, line: Line, right: number, width: number): boolean {
  const last = para.lines[para.lines.length - 1];
  const pitch = line.y - last.y;
  if (!(pitch > 0 && pitch <= WRAP_PITCH * line.size) || Math.abs(line.size - last.size) > 0.5) return false;
  // A line with a tab is a "Company ⇥ City" row, not wrapped text.
  if (hasTab(last) || hasTab(line)) return false;
  if (para.bullet) return Math.abs(line.x0 - para.textX) <= 2;
  return Math.abs(line.x0 - para.lines[0].x0) <= 2 && last.x1 >= right - 0.05 * width;
}

/** The page's lines as paragraphs: bullets, wrapped lines joined, one paragraph per other line. */
function paragraphsOf(lines: Line[], right: number, width: number): Para[] {
  const out: Para[] = [];
  for (const line of lines) {
    const cur = out[out.length - 1];
    if (BULLET_RE.test(lineText(line)) || !cur || !continues(cur, line, right, width)) {
      out.push(startParagraph(line));
      continue;
    }
    cur.lines.push(line);
    cur.pieces = [...cur.pieces, { text: " ", style: cur.pieces[cur.pieces.length - 1].style, x: line.x0, w: 0 }, ...line.pieces];
  }
  return out;
}

/** Bullet depth: the distinct left edges of the page's bullets, in order (1 = the outermost). */
function assignDepths(paras: Para[]): void {
  const edges: number[] = [];
  for (const p of paras.filter((q) => q.bullet)) {
    const x = p.lines[0].x0;
    if (!edges.some((e) => Math.abs(e - x) <= 4)) edges.push(x);
  }
  edges.sort((a, b) => a - b);
  for (const p of paras.filter((q) => q.bullet)) {
    const x = p.lines[0].x0;
    p.depth = edges.findIndex((e) => Math.abs(e - x) <= 4) + 1;
  }
}

// ---- alignment, spacing and rules into document items ----

/** Center or right when the line sits there; left (no textAlign) otherwise. Bullets are always left. */
function alignOf(line: Line, left: number, right: number): ParagraphAttrs["textAlign"] {
  const width = right - left;
  const center = (left + right) / 2;
  if (line.x0 > left + 1 && Math.abs((line.x0 + line.x1) / 2 - center) < 0.02 * width) return "center";
  if (Math.abs(line.x1 - right) < 2 && line.x0 > center) return "right";
  return undefined;
}

/** Extra space above a paragraph, in points, from the gap to the previous line's baseline. */
function spaceBeforeOf(prev: Para | undefined, para: Para): number | undefined {
  if (!prev) return undefined;
  const last = prev.lines[prev.lines.length - 1];
  const first = para.lines[0];
  const extra = first.y - last.y - PITCH * Math.max(last.size, first.size);
  return extra >= 2 ? Math.min(MAX_SPACE_BEFORE, Math.round(extra)) : undefined;
}

/** Items of one page in reading order. Each rule either borders the paragraph just above it or is a rule block. */
function pageItems(page: PageText): Item[] {
  const left = Math.min(...page.lines.map((l) => l.x0));
  const right = Math.max(...page.lines.map((l) => l.x1));
  const paras = paragraphsOf(page.lines, right, right - left);
  assignDepths(paras);
  const borders = new Set<Para>();
  const ruleItems: Item[] = [];
  for (const rule of page.rules) {
    if (rule.x1 - rule.x0 < RULE_MIN_WIDTH * (right - left)) continue;
    const above = paras.filter((p) => p.lines[p.lines.length - 1].y < rule.y);
    const near = above[above.length - 1];
    const gap = near ? rule.y - near.lines[near.lines.length - 1].y : Infinity;
    if (near && gap <= 1.5 * near.lines[near.lines.length - 1].size) borders.add(near);
    else ruleItems.push({ y: rule.y, rule: true });
  }
  const items: Item[] = paras.flatMap((para, i) => {
    const node = nodeOf(para, {
      align: para.bullet ? undefined : alignOf(para.lines[0], left, right),
      spaceBefore: spaceBeforeOf(paras[i - 1], para),
      border: borders.has(para),
    });
    if (!node) return [];
    const entry: FlatEntry = para.bullet
      ? { node, listType: "bulletList", depth: para.depth, bullet: true }
      : { node, listType: null, depth: 0, bullet: false };
    return [{ y: para.lines[0].y, entry }];
  });
  return [...items, ...ruleItems].sort((a, b) => a.y - b.y);
}

function nodeOf(
  para: Para,
  opts: { align: ParagraphAttrs["textAlign"]; spaceBefore: number | undefined; border: boolean },
): DocParagraph | null {
  const content = inlineOf(para.pieces);
  if (!content.length) return null;
  const attrs: ParagraphAttrs = { id: newId() };
  if (opts.align) attrs.textAlign = opts.align;
  if (opts.spaceBefore) attrs.spaceBefore = opts.spaceBefore;
  if (opts.border) attrs.borderBottom = true;
  return { type: "paragraph", attrs, content };
}

/** The marks of a run: bold, italic, and the size and family as textStyle. Sizes round to half points. */
function marksOf(s: Style): DocMark[] {
  const marks: DocMark[] = [];
  if (s.bold) marks.push({ type: "bold" });
  if (s.italic) marks.push({ type: "italic" });
  const attrs: { fontSize: string; fontFamily?: string } = { fontSize: `${Math.round(s.size * 2) / 2}pt` };
  if (s.family) attrs.fontFamily = s.family;
  marks.push({ type: "textStyle", attrs });
  return marks;
}

/** The inline nodes of pieces: tabs, and text runs merged while their marks are the same. */
function inlineOf(pieces: Piece[]): DocInline[] {
  const out: DocInline[] = [];
  let prevKey = "";
  for (const p of pieces) {
    if (p.text === "\t") {
      out.push({ type: "tab" });
      prevKey = "";
      continue;
    }
    const marks = marksOf(p.style);
    const key = JSON.stringify(marks);
    const last = out[out.length - 1];
    if (last?.type === "text" && key === prevKey) last.text += p.text;
    else out.push({ type: "text", text: p.text, marks });
    prevKey = key;
  }
  return out;
}

/** The document: runs of paragraphs as lists and paragraphs, and each rule block between them. */
function docFromItems(items: Item[]): DocJSON {
  const content: DocBlock[] = [];
  let run: FlatEntry[] = [];
  const flush = () => {
    if (run.length) content.push(...buildDoc(run).content);
    run = [];
  };
  for (const item of items) {
    if ("rule" in item) {
      flush();
      content.push({ type: "horizontalRule" });
    } else {
      run.push(item.entry);
    }
  }
  flush();
  return normalizeDoc({ type: "doc", content });
}

// ---- page setup ----

/**
 * The margins from the text's place on the page: left and right from the outermost text, top from the first
 * line's top, bottom from the blank space under the last line. Inches, rounded to 0.05 and kept within 0.2-1.5.
 */
function pageSetupOf(pages: PageText[]): PageSetup {
  const first = pages[0];
  const lines = pages.flatMap((p) => p.lines);
  const left = Math.min(...lines.map((l) => l.x0));
  const right = Math.max(...lines.map((l) => l.x1));
  const top = Math.min(...first.lines.map((l) => l.y - 0.8 * l.size));
  const bottom = first.height - Math.max(...first.lines.map((l) => l.y));
  const inches = (pt: number) => Math.min(1.5, Math.max(0.2, Math.round((pt / PT_PER_INCH) * 20) / 20));
  return {
    marginTop: inches(top),
    marginBottom: inches(bottom),
    marginLeft: inches(left),
    marginRight: inches(first.width - right),
  };
}
