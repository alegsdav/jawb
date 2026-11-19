/**
 * Pure, immutable helpers over the resume document (DocJSON, see ./types). No TipTap, no DOM.
 * Inputs are never mutated; every helper returns new objects (or the same object when nothing changes).
 */
import type {
  DocBlock,
  DocInline,
  DocJSON,
  DocList,
  DocListItem,
  DocMark,
  DocParagraph,
  DocText,
  FlatParagraph,
  ParagraphAttrs,
} from "./types";

/** An 8-character random id (same alphabet and style as uid() in resume.ts). */
export const newId = (): string => {
  let s = "";
  while (s.length < 8) s += Math.random().toString(36).slice(2);
  return s.slice(0, 8);
};

/** One paragraph in document order, with the list it sits in (see FlatParagraph). */
export type FlatEntry = { node: DocParagraph; listType: FlatParagraph["listType"]; depth: number; bullet: boolean };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const isText = (n: DocInline | undefined): n is DocText => n?.type === "text";

function copyMarks(marks: DocMark[]): DocMark[] {
  return JSON.parse(JSON.stringify(marks)) as DocMark[];
}

function textNode(text: string, marks?: DocMark[]): DocText {
  return marks?.length ? { type: "text", text, marks: copyMarks(marks) } : { type: "text", text };
}

/**
 * Inline content for a string: "\t" becomes a tab node, "\n" a hard break, the rest text nodes. `marksFor`
 * gets whether the piece comes after the first tab of the string and returns the marks for that piece.
 */
function inlineFromText(text: string, marksFor: (afterTab: boolean) => DocMark[] | undefined): DocInline[] {
  const out: DocInline[] = [];
  let buf = "";
  let afterTab = false;
  const flush = () => {
    if (buf) out.push(textNode(buf, marksFor(afterTab)));
    buf = "";
  };
  for (const ch of text) {
    if (ch === "\t") {
      flush();
      out.push({ type: "tab" });
      afterTab = true;
    } else if (ch === "\n") {
      flush();
      out.push({ type: "hardBreak" });
    } else {
      buf += ch;
    }
  }
  flush();
  return out;
}

/** A paragraph with a fresh id (unless `attrs.id` is given) and the text as inline content. */
export function paragraph(text: string, opts: { marks?: DocMark[]; attrs?: Partial<ParagraphAttrs> } = {}): DocParagraph {
  const attrs: ParagraphAttrs = { ...opts.attrs, id: opts.attrs?.id || newId() };
  const content = inlineFromText(text, () => opts.marks);
  return content.length ? { type: "paragraph", attrs, content } : { type: "paragraph", attrs };
}

export function emptyDoc(): DocJSON {
  return { type: "doc", content: [paragraph("")] };
}

export function paragraphText(p: DocParagraph): string {
  let out = "";
  for (const n of p.content ?? []) {
    if (n.type === "text") out += n.text;
    else if (n.type === "tab") out += "\t";
    else if (n.type === "hardBreak") out += "\n";
  }
  return out;
}

/** Paragraph id, tolerant of data without attrs. */
const idOfPara = (p: DocParagraph): string => p.attrs?.id ?? "";

/** The document as a sequence of paragraphs (with list info), in order. */
function seqOf(doc: DocJSON): FlatEntry[] {
  const out: FlatEntry[] = [];
  const walkList = (list: DocList, depth: number) => {
    for (const li of list.content ?? []) {
      let first = true;
      for (const child of li.content ?? []) {
        if (child.type === "paragraph") {
          out.push({ node: child, listType: list.type, depth, bullet: first });
          first = false;
        } else if (child.type === "bulletList" || child.type === "orderedList") {
          walkList(child, depth + 1);
        }
      }
    }
  };
  for (const b of doc.content ?? []) {
    if (b.type === "paragraph") out.push({ node: b, listType: null, depth: 0, bullet: false });
    else if (b.type === "bulletList" || b.type === "orderedList") walkList(b, 1);
  }
  return out;
}

/**
 * Rebuild a document from the sequence. A list entry at depth d goes into the list at level d; a list of another
 * type at that level closes it; bullet:true starts a new list item, bullet:false continues the current one, and a
 * deeper entry nests inside the current item. A non-list paragraph closes all lists.
 */
