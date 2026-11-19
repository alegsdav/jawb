/**
 * A .docx (Word, or Google Docs / LibreOffice exports) as the resume document. The file is a zip of XML; this reads
 * the parts that carry the look of the page (document, styles, numbering, theme, links, the header and footer of the
 * section, and text boxes) and maps them to the same DocJSON the PDF importer produces. Runs in the browser and in
 * node: no DOMParser, no network, no AI.
 *
 * Deliberately not read: page numbers (the editor draws its own), comments, footnotes and endnotes, images, shapes
 * without text, deleted tracked changes, and fields other than hyperlinks.
 */
import { unzipSync, strFromU8 } from "fflate";
import { newId, normalizeDoc, normalizeHref, buildDoc, type FlatEntry } from "@/lib/doc/model";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE_PT,
  PAGE_DEFAULTS,
  type DocInline,
  type DocJSON,
  type DocList,
  type DocMark,
  type DocParagraph,
  type PageSetup,
  type ParagraphAttrs,
} from "@/lib/doc/types";

/** A file the import cannot read (not a .docx, or damaged). The message is safe to show. */
export class DocxError extends Error {}

// ---- A small XML reader (elements, attributes, text, CDATA; comments and declarations skipped) ----

export type XNode = { tag: string; attrs: Record<string, string>; kids: XNode[]; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string): string =>
  s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e] ?? m;
  });

const TOKEN =
  /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const localName = (name: string) => (name.includes(":") ? name.slice(name.indexOf(":") + 1) : name);

/** Parses XML text into a synthetic root whose kids are the top-level elements. Tags are compared without prefixes. */
export function parseXml(src: string): XNode {
  const root: XNode = { tag: "#root", attrs: {}, kids: [], text: "" };
  const stack: XNode[] = [root];
  for (const m of src.matchAll(TOKEN)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.text += m[1];
    } else if (m[2] !== undefined) {
      const tag = localName(m[2].trim());
      let idx = stack.length - 1;
      while (idx > 0 && stack[idx].tag !== tag) idx--;
      if (idx > 0) stack.length = idx;
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(ATTR)) attrs[a[1]] = decode(a[2] ?? a[3] ?? "");
      const node: XNode = { tag: localName(m[3]), attrs, kids: [], text: "" };
      top.kids.push(node);
      if (m[5] !== "/") {
        // Real documents nest a few dozen levels; a file nested thousands deep is broken or hostile.
        if (stack.length > MAX_XML_DEPTH) throw new DocxError("That file isn't a readable Word (.docx) document.");
        stack.push(node);
      }
    } else if (m[6] !== undefined) {
      top.text += decode(m[6]);
    }
  }
  return root;
}

/** Attribute by local name (w:val and val both match "val"). */
function attr(n: XNode | undefined, local: string): string | undefined {
  if (!n) return undefined;
  for (const k of Object.keys(n.attrs)) if (localName(k) === local) return n.attrs[k];
  return undefined;
}
const kid = (n: XNode | undefined, tag: string): XNode | undefined => n?.kids.find((k) => k.tag === tag);
const kidsOf = (n: XNode | undefined, tag: string): XNode[] => (n ? n.kids.filter((k) => k.tag === tag) : []);
const num = (v: string | undefined): number | undefined => {
  if (v === undefined || v.trim() === "") return undefined;
  const x = Number(v);
  return Number.isFinite(x) ? x : undefined;
};
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
/** w:val absent means on; "0", "false" and "off" mean off. */
function onOff(n: XNode | undefined): boolean | undefined {
  if (!n) return undefined;
  const v = attr(n, "val");
  return v === undefined ? true : !["0", "false", "off"].includes(v.toLowerCase());
}

// ---- Properties ----

type RProps = { bold?: boolean; italic?: boolean; underline?: boolean; caps?: boolean; size?: number; font?: string };
type PProps = {
  align?: "left" | "center" | "right" | "justify";
  before?: number;
  after?: number;
  line?: number;
  borderBottom?: boolean;
  /** Identity of the bottom rule (style, width, space, colour): Word groups paragraphs that share it. */
  border?: string;
  borderBetween?: boolean;
  indentLeft?: number;
  indentRight?: number;
  /** A right or end tab stop applies, so a tab in the paragraph goes to the margin. */
  rightTab?: boolean;
  numId?: string;
  ilvl?: number;
};
type StyleDef = { basedOn?: string; p: PProps; r: RProps };

