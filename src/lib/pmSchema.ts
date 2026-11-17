import { Node as PMNode, Mark as PMMark, Schema, type DOMOutputSpec, type TagParseRule } from "prosemirror-model";
import { LINE_KINDS, type DocLine, type LineKind, type LinePart } from "./docLineTypes";
import { DEFAULT_SIZE, MAX_SIZE, MIN_SIZE, cleanMarks, cleanPara, toRuns, type Format, type Run } from "./richText";
import type { Mark, Para } from "./types";

/** The marks the editor's document can carry (inline formatting). */
export const MARK_TYPES = ["bold", "italic", "underline", "size"] as const;

const BASE_PT = DEFAULT_SIZE;
const round1 = (n: number) => Math.round(n * 10) / 10;

const isLineKind = (v: unknown): v is LineKind => (LINE_KINDS as readonly unknown[]).includes(v);

/** Ids are optional; a null attr means "not set". */
const optionalAttr = { default: null };

/**
 * A length in points: "12pt", "16px" (x 0.75), "2em" (x 11, the 11pt base, so sizes stay relative to the page
 * font) or a bare number (points). Null when it does not parse.
 */
function toPt(value: string | null | undefined): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(pt|px|em)?\s*$/i.exec(value ?? "");
  if (!m) return null;
  const unit = (m[2] ?? "pt").toLowerCase();
  const factor = unit === "px" ? 0.75 : unit === "em" ? BASE_PT : 1;
  const n = Number(m[1]) * factor;
  return Number.isFinite(n) ? round1(n) : null;
}

/** A font-size value to points, or null when it is not a size the editor keeps (outside [8, 28], or 11). */
export function parseFontSize(value: string): number | null {
  const pt = toPt(value);
  if (pt === null || pt < MIN_SIZE || pt > MAX_SIZE || pt === BASE_PT) return null;
  return pt;
}

/** Paragraph formatting from a pasted or rendered element: our classes first, then text-align and margin-top. */
function paraFromElement(el: HTMLElement): Para | undefined {
  const raw: Record<string, unknown> = {};
  for (const align of ["center", "right", "justify"]) {
    if (el.classList.contains(`doc-align-${align}`)) raw.align = align;
  }
  if (!raw.align) raw.align = el.style.textAlign;
  raw.rule = el.classList.contains("doc-rule");
  raw.caps = el.classList.contains("doc-caps");
  const spaceBefore = toPt(el.style.marginTop);
  if (spaceBefore !== null) raw.spaceBefore = spaceBefore;
  return cleanPara(raw);
}

const lineRule = (tag: string, kind: LineKind): TagParseRule => ({
  tag,
  getAttrs: (dom) => ({ kind, para: paraFromElement(dom as HTMLElement) ?? null }),
});

const lineParseRules: TagParseRule[] = [
  // 1. Our own lines, and any element that carries a data-kind (pasted from this editor).
  {
    tag: "[data-kind]",
    getAttrs: (dom) => {
      const el = dom as HTMLElement;
      const raw = el.getAttribute("data-kind");
      return {
        kind: isLineKind(raw) ? raw : "text",
        sid: el.getAttribute("data-sid"),
        iid: el.getAttribute("data-iid"),
        bid: el.getAttribute("data-bid"),
        para: paraFromElement(el) ?? null,
      };
    },
  },
  // 2-4. Plain HTML (and pasted Google Docs / Word): list items, headings, paragraphs and divs.
  lineRule("li", "bullet"),
  lineRule("h1", "heading"),
  lineRule("h2", "heading"),
  lineRule("h3", "heading"),
  lineRule("h4", "heading"),
  lineRule("p", "text"),
  lineRule("div", "text"),
];