function buildSeq(seq: FlatEntry[]): DocJSON {
  type Level = { list: DocList; item?: DocListItem };
  const content: DocBlock[] = [];
  let stack: Level[] = [];
  const newItem = (): DocListItem => ({ type: "listItem", content: [] });

  for (const e of seq) {
    if (e.listType === null) {
      stack = [];
      content.push({ ...e.node });
      continue;
    }
    const d = Math.max(1, e.depth);
    stack.length = Math.min(stack.length, d);
    if (stack.length === d && stack[d - 1].list.type !== e.listType) stack.length = d - 1;
    while (stack.length < d) {
      const level = stack.length + 1;
      const list = { type: e.listType, content: [] } as DocList;
      if (level === 1) {
        content.push(list);
      } else {
        const parent = stack[level - 2];
        if (!parent.item) {
          parent.item = newItem();
          parent.list.content.push(parent.item);
        }
        parent.item.content.push(list);
      }
      stack.push({ list });
    }
    const top = stack[d - 1];
    if (e.bullet || !top.item) {
      top.item = newItem();
      top.list.content.push(top.item);
    }
    top.item.content.push({ ...e.node });
  }
  return content.length ? { type: "doc", content } : emptyDoc();
}

/** Paragraphs in document order, including those in nested lists. */
export function flattenDoc(doc: DocJSON): FlatParagraph[] {
  const out: FlatParagraph[] = [];
  for (const e of seqOf(doc)) {
    out.push({
      id: idOfPara(e.node),
      node: e.node,
      text: paragraphText(e.node),
      listType: e.listType,
      depth: e.depth,
      bullet: e.listType ? e.bullet : false,
    });
  }
  return out;
}

/** Inverse of flattenDoc. Empty input gives emptyDoc(). */
export function buildDoc(entries: FlatEntry[]): DocJSON {
  return buildSeq(entries);
}

function plainList(list: DocList, depth: number, out: string[]): void {
  const indent = "  ".repeat(depth - 1);
  const start = list.type === "orderedList" ? (list.attrs?.start ?? 1) : 1;
  list.content.forEach((li, i) => {
    const marker = list.type === "orderedList" ? `${start + i}. ` : "• ";
    let first = true;
    for (const child of li.content ?? []) {
      if (child.type === "paragraph") {
        const text = paragraphText(child).replace(/\t/g, "    ");
        out.push(indent + (first ? marker : " ".repeat(marker.length)) + text);
        first = false;
      } else if (child.type === "bulletList" || child.type === "orderedList") {
        plainList(child, depth + 1, out);
      }
    }
  });
}

/** Plain text, one line per paragraph. List items get "• " or "N. " and two spaces of indent per extra depth. Tabs become 4 spaces. */
export function docPlainText(doc: DocJSON): string {
  const out: string[] = [];
  for (const b of doc.content ?? []) {
    if (b.type === "paragraph") out.push(paragraphText(b).replace(/\t/g, "    "));
    else if (b.type === "bulletList" || b.type === "orderedList") plainList(b, 1, out);
  }
  return out.join("\n");
}

export function findParagraph(doc: DocJSON, id: string): FlatParagraph | null {
  return flattenDoc(doc).find((p) => p.id === id) ?? null;
}

/** Applies fn to every paragraph (top level and in lists), in document order. */
function mapParagraphs(doc: DocJSON, fn: (p: DocParagraph) => DocParagraph): DocJSON {
  const mapList = (list: DocList): DocList =>
    ({
      ...list,
      content: list.content.map((li) => ({
        ...li,
        content: (li.content ?? []).map((c) => (c.type === "paragraph" ? fn(c) : mapList(c))),
      })),
    }) as DocList;
  const mapBlock = (b: DocBlock): DocBlock =>
    b.type === "paragraph" ? fn(b) : b.type === "bulletList" || b.type === "orderedList" ? mapList(b) : b;
  return { ...doc, content: (doc.content ?? []).map(mapBlock) };
}

function withContent(p: DocParagraph, content: DocInline[]): DocParagraph {
  const out: DocParagraph = { ...p };
  delete out.content;
  if (content.length) out.content = content;
  return out;
}

/**
 * Replace a paragraph's text, keeping its attrs. The new text takes the marks of the paragraph's first text run;
 * the part after a tab takes the marks of the first run after the old tab (if there was one).
 */
export function setParagraphText(doc: DocJSON, id: string, text: string): DocJSON {
  const found = findParagraph(doc, id);
  if (!found) return doc;
  const old = found.node.content ?? [];
  const firstMarks = old.find(isText)?.marks;
  const tabAt = old.findIndex((n) => n.type === "tab");
  const afterTabMarks = tabAt >= 0 ? old.slice(tabAt + 1).find(isText)?.marks ?? firstMarks : firstMarks;
  const content = inlineFromText(text, (after) => (after ? afterTabMarks : firstMarks));
  return mapParagraphs(doc, (p) => (idOfPara(p) === id ? withContent(p, content) : p));
}