/** Later arguments win; undefined values never override. */
function merged<T extends object>(...parts: (T | undefined)[]): T {
  const out: Record<string, unknown> = {};
  for (const part of parts) {
    if (!part) continue;
    for (const [k, v] of Object.entries(part)) if (v !== undefined) out[k] = v;
  }
  return out as T;
}

type Theme = { major?: string; minor?: string };

function fontOf(f: XNode | undefined, theme: Theme): string | undefined {
  const fromTheme = (th: string | undefined) => (th ? (th.startsWith("major") ? theme.major : theme.minor) : undefined);
  const name =
    fromTheme(attr(f, "asciiTheme")) ?? attr(f, "ascii") ?? fromTheme(attr(f, "hAnsiTheme")) ?? attr(f, "hAnsi");
  return name && name.length <= 64 ? name : undefined;
}

function readRPr(el: XNode | undefined, theme: Theme): RProps {
  const r: RProps = {};
  if (!el) return r;
  r.bold = onOff(kid(el, "b"));
  r.italic = onOff(kid(el, "i"));
  r.caps = onOff(kid(el, "caps"));
  const u = kid(el, "u");
  if (u) r.underline = attr(u, "val") !== "none";
  const sz = num(attr(kid(el, "sz"), "val"));
  if (sz !== undefined && sz > 0) r.size = sz / 2;
  const font = fontOf(kid(el, "rFonts"), theme);
  if (font) r.font = font;
  return merged(r);
}

const ALIGN: Record<string, PProps["align"]> = {
  left: "left",
  start: "left",
  center: "center",
  right: "right",
  end: "right",
  both: "justify",
  distribute: "justify",
  justify: "justify",
};

/** A border Word draws: not nil or none, and not zero width (w:sz="0" draws nothing). */
function drawnBorder(el: XNode | undefined): boolean {
  if (!el) return false;
  const val = attr(el, "val") ?? "none";
  return !["nil", "none"].includes(val) && num(attr(el, "sz")) !== 0;
}

const borderId = (el: XNode): string => ["val", "sz", "space", "color", "themeColor"].map((k) => attr(el, k) ?? "").join("|");

/**
 * The paragraph borders that become a rule under the paragraph: the bottom border, unless a side border is drawn too
 * (a box or a bracket is not a rule), and a "between" border, which Word draws between the paragraphs of a group.
 * An element that draws nothing sets the rule off, so it overrides a rule inherited from a style.
 */
function readBorders(bdr: XNode | undefined, p: PProps): void {
  const bottom = kid(bdr, "bottom");
  const between = kid(bdr, "between");
  if (!bottom && !between) return;
  const sides = drawnBorder(kid(bdr, "left")) || drawnBorder(kid(bdr, "right"));
  const bottomRule = drawnBorder(bottom) && !sides;
  const betweenOn = drawnBorder(between);
  p.borderBottom = bottomRule || betweenOn;
  if (bottom && bottomRule) p.border = borderId(bottom);
  if (betweenOn) p.borderBetween = true;
}

function readPPr(el: XNode | undefined): PProps {
  const p: PProps = {};
  if (!el) return p;
  const jc = ALIGN[attr(kid(el, "jc"), "val") ?? ""];
  if (jc) p.align = jc;
  const sp = kid(el, "spacing");
  if (sp) {
    const before = num(attr(sp, "before"));
    const after = num(attr(sp, "after"));
    const line = num(attr(sp, "line"));
    if (before !== undefined) p.before = before / 20;
    if (after !== undefined) p.after = after / 20;
    if (line !== undefined && (attr(sp, "lineRule") ?? "auto") === "auto") p.line = line / 240;
  }
  const ind = kid(el, "ind");
  if (ind) {
    const left = num(attr(ind, "left") ?? attr(ind, "start"));
    const right = num(attr(ind, "right") ?? attr(ind, "end"));
    if (left !== undefined) p.indentLeft = left;
    if (right !== undefined) p.indentRight = right;
  }
  readBorders(kid(el, "pBdr"), p);
  if (kidsOf(kid(el, "tabs"), "tab").some((t) => ["right", "end"].includes(attr(t, "val") ?? ""))) p.rightTab = true;
  const numPr = kid(el, "numPr");
  if (numPr) {
    const numId = attr(kid(numPr, "numId"), "val");
    if (numId !== undefined) p.numId = numId;
    const ilvl = num(attr(kid(numPr, "ilvl"), "val"));
    if (ilvl !== undefined) p.ilvl = ilvl;
  }
  return merged(p);
}