export const docSchema: Schema = new Schema({
  nodes: {
    doc: { content: "line+" },
    line: {
      content: "inline*",
      group: "block",
      defining: true,
      attrs: {
        kind: { default: "text" },
        sid: optionalAttr,
        iid: optionalAttr,
        bid: optionalAttr,
        para: optionalAttr,
      },
      toDOM(node): DOMOutputSpec {
        const a = node.attrs;
        const para = cleanPara(a.para);
        const classes = ["doc-line", `doc-line-${a.kind}`];
        if (para?.align) classes.push(`doc-align-${para.align}`);
        if (para?.rule) classes.push("doc-rule");
        if (para?.caps) classes.push("doc-caps");
        const attrs: Record<string, string> = { class: classes.join(" "), "data-kind": a.kind };
        if (para?.spaceBefore) attrs.style = `margin-top: ${+(para.spaceBefore / BASE_PT).toFixed(4)}em`;
        if (a.sid != null) attrs["data-sid"] = a.sid;
        if (a.iid != null) attrs["data-iid"] = a.iid;
        if (a.bid != null) attrs["data-bid"] = a.bid;
        return ["div", attrs, 0];
      },
      parseDOM: lineParseRules,
    },
    text: { group: "inline" },
    tab: {
      inline: true,
      group: "inline",
      atom: true,
      selectable: false,
      toDOM: (): DOMOutputSpec => ["span", { class: "doc-tab", contenteditable: "false" }],
      parseDOM: [{ tag: "span.doc-tab" }],
    },
  },
  marks: {
    bold: {
      parseDOM: [
        { tag: "strong" },
        // Google Docs wraps its whole clipboard in <b style="font-weight:normal">: that is not bold.
        { tag: "b", getAttrs: (node) => (node as HTMLElement).style.fontWeight !== "normal" && null },
        { style: "font-weight", getAttrs: (v) => /^(bold(er)?|[6-9]\d\d)$/.test(v as string) && null },
      ],
      toDOM: (): DOMOutputSpec => ["strong", 0],
    },
    italic: {
      parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }],
      toDOM: (): DOMOutputSpec => ["em", 0],
    },
    underline: {
      parseDOM: [
        { tag: "u" },
        { style: "text-decoration", getAttrs: (v) => /underline/.test(v as string) && null },
        { style: "text-decoration-line", getAttrs: (v) => /underline/.test(v as string) && null },
      ],
      toDOM: (): DOMOutputSpec => ["u", 0],
    },
    size: {
      attrs: { pt: {} },
      parseDOM: [
        {
          style: "font-size",
          getAttrs: (v) => {
            const pt = parseFontSize(v as string);
            return pt === null ? false : { pt };
          },
        },
      ],
      // Relative to the 11pt base, so a phone layout can scale the whole page by one font-size.
      toDOM: (mark): DOMOutputSpec => [
        "span",
        { style: `font-size: ${+(Number(mark.attrs.pt) / BASE_PT).toFixed(4)}em` },
        0,
      ],
    },
  },
});

const lineType = docSchema.nodes.line;
const tabType = docSchema.nodes.tab;

const hasTab = (kind: LineKind) => kind === "entry" || kind === "role";

/** Text nodes for one plain-text field, each carrying the schema marks of its run. */
function runNodes(text: string, marks?: Mark[]): PMNode[] {
  return toRuns(text, marks).map((r) => docSchema.text(r.text, runMarks(r)));
}

function runMarks(r: Run): PMMark[] {
  const out: PMMark[] = [];
  if (r.bold) out.push(docSchema.marks.bold.create());
  if (r.italic) out.push(docSchema.marks.italic.create());
  if (r.underline) out.push(docSchema.marks.underline.create());
  if (r.size !== BASE_PT) out.push(docSchema.marks.size.create({ pt: r.size }));
  return out;
}

export function lineToNode(line: DocLine): PMNode {
  const attrs = {
    kind: line.kind,
    sid: line.sid ?? null,
    iid: line.iid ?? null,
    bid: line.bid ?? null,
    para: cleanPara(line.para) ?? null,
  };
  const content: PMNode[] = runNodes(line.text, line.marks);
  if (hasTab(line.kind)) {
    content.push(tabType.create());
    content.push(...runNodes(line.right ?? "", line.rightMarks));
  }
  return lineType.create(attrs, content);
}