const countParagraphs = (doc: DocJSON): number => flattenDoc(doc).length;

/** Remove the paragraphs with these ids. Lists left empty disappear. Never returns a doc with no paragraphs. */
export function removeParagraphs(doc: DocJSON, ids: Iterable<string>): DocJSON {
  const drop = new Set(ids);
  const seq = seqOf(doc);
  const kept = seq.filter((e) => !drop.has(idOfPara(e.node)));
  if (kept.length === seq.length) return doc;
  const out = buildSeq(kept);
  return countParagraphs(out) ? out : emptyDoc();
}

/**
 * Insert entries after the paragraph `afterId` (null = at the start; an unknown id = at the end). Entries whose ids
 * are missing, already used in the doc or repeated are given fresh ids. Lists are joined or split as needed.
 */
export function insertParagraphsAfter(doc: DocJSON, afterId: string | null, entries: FlatEntry[]): DocJSON {
  if (!entries.length) return doc;
  const seq = seqOf(doc);
  const used = new Set(seq.map((e) => idOfPara(e.node)));
  const fresh = entries.map((e): FlatEntry => {
    let id = e.node.attrs?.id;
    if (!id || used.has(id)) {
      id = newId();
      while (used.has(id)) id = newId();
    }
    used.add(id);
    return { ...e, node: { ...e.node, attrs: { ...e.node.attrs, id } } };
  });
  let at = 0;
  if (afterId !== null) {
    const idx = seq.findIndex((e) => idOfPara(e.node) === afterId);
    at = idx < 0 ? seq.length : idx + 1;
  }
  return buildSeq([...seq.slice(0, at), ...fresh, ...seq.slice(at)]);
}

/** Every paragraph gets a valid id; a missing or repeated id gets a fresh one (the first occurrence keeps its id). */
export function ensureIds(doc: DocJSON): DocJSON {
  const reserved = new Set(flattenDoc(doc).map((p) => p.id).filter(Boolean));
  const seen = new Set<string>();
  return mapParagraphs(doc, (p) => {
    const id = idOfPara(p);
    if (id && !seen.has(id)) {
      seen.add(id);
      return p;
    }
    let fresh = newId();
    while (reserved.has(fresh) || seen.has(fresh)) fresh = newId();
    seen.add(fresh);
    return { ...p, attrs: { ...p.attrs, id: fresh } };
  });
}

// ---- normalizeDoc: defensive reading of stored or untrusted JSON ----

const INLINE_TYPES = new Set(["text", "tab", "hardBreak"]);
const ALIGNS = new Set(["left", "center", "right", "justify"]);
const FONT_SIZE = /^\d+(\.\d+)?pt$/;

function cleanMark(raw: unknown): DocMark | undefined {
  if (!isObj(raw)) return undefined;
  if (raw.type === "bold") return { type: "bold" };
  if (raw.type === "italic") return { type: "italic" };
  if (raw.type === "underline") return { type: "underline" };
  if (raw.type !== "textStyle") return undefined;
  const a = isObj(raw.attrs) ? raw.attrs : {};
  const attrs: { fontSize?: string; fontFamily?: string } = {};
  if (typeof a.fontSize === "string" && FONT_SIZE.test(a.fontSize)) {
    const pt = parseFloat(a.fontSize);
    if (pt >= 6 && pt <= 72) attrs.fontSize = a.fontSize;
  }
  if (typeof a.fontFamily === "string" && a.fontFamily && a.fontFamily.length <= 64) attrs.fontFamily = a.fontFamily;
  return Object.keys(attrs).length ? { type: "textStyle", attrs } : undefined;
}

function cleanMarks(raw: unknown): DocMark[] | undefined {
  const out = arr(raw).map(cleanMark).filter((m): m is DocMark => m !== undefined);
  return out.length ? out : undefined;
}

/** Inline nodes from untrusted nodes. Unknown inline wrappers are unwrapped; text in them is kept. */
function inlineFrom(nodes: unknown[]): DocInline[] {
  const out: DocInline[] = [];
  for (const n of nodes) {
    if (!isObj(n)) continue;
    if (n.type === "tab") out.push({ type: "tab" });
    else if (n.type === "hardBreak") out.push({ type: "hardBreak" });
    else if (typeof n.text === "string") {
      const marks = cleanMarks(n.marks);
      out.push(...inlineFromText(n.text, () => marks));
    } else out.push(...inlineFrom(arr(n.content)));
  }
  return out;
}

const numIn = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;