// ---- Package context ----

/** The list format a paragraph's list needs beyond bullet or number: the HTML type ("a", "I", ...) and the start. */
type ListFormat = { type?: string; start?: number };

type Ctx = {
  theme: Theme;
  docR: RProps;
  docP: PProps;
  styles: Map<string, StyleDef>;
  defaultPara?: string;
  /** numId -> abstractNumId */
  nums: Map<string, string>;
  /** numId:ilvl -> start, from a num's level override */
  starts: Map<string, number>;
  /** abstractNumId -> ilvl -> the level's number format and start */
  levels: Map<string, Map<number, { fmt: string; start?: number }>>;
  /** Relationship id -> external target (hyperlinks). */
  rels: Map<string, string>;
  /** Relationship id -> package path of a header or footer part of the document. */
  parts: Map<string, string>;
};

/** Limits on what a .docx may inflate to (a long resume's document.xml is well under 1 MB). */
const MAX_PART_BYTES = 30 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 60 * 1024 * 1024;
const TOO_BIG = "That Word file is too large to open. Save it as PDF, or remove images and try again.";
const MAX_XML_DEPTH = 1000;

const KEEP = new Set([
  "word/document.xml",
  "word/styles.xml",
  "word/numbering.xml",
  "word/theme/theme1.xml",
  "word/_rels/document.xml.rels",
]);
/** Header and footer parts, and their relationships (hyperlinks in a header). */
const PART_KEPT = /^word\/(?:_rels\/)?(?:header|footer)\d+\.xml(?:\.rels)?$/;

/** The parsed part at a package path, or undefined when the file is not there. */
function partOf(files: Record<string, Uint8Array>, name: string): XNode | undefined {
  return files[name] ? parseXml(strFromU8(files[name])).kids[0] : undefined;
}

type Rels = { links: Map<string, string>; parts: Map<string, string> };

/**
 * The relationships of a part: external links by id, and the header and footer parts by id (as package paths).
 * `base` is the folder the part lives in, which the relative targets of its relationships are read from.
 */
function readRels(el: XNode | undefined, base: string): Rels {
  const links = new Map<string, string>();
  const parts = new Map<string, string>();
  for (const r of kidsOf(el, "Relationship")) {
    const id = attr(r, "Id");
    const target = attr(r, "Target");
    if (!id || !target) continue;
    if (attr(r, "TargetMode") === "External") links.set(id, target);
    else if (/\/(header|footer)$/.test(attr(r, "Type") ?? "")) parts.set(id, target.startsWith("/") ? target.slice(1) : `${base}${target}`);
  }
  return { links, parts };
}

