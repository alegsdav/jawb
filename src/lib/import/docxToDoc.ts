/**
 * A .docx (Word, or Google Docs / LibreOffice exports) as the resume document. The file is a zip of XML; this reads
 * the parts that carry the look of the page (document, styles, numbering, theme, links) and maps them to the same
 * DocJSON the PDF importer produces. Runs in the browser and in node: no DOMParser, no network, no AI.
 *
 * Deliberately not read: headers and footers, comments, footnotes and endnotes, images, text boxes and shapes (their
 * text is skipped and the import says so in the docs), deleted tracked changes, and fields other than hyperlinks.
 */
import { unzipSync, strFromU8 } from "fflate";
import { newId, normalizeDoc, normalizeHref, buildDoc, type FlatEntry } from "@/lib/doc/model";
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE_PT,
  PAGE_DEFAULTS,
  type DocInline,
  type DocJSON,
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
      const idx = stack.map((n) => n.tag).lastIndexOf(tag);
      if (idx > 0) stack.length = idx;
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(ATTR)) attrs[a[1]] = decode(a[2] ?? a[3] ?? "");
      const node: XNode = { tag: localName(m[3]), attrs, kids: [], text: "" };
      top.kids.push(node);
      if (m[5] !== "/") stack.push(node);
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
  const bdr = kid(el, "pBdr");
  if (bdr && kid(bdr, "bottom")) p.borderBottom = attr(kid(bdr, "bottom"), "val") !== "none";
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

type Ctx = {
  theme: Theme;
  docR: RProps;
  docP: PProps;
  styles: Map<string, StyleDef>;
  defaultPara?: string;
  /** numId -> abstractNumId */
  nums: Map<string, string>;
  /** abstractNumId -> ilvl -> numFmt */
  levels: Map<string, Map<number, string>>;
  /** Relationship id -> external target (hyperlinks). */
  rels: Map<string, string>;
};

const KEEP = new Set([
  "word/document.xml",
  "word/styles.xml",
  "word/numbering.xml",
  "word/theme/theme1.xml",
  "word/_rels/document.xml.rels",
]);