function paragraphFrom(n: Record<string, unknown>): DocParagraph {
  const a = isObj(n.attrs) ? n.attrs : {};
  const attrs: ParagraphAttrs = { id: typeof a.id === "string" && a.id ? a.id : newId() };
  if (typeof a.textAlign === "string" && ALIGNS.has(a.textAlign)) attrs.textAlign = a.textAlign as ParagraphAttrs["textAlign"];
  const sb = numIn(a.spaceBefore, 0, 72);
  if (sb !== undefined) attrs.spaceBefore = sb;
  const sa = numIn(a.spaceAfter, 0, 72);
  if (sa !== undefined) attrs.spaceAfter = sa;
  const lh = numIn(a.lineHeight, 0.8, 3);
  if (lh !== undefined) attrs.lineHeight = lh;
  if (typeof a.borderBottom === "boolean") attrs.borderBottom = a.borderBottom;
  const content = inlineFrom(arr(n.content));
  return content.length ? { type: "paragraph", attrs, content } : { type: "paragraph", attrs };
}

function paragraphFromInline(content: DocInline[]): DocParagraph {
  return content.length ? { type: "paragraph", attrs: { id: newId() }, content } : { type: "paragraph", attrs: { id: newId() } };
}

function listItemFrom(li: Record<string, unknown>): DocListItem {
  const kids = li.type === "listItem" ? arr(li.content) : [li];
  let blocks = blocksFrom(kids);
  // A list item starts with its own paragraph (the line with the bullet).
  if (!blocks.length || blocks[0].type !== "paragraph") blocks = [paragraphFromInline([]), ...blocks];
  return { type: "listItem", content: blocks };
}

function listFrom(n: Record<string, unknown>): DocBlock[] {
  const items = arr(n.content).filter(isObj).map(listItemFrom);
  if (!items.length) return [];
  if (n.type !== "orderedList") return [{ type: "bulletList", content: items }];
  const start = isObj(n.attrs) ? n.attrs.start : undefined;
  const list: DocList = { type: "orderedList", content: items };
  if (typeof start === "number" && Number.isInteger(start) && start >= 1) list.attrs = { start };
  return [list];
}

function blockFrom(n: unknown): DocBlock[] {
  if (!isObj(n)) return [];
  if (n.type === "paragraph") return [paragraphFrom(n)];
  if (n.type === "bulletList" || n.type === "orderedList") return listFrom(n);
  // A stored horizontal line (older documents) is an empty paragraph with a bottom border.
  if (n.type === "horizontalRule") return [{ type: "paragraph", attrs: { id: newId(), borderBottom: true } }];
  if (Array.isArray(n.content)) return blocksFrom(n.content);
  // A leaf with text (or nothing): keep the text, drop the rest (images, embeds).
  return typeof n.text === "string" ? [paragraphFromInline(inlineFrom([n]))] : [];
}

/** Blocks from untrusted nodes. Runs of inline nodes become one paragraph each; unknown blocks keep their text. */
function blocksFrom(nodes: unknown[]): DocBlock[] {
  const out: DocBlock[] = [];
  let run: unknown[] = [];
  const flush = () => {
    if (run.length) out.push(paragraphFromInline(inlineFrom(run)));
    run = [];
  };
  for (const n of nodes) {
    if (isObj(n) && typeof n.type === "string" && INLINE_TYPES.has(n.type)) {
      run.push(n);
      continue;
    }
    flush();
    out.push(...blockFrom(n));
  }
  flush();
  return out;
}

/**
 * Defensive read of stored or untrusted document JSON: keeps only known node types, valid marks and attrs,
 * drops empty text, keeps the text of unknown blocks as plain paragraphs, and ensures ids and at least one paragraph.
 */
export function normalizeDoc(raw: unknown): DocJSON {
  const content = isObj(raw) ? blocksFrom(arr(raw.content)) : [];
  if (!content.length) return emptyDoc();
  if (!flattenDoc({ type: "doc", content }).length) content.push(paragraphFromInline([]));
  return ensureIds({ type: "doc", content });
}

// ---- docEquals ----

/** Canonical form for comparison: sorted keys, null and undefined dropped, empty content / marks / attrs dropped. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => canon(x));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x === null || x === undefined) continue;
      if ((k === "content" || k === "marks") && Array.isArray(x) && x.length === 0) continue;
      if (k === "attrs" && isObj(x) && Object.keys(x).length === 0) continue;
      out[k] = canon(x);
    }
    return out;
  }
  return v;
}

/** Structural equality, ignoring null-valued attrs and absent-vs-empty content. */
export function docEquals(a: DocJSON, b: DocJSON): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