function readContext(files: Record<string, Uint8Array>): { ctx: Ctx; body: XNode } {
  const part = (name: string) => partOf(files, name);
  const docEl = part("word/document.xml");
  const body = kid(docEl, "body");
  if (!body) throw new DocxError("That file isn't a Word document.");

  const themeEl = part("word/theme/theme1.xml");
  const fontFor = (tag: string) => attr(kid(findAll(themeEl, tag)[0], "latin"), "typeface");
  const theme: Theme = { major: fontFor("majorFont"), minor: fontFor("minorFont") };

  const stylesEl = part("word/styles.xml");
  const defaults = kid(stylesEl, "docDefaults");
  const styles = new Map<string, StyleDef>();
  let defaultPara: string | undefined;
  for (const s of kidsOf(stylesEl, "style")) {
    const id = attr(s, "styleId");
    if (!id) continue;
    const isParagraph = attr(s, "type") === "paragraph";
    if (isParagraph && ["1", "true", "on"].includes(attr(s, "default") ?? "")) defaultPara = id;
    styles.set(id, {
      basedOn: attr(kid(s, "basedOn"), "val"),
      // Table and character styles carry no paragraph rules or tab stops for the paragraphs that use them.
      p: isParagraph ? readPPr(kid(s, "pPr")) : {},
      r: readRPr(kid(s, "rPr"), theme),
    });
  }

  const numberingEl = part("word/numbering.xml");
  const nums = new Map<string, string>();
  const starts = new Map<string, number>();
  const levels = new Map<string, Map<number, { fmt: string; start?: number }>>();
  for (const a of kidsOf(numberingEl, "abstractNum")) {
    const abs = attr(a, "abstractNumId") ?? "";
    const byLevel = new Map<number, { fmt: string; start?: number }>();
    for (const lvl of kidsOf(a, "lvl")) {
      const ilvl = num(attr(lvl, "ilvl")) ?? 0;
      byLevel.set(ilvl, { fmt: attr(kid(lvl, "numFmt"), "val") ?? "decimal", start: num(attr(kid(lvl, "start"), "val")) });
    }
    levels.set(abs, byLevel);
  }
  for (const n of kidsOf(numberingEl, "num")) {
    const id = attr(n, "numId");
    const abs = attr(kid(n, "abstractNumId"), "val");
    if (!id || abs === undefined) continue;
    nums.set(id, abs);
    for (const o of kidsOf(n, "lvlOverride")) {
      const start = num(attr(kid(o, "startOverride"), "val"));
      if (start !== undefined) starts.set(`${id}:${num(attr(o, "ilvl")) ?? 0}`, start);
    }
  }

  const rels = readRels(part("word/_rels/document.xml.rels"), "word/");
  const ctx: Ctx = {
    theme,
    docR: readRPr(kid(kid(defaults, "rPrDefault"), "rPr"), theme),
    docP: readPPr(kid(kid(defaults, "pPrDefault"), "pPr")),
    styles,
    defaultPara,
    nums,
    starts,
    levels,
    rels: rels.links,
    parts: rels.parts,
  };
  return { ctx, body };
}

function findAll(n: XNode | undefined, tag: string, out: XNode[] = []): XNode[] {
  if (!n) return out;
  for (const k of n.kids) {
    if (k.tag === tag) out.push(k);
    findAll(k, tag, out);
  }
  return out;
}

/** The style and the styles it is based on, base first. */
function styleChain(id: string | undefined, ctx: Ctx): StyleDef[] {
  const out: StyleDef[] = [];
  const seen = new Set<string>();
  let cur = id;
  while (cur && !seen.has(cur) && ctx.styles.has(cur)) {
    seen.add(cur);
    const s = ctx.styles.get(cur)!;
    out.unshift(s);
    cur = s.basedOn;
  }
  return out;
}

// ---- Runs and paragraphs ----

function marksOf(rp: RProps, href: string | undefined): DocMark[] {
  const marks: DocMark[] = [];
  if (rp.bold) marks.push({ type: "bold" });
  if (rp.italic) marks.push({ type: "italic" });
  if (rp.underline) marks.push({ type: "underline" });
  // Sizes and fonts equal to the document defaults are left out: text without the mark already has them.
  const sizeDiffers = rp.size !== undefined && rp.size !== DEFAULT_FONT_SIZE_PT;
  const fontDiffers = rp.font !== undefined && rp.font !== DEFAULT_FONT_FAMILY;
  if (sizeDiffers || fontDiffers) {
    const attrs: { fontSize?: string; fontFamily?: string } = {};
    if (sizeDiffers) attrs.fontSize = `${rp.size}pt`;
    if (fontDiffers) attrs.fontFamily = rp.font;
    marks.push({ type: "textStyle", attrs });
  }
  if (href) marks.push({ type: "link", attrs: { href } });
  return marks;
}