export function linesToDoc(lines: DocLine[]): PMNode {
  const source = lines.length ? lines : [{ kind: "text" as const, text: "" }];
  return docSchema.node("doc", null, source.map(lineToNode));
}

function formatOf(marks: readonly PMMark[]): Format {
  const f: Format = {};
  for (const m of marks) {
    if (m.type.name === "bold") f.bold = true;
    else if (m.type.name === "italic") f.italic = true;
    else if (m.type.name === "underline") f.underline = true;
    else if (m.type.name === "size") f.size = Number(m.attrs.pt);
  }
  return f;
}

type Acc = { text: string; marks: Mark[] };

function addText(acc: Acc, text: string, format: Format) {
  if (!text) return;
  if (Object.keys(format).length) {
    acc.marks.push({ from: acc.text.length, to: acc.text.length + text.length, ...format });
  }
  acc.text += text;
}

export function nodeToLine(node: PMNode): DocLine {
  const a = node.attrs;
  const kind = a.kind as LineKind;
  const line: DocLine = { kind, text: "" };
  if (a.sid != null) line.sid = a.sid;
  if (a.iid != null) line.iid = a.iid;
  if (a.bid != null) line.bid = a.bid;
  const para = cleanPara(a.para);
  if (para) line.para = para;

  // entry/role: everything before the first tab is the left part, after it the right part.
  // Further tabs count as one unformatted space.
  const split = hasTab(kind);
  const left: Acc = { text: "", marks: [] };
  const right: Acc = { text: "", marks: [] };
  let seenTab = false;
  node.forEach((child) => {
    if (child.type === tabType) {
      if (split && !seenTab) {
        seenTab = true;
        return;
      }
      addText(seenTab ? right : left, " ", {});
      return;
    }
    addText(seenTab ? right : left, child.text ?? "", formatOf(child.marks));
  });

  line.text = left.text;
  const lm = cleanMarks(left.marks, left.text.length);
  if (lm) line.marks = lm;
  if (split) {
    line.right = right.text;
    const rm = cleanMarks(right.marks, right.text.length);
    if (rm) line.rightMarks = rm;
  }
  return line;
}

export function docToLines(doc: PMNode): DocLine[] {
  const out: DocLine[] = [];
  doc.forEach((child) => out.push(nodeToLine(child)));
  return out;
}

const BULLET_MARKERS = ["•", "◦", "▪", "-", "–", "*", "·"];

/** Plain text (pasted) to lines. Tabs separate an entry's left and right parts. */
export function textToLines(text: string): DocLine[] {
  const out: DocLine[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if (!raw.trim()) continue;
    const trimmedStart = raw.trimStart();
    if (BULLET_MARKERS.includes(trimmedStart[0]) && /^\s/.test(trimmedStart.slice(1))) {
      out.push({ kind: "bullet", text: trimmedStart.slice(1).trim() });
    } else if (raw.includes("\t")) {
      const i = raw.indexOf("\t");
      out.push({
        kind: "entry",
        text: raw.slice(0, i).trim(),
        right: raw.slice(i + 1).replace(/\t/g, " ").trim(),
      });
    } else {
      out.push({ kind: "text", text: raw.trim() });
    }
  }
  return out;
}

/** Offsets of the line's parts. entry/role split at their first tab; every other line is one part. */
export function partRanges(node: PMNode): { part1: [number, number]; part2: [number, number] | null } {
  const size = node.content.size;
  const kind = node.attrs.kind as LineKind;

  if (hasTab(kind)) {
    let off = 0;
    let tabOff: number | null = null;
    node.forEach((child) => {
      if (tabOff === null && child.type === tabType) tabOff = off;
      off += child.nodeSize;
    });
    if (tabOff === null) return { part1: [0, size], part2: null };
    return { part1: [0, tabOff], part2: [tabOff + 1, size] };
  }

  return { part1: [0, size], part2: null };
}

export function partAtOffset(node: PMNode, offset: number): LinePart {
  const { part1, part2 } = partRanges(node);
  if (part2 === null) return 1;
  return offset <= part1[1] ? 1 : 2;
}