function readContext(files: Record<string, Uint8Array>): { ctx: Ctx; body: XNode } {
  const part = (name: string): XNode | undefined => (files[name] ? parseXml(strFromU8(files[name])).kids[0] : undefined);
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
    if (attr(s, "type") === "paragraph" && ["1", "true", "on"].includes(attr(s, "default") ?? "")) defaultPara = id;
    styles.set(id, {
      basedOn: attr(kid(s, "basedOn"), "val"),
      p: readPPr(kid(s, "pPr")),
      r: readRPr(kid(s, "rPr"), theme),
    });
  }

  const numberingEl = part("word/numbering.xml");
  const nums = new Map<string, string>();
  const levels = new Map<string, Map<number, string>>();
  for (const a of kidsOf(numberingEl, "abstractNum")) {
    const abs = attr(a, "abstractNumId") ?? "";
    const byLevel = new Map<number, string>();
    for (const lvl of kidsOf(a, "lvl")) {
      const ilvl = num(attr(lvl, "ilvl")) ?? 0;
      byLevel.set(ilvl, attr(kid(lvl, "numFmt"), "val") ?? "decimal");
    }
    levels.set(abs, byLevel);
  }
  for (const n of kidsOf(numberingEl, "num")) {
    const id = attr(n, "numId");
    const abs = attr(kid(n, "abstractNumId"), "val");
    if (id && abs !== undefined) nums.set(id, abs);
  }

  const rels = new Map<string, string>();
  for (const r of kidsOf(part("word/_rels/document.xml.rels"), "Relationship")) {
    const id = attr(r, "Id");
    const target = attr(r, "Target");
    if (id && target && attr(r, "TargetMode") === "External") rels.set(id, target);
  }

  const ctx: Ctx = {
    theme,
    docR: readRPr(kid(kid(defaults, "rPrDefault"), "rPr"), theme),
    docP: readPPr(kid(kid(defaults, "pPrDefault"), "pPr")),
    styles,
    defaultPara,
    nums,
    levels,
    rels,
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

/** Runs of a paragraph (and its hyperlinks, insertions and content controls), in order. */
function collectRuns(node: XNode, base: RProps, href: string | undefined, ctx: Ctx, out: DocInline[]): void {
  for (const k of node.kids) {
    switch (k.tag) {
      case "r":
        out.push(...runInline(k, merged(base, styleRunProps(k, ctx), readRPr(kid(k, "rPr"), ctx.theme)), href));
        break;
      case "hyperlink": {
        const target = ctx.rels.get(attr(k, "id") ?? "");
        const link = target ? normalizeHref(target) ?? undefined : undefined;
        collectRuns(k, base, link ?? href, ctx, out);
        break;
      }
      case "ins":
      case "smartTag":
      case "sdt":
      case "sdtContent":
      case "customXml":
        collectRuns(k, base, href, ctx, out);
        break;
      default:
        // pPr, bookmarks, deleted text, drawings and text boxes, fields: no text of the page.
        break;
    }
  }
}

/** The character style a run names (w:rStyle), as run properties. */
function styleRunProps(run: XNode, ctx: Ctx): RProps {
  const id = attr(kid(kid(run, "rPr"), "rStyle"), "val");
  return merged(...styleChain(id, ctx).map((s) => s.r));
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

/** The list a paragraph belongs to (bullet or numbered, by the numbering level's format), or null. */
function listOf(pp: PProps, ctx: Ctx): { listType: "bulletList" | "orderedList"; depth: number } | null {
  if (!pp.numId || pp.numId === "0") return null;
  const ilvl = pp.ilvl ?? 0;
  const abs = ctx.nums.get(pp.numId);
  const fmt = abs !== undefined ? ctx.levels.get(abs)?.get(ilvl) : undefined;
  const ordered = fmt !== undefined && fmt !== "bullet" && fmt !== "none";
  return { listType: ordered ? "orderedList" : "bulletList", depth: clamp(ilvl + 1, 1, 9) };
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

function walkBody(nodes: XNode[], ctx: Ctx, out: FlatEntry[]): void {
  for (const n of nodes) {
    if (n.tag === "p") {
      const { inline, pp } = paragraphParts(n, ctx);
      out.push(entryOf(inline, pp, ctx));
    } else if (n.tag === "tbl") {
      for (const tr of kidsOf(n, "tr")) {
        const row = rowParts(tr, ctx);
        // Table rows are never list items, even when their first cell is a list paragraph.
        if (row) out.push(entryOf(row.inline, { ...row.pp, numId: undefined }, ctx));
      }
    } else if (n.tag === "sdt" || n.tag === "sdtContent" || n.tag === "customXml") {
      walkBody(n.kids, ctx, out);
    }
  }
}

function entryOf(inline: DocInline[], pp: PProps, ctx: Ctx): FlatEntry {
  const node: DocParagraph = inline.length
    ? { type: "paragraph", attrs: paragraphAttrs(pp), content: inline }
    : { type: "paragraph", attrs: paragraphAttrs(pp) };
  const list = listOf(pp, ctx);
  return list
    ? { node, listType: list.listType, depth: list.depth, bullet: true }
    : { node, listType: null, depth: 0, bullet: false };
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
 * A .docx as a version 4 document and its page setup. Throws DocxError when the file is not a readable .docx.
 * Every w:tab becomes a tab node: the editor shows a tab as the space to the next stop, so a right-aligned stop
 * (the usual "Company ⇥ City" row) lands the text on the right margin.
 */
export function docxToDoc(data: Uint8Array): { doc: DocJSON; page: PageSetup } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => KEEP.has(f.name) });
  } catch {
    throw new DocxError("That file isn't a readable Word (.docx) document.");
  }
  const { ctx, body } = readContext(files);
  const entries: FlatEntry[] = [];
  walkBody(body.kids, ctx, entries);
  return { doc: normalizeDoc(buildDoc(entries)), page: pageOf(body) };
}