function runInline(run: XNode, rp: RProps, href: string | undefined): DocInline[] {
  const out: DocInline[] = [];
  const text = (s: string) => {
    if (!s) return;
    const marks = marksOf(rp, href);
    out.push(marks.length ? { type: "text", text: s, marks } : { type: "text", text: s });
  };
  for (const c of run.kids) {
    switch (c.tag) {
      case "t":
        text(rp.caps ? c.text.toUpperCase() : c.text);
        break;
      case "tab":
        out.push({ type: "tab" });
        break;
      case "br":
        if (!["page", "column"].includes(attr(c, "type") ?? "")) out.push({ type: "hardBreak" });
        break;
      case "cr":
        out.push({ type: "hardBreak" });
        break;
      case "noBreakHyphen":
        text("-");
        break;
      default:
        break;
    }
  }
  return out;
}

/** A complex field (w:fldChar begin ... end) open at some point of a paragraph. */
type OpenField = { instr: string; sep: boolean; page: boolean };
const PAGE_FIELD = /^\s*(PAGE|NUMPAGES)\b/i;

/**
 * Follows the field characters of a run. A page-number field's result is what Word fills in for each page, so its
 * runs are left out of the paragraph: the editor has no page number to show there.
 */
function trackFields(run: XNode, fields: OpenField[]): void {
  for (const c of run.kids) {
    if (c.tag === "fldChar") {
      const type = attr(c, "fldCharType");
      if (type === "begin") fields.push({ instr: "", sep: false, page: false });
      else if (type === "separate" && fields.length) {
        const top = fields[fields.length - 1];
        top.sep = true;
        top.page = PAGE_FIELD.test(top.instr);
      } else if (type === "end") fields.pop();
    } else if (c.tag === "instrText" && fields.length && !fields[fields.length - 1].sep) {
      fields[fields.length - 1].instr += c.text;
    }
  }
}

/** Runs of a paragraph (and its hyperlinks, insertions and content controls), in order. */
function collectRuns(node: XNode, base: RProps, href: string | undefined, ctx: Ctx, out: DocInline[], fields: OpenField[] = []): void {
  for (const k of node.kids) {
    switch (k.tag) {
      case "r":
        trackFields(k, fields);
        if (!fields.some((f) => f.page)) out.push(...runInline(k, merged(base, styleRunProps(k, ctx), readRPr(kid(k, "rPr"), ctx.theme)), href));
        break;
      case "hyperlink": {
        const target = ctx.rels.get(attr(k, "id") ?? "");
        const link = target ? normalizeHref(target) ?? undefined : undefined;
        collectRuns(k, base, link ?? href, ctx, out, fields);
        break;
      }
      case "ins":
      case "smartTag":
      case "sdt":
      case "sdtContent":
      case "customXml":
        collectRuns(k, base, href, ctx, out, fields);
        break;
      default:
        // pPr, bookmarks, deleted text, drawings and text boxes (see textBoxesIn), other fields: not the page's text.
        break;
    }
  }
}

/** The style a run names (w:rStyle), as run properties. */
function styleRunProps(run: XNode, ctx: Ctx): RProps {
  const id = attr(kid(kid(run, "rPr"), "rStyle"), "val");
  return merged(...styleChain(id, ctx).map((s) => s.r));
}

/**
 * The text boxes a paragraph anchors, in order. A text box is in a run's drawing or shape, and an mc:AlternateContent
 * holds the same box twice: its Choice is read, its Fallback only when there is no Choice, so no text comes in twice.
 */
function textBoxesIn(node: XNode, out: XNode[] = []): XNode[] {
  for (const k of node.kids) {
    if (k.tag === "txbxContent") out.push(k);
    else if (k.tag === "AlternateContent") {
      const pick = kid(k, "Choice") ?? kid(k, "Fallback");
      if (pick) textBoxesIn(pick, out);
    } else if (k.tag !== "pPr") textBoxesIn(k, out);
  }
  return out;
}

function mergeText(nodes: DocInline[]): DocInline[] {
  const out: DocInline[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === "text" && last?.type === "text" && JSON.stringify(last.marks ?? []) === JSON.stringify(n.marks ?? [])) {
      last.text += n.text;
    } else {
      out.push(n);
    }
  }
  return out;
}

type Parts = { inline: DocInline[]; pp: PProps };

/** The inline content of a w:p and its paragraph properties, with the paragraph style applied. */
function paragraphParts(p: XNode, ctx: Ctx): Parts {
  const pPrEl = kid(p, "pPr");
  const styleId = attr(kid(pPrEl, "pStyle"), "val") ?? ctx.defaultPara;
  const chain = styleChain(styleId, ctx);
  const pp = merged<PProps>(ctx.docP, ...chain.map((s) => s.p), readPPr(pPrEl));
  const base = merged<RProps>(ctx.docR, ...chain.map((s) => s.r));
  const inline: DocInline[] = [];
  collectRuns(p, base, undefined, ctx, inline);
  return { inline: mergeText(inline), pp };
}

function paragraphAttrs(pp: PProps): ParagraphAttrs {
  const attrs: ParagraphAttrs = { id: newId() };
  if (pp.align && pp.align !== "left") attrs.textAlign = pp.align;
  if (pp.before !== undefined && pp.before > 0) attrs.spaceBefore = clamp(pp.before, 0, 72);
  if (pp.after !== undefined && pp.after > 0) attrs.spaceAfter = clamp(pp.after, 0, 72);
  if (pp.line !== undefined) attrs.lineHeight = clamp(pp.line, 0.8, 3);
  if (pp.borderBottom) attrs.borderBottom = true;
  return attrs;
}

/** The HTML list type of a numbered level ("a", "A", "i", "I"; decimal is the default and has none) and its start. */
const ORDERED_TYPES = new Map([
  ["lowerLetter", "a"],
  ["upperLetter", "A"],
  ["lowerRoman", "i"],
  ["upperRoman", "I"],
]);

/** The format of a numbered level, leaving out what the default (decimal, from 1) already says. */
function orderedFormat(fmt: string, start: number | undefined): ListFormat {
  const format: ListFormat = {};
  const type = ORDERED_TYPES.get(fmt);
  if (type) format.type = type;
  if (start !== undefined && Number.isInteger(start) && start > 1) format.start = start;
  return format;
}

/**
 * The list a paragraph belongs to (bullet or numbered, by the numbering level's format), with the format a numbered
 * list needs, or null when the paragraph is not in a list.
 */
function listOf(pp: PProps, ctx: Ctx): { listType: "bulletList" | "orderedList"; depth: number; format: ListFormat } | null {
  if (!pp.numId || pp.numId === "0") return null;
  const ilvl = pp.ilvl ?? 0;
  const abs = ctx.nums.get(pp.numId);
  const level = abs !== undefined ? ctx.levels.get(abs)?.get(ilvl) : undefined;
  const ordered = level !== undefined && level.fmt !== "bullet" && level.fmt !== "none";
  const start = ctx.starts.get(`${pp.numId}:${ilvl}`) ?? level?.start;
  return {
    listType: ordered ? "orderedList" : "bulletList",
    depth: clamp(ilvl + 1, 1, 9),
    format: ordered ? orderedFormat(level.fmt, start) : {},
  };
}

/** Every paragraph in a table cell, including paragraphs of nested tables and content controls. */
function cellParagraphs(n: XNode): XNode[] {
  const out: XNode[] = [];
  for (const k of n.kids) {
    if (k.tag === "p") out.push(k);
    else if (k.tag === "tbl") for (const tr of kidsOf(k, "tr")) for (const tc of kidsOf(tr, "tc")) out.push(...cellParagraphs(tc));
    else if (k.tag === "sdt" || k.tag === "sdtContent") out.push(...cellParagraphs(k));
  }
  return out;
}

/**
 * A table row becomes one paragraph: the non-empty cells in order, the last one after a tab (so "Company | City"
 * reads "Company ⇥ City" with the city on the right margin). Earlier cells are separated by a space. Paragraphs
 * inside a cell are joined with a line break. Its formatting comes from the first cell that has text.
 */
function rowParts(tr: XNode, ctx: Ctx): Parts | null {
  const cells: DocInline[][] = [];
  let pp: PProps | undefined;
  for (const tc of kidsOf(tr, "tc")) {
    const inline: DocInline[] = [];
    for (const p of cellParagraphs(tc)) {
      const part = paragraphParts(p, ctx);
      if (!part.inline.length) continue;
      if (inline.length) inline.push({ type: "hardBreak" });
      inline.push(...part.inline);
      pp ??= part.pp;
    }
    if (inline.length) cells.push(inline);
  }
  if (!cells.length || !pp) return null;
  const inline: DocInline[] = [];
  cells.forEach((cell, i) => {
    if (i > 0) inline.push(i === cells.length - 1 ? { type: "tab" } : { type: "text", text: " " });
    inline.push(...cell);
  });
  return { inline: mergeText(inline), pp };
}

/**
 * The key Word groups paragraphs by: paragraphs with the same rule and the same left and right indent form one
 * bordered group. Undefined when the paragraph has no rule to group (none, or a between border, which stays on each).
 */
function ruleGroupKey(pp: PProps): string | undefined {
  if (!pp.borderBottom || !pp.border || pp.borderBetween) return undefined;
  return `${pp.border}|${pp.indentLeft ?? 0}|${pp.indentRight ?? 0}`;
}

/**
 * A tab with no right-aligned stop only lines text up in a column, so it becomes spaces, as the PDF importer does for
 * left-aligned columns. Four spaces stand in for a tab: the editor cannot know Word's stop positions.
 */
function columnTabs(inline: DocInline[], rightStop: boolean): DocInline[] {
  if (rightStop) return inline;
  return mergeText(inline.map((n): DocInline => (n.type === "tab" ? { type: "text", text: "    " } : n)));
}

/** A list entry or a paragraph, with the list format a numbered list needs (see ListFormat). */
type ImportEntry = FlatEntry & { format?: ListFormat };

function walkBody(nodes: XNode[], ctx: Ctx, out: ImportEntry[]): void {
  // The last paragraph of the open bordered group, whose rule is the only one Word draws for the group.
  let group: { entry: ImportEntry; key: string } | undefined;
  for (const n of nodes) {
    if (n.tag === "p") {
      const { inline, pp } = paragraphParts(n, ctx);
      const entry = entryOf(columnTabs(inline, pp.rightTab === true), pp, ctx);
      const key = ruleGroupKey(pp);
      if (key !== undefined && group?.key === key) delete group.entry.node.attrs?.borderBottom;
      group = key === undefined ? undefined : { entry, key };
      const boxes = textBoxEntries(n, ctx);
      // A text box sits at its anchor: its text follows the anchoring paragraph, or comes before it when that is empty.
      if (inline.length) out.push(entry, ...boxes);
      else out.push(...boxes, entry);
    } else if (n.tag === "tbl") {
      group = undefined;
      for (const tr of kidsOf(n, "tr")) {
        const row = rowParts(tr, ctx);
        // Table rows are never list items, and a border of a cell is not a rule under the whole row.
        if (row) out.push(entryOf(row.inline, { ...row.pp, numId: undefined, borderBottom: undefined }, ctx));
      }
    } else if (n.tag === "sdt" || n.tag === "sdtContent" || n.tag === "customXml") {
      group = undefined;
      walkBody(n.kids, ctx, out);
    }
  }
}

/** The paragraphs of the text boxes a paragraph anchors, read as body content. */
function textBoxEntries(p: XNode, ctx: Ctx): ImportEntry[] {
  const out: ImportEntry[] = [];
  for (const box of textBoxesIn(p)) walkBody(box.kids, ctx, out);
  return out;
}

function entryOf(inline: DocInline[], pp: PProps, ctx: Ctx): ImportEntry {
  const node: DocParagraph = inline.length
    ? { type: "paragraph", attrs: paragraphAttrs(pp), content: inline }
    : { type: "paragraph", attrs: paragraphAttrs(pp) };
  const list = listOf(pp, ctx);
  return list
    ? { node, listType: list.listType, depth: list.depth, bullet: true, format: list.format }
    : { node, listType: null, depth: 0, bullet: false };
}

/**
 * The paragraphs of the section's header or footer: the first-page part when the section has a different first page
 * (w:titlePg), else the default part. A part with no text gives nothing. A footer whose only text is a page number
 * is dropped as well, since the editor draws its own page numbers.
 */
function sectionEntries(kind: "header" | "footer", sect: XNode | undefined, ctx: Ctx, files: Record<string, Uint8Array>): ImportEntry[] {
  const type = onOff(kid(sect, "titlePg")) ? "first" : "default";
  const ref = kidsOf(sect, `${kind}Reference`).find((r) => attr(r, "type") === type);
  const target = ref ? ctx.parts.get(attr(ref, "id") ?? "") : undefined;
  const el = target ? partOf(files, target) : undefined;
  if (!target || !el) return [];
  const slash = target.lastIndexOf("/");
  const relsName = `${target.slice(0, slash + 1)}_rels/${target.slice(slash + 1)}.rels`;
  const partCtx: Ctx = { ...ctx, rels: readRels(partOf(files, relsName), "").links };
  const out: ImportEntry[] = [];
  walkBody(el.kids, partCtx, out);
  const hasText = out.some((e) => e.node.content?.some((n) => n.type === "text" && n.text.trim() !== ""));
  return hasText ? out : [];
}

/** Page margins from the body's last section, in inches (Word stores twips: 1440 per inch). */
function pageOf(body: XNode): PageSetup {
  const mar = kid(kid(body, "sectPr"), "pgMar");
  const inch = (name: string, fallback: number) => {
    const v = num(attr(mar, name));
    return v === undefined ? fallback : Math.round(clamp(v / 1440, 0.2, 3) * 100) / 100;
  };
  return {
    marginTop: inch("top", PAGE_DEFAULTS.marginTop),
    marginBottom: inch("bottom", PAGE_DEFAULTS.marginBottom),
    marginLeft: inch("left", PAGE_DEFAULTS.marginLeft),
    marginRight: inch("right", PAGE_DEFAULTS.marginRight),
  };
}

/**
 * Sets the type and start of each numbered list. buildDoc does not carry them, so a list takes the format of the
 * first paragraph it holds at its own level (the paragraph of its first item that is not inside a nested list).
 */
function applyListFormats(doc: DocJSON, entries: ImportEntry[]): void {
  const formats = new Map<string, ListFormat>();
  for (const e of entries) {
    if (e.format && Object.keys(e.format).length) formats.set(e.node.attrs.id, e.format);
  }
  const firstOwnId = (list: DocList): string | undefined => {
    for (const item of list.content) {
      for (const child of item.content) if (child.type === "paragraph") return child.attrs.id;
    }
    return undefined;
  };
  const visit = (list: DocList): void => {
    if (list.type === "orderedList") {
      const id = firstOwnId(list);
      const format = id !== undefined ? formats.get(id) : undefined;
      if (format) list.attrs = { ...format };
    }
    for (const item of list.content) {
      for (const child of item.content) if (child.type !== "paragraph") visit(child);
    }
  };
  for (const b of doc.content) if (b.type !== "paragraph") visit(b);
}

/**
 * A .docx as a version 4 document and its page setup. Throws DocxError when the file is not a readable .docx.
 * A tab becomes a tab node only where the paragraph has a right-aligned stop (the "Company ⇥ City" line): the editor
 * sends the text after a tab to the right margin. Other tabs are columns and become spaces. Table rows keep their tabs.
 * The header comes first, the footer last; text boxes sit at their anchoring paragraph.
 */
export function docxToDoc(data: Uint8Array): { doc: DocJSON; page: PageSetup } {
  let files: Record<string, Uint8Array>;
  try {
    let unpacked = 0;
    files = unzipSync(data, {
      filter: (f) => {
        if (!KEEP.has(f.name) && !PART_KEPT.test(f.name)) return false;
        // Sizes come from the zip header, before inflating: refuse a "zip bomb" instead of filling memory.
        unpacked += f.originalSize;
        if (f.originalSize > MAX_PART_BYTES || unpacked > MAX_UNPACKED_BYTES) throw new DocxError(TOO_BIG);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof DocxError) throw e;
    throw new DocxError("That file isn't a readable Word (.docx) document.");
  }
  const { ctx, body } = readContext(files);
  const sect = kid(body, "sectPr");
  const entries: ImportEntry[] = sectionEntries("header", sect, ctx, files);
  walkBody(body.kids, ctx, entries);
  entries.push(...sectionEntries("footer", sect, ctx, files));
  const doc = normalizeDoc(buildDoc(entries));
  applyListFormats(doc, entries);
  return { doc, page: pageOf(body) };
}
