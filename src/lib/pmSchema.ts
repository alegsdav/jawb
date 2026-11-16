import { Node as PMNode, Schema, type DOMOutputSpec, type TagParseRule } from "prosemirror-model";
import { LINE_KINDS, type DocLine, type LineKind, type LinePart } from "./docLineTypes";
import type { TextStyle } from "./types";

const isLineKind = (v: unknown): v is LineKind => (LINE_KINDS as readonly unknown[]).includes(v);

/** Ids and styles are optional; a null attr means "not set". */
const optionalAttr = { default: null };

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
      };
    },
  },
  // 2-4. Plain HTML: list items, headings, paragraphs and divs.
  { tag: "li", getAttrs: () => ({ kind: "bullet" }) },
  { tag: "h1", getAttrs: () => ({ kind: "heading" }) },
  { tag: "h2", getAttrs: () => ({ kind: "heading" }) },
  { tag: "h3", getAttrs: () => ({ kind: "heading" }) },
  { tag: "h4", getAttrs: () => ({ kind: "heading" }) },
  { tag: "p", getAttrs: () => ({ kind: "text" }) },
  { tag: "div", getAttrs: () => ({ kind: "text" }) },
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
        style: optionalAttr,
        style2: optionalAttr,
      },
      toDOM(node): DOMOutputSpec {
        const a = node.attrs;
        const attrs: Record<string, string> = { class: `doc-line doc-line-${a.kind}`, "data-kind": a.kind };
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
  marks: {},
});

const lineType = docSchema.nodes.line;
const tabType = docSchema.nodes.tab;

const hasTab = (kind: LineKind) => kind === "entry" || kind === "role";

export function lineToNode(line: DocLine): PMNode {
  const attrs = {
    kind: line.kind,
    sid: line.sid ?? null,
    iid: line.iid ?? null,
    bid: line.bid ?? null,
    style: line.style ?? null,
    style2: line.style2 ?? null,
  };
  const content: PMNode[] = [];
  if (line.text) content.push(docSchema.text(line.text));
  if (hasTab(line.kind)) {
    content.push(tabType.create());
    if (line.right) content.push(docSchema.text(line.right));
  }
  return lineType.create(attrs, content);
}

export function linesToDoc(lines: DocLine[]): PMNode {
  const source = lines.length ? lines : [{ kind: "text" as const, text: "" }];
  return docSchema.node("doc", null, source.map(lineToNode));
}

export function nodeToLine(node: PMNode): DocLine {
  const a = node.attrs;
  const kind = a.kind as LineKind;
  const line: DocLine = { kind, text: "" };
  if (a.sid != null) line.sid = a.sid;
  if (a.iid != null) line.iid = a.iid;
  if (a.bid != null) line.bid = a.bid;
  if (a.style != null) line.style = a.style as TextStyle;
  if (a.style2 != null) line.style2 = a.style2 as TextStyle;

  if (hasTab(kind)) {
    let left = "";
    let right = "";
    let seenTab = false;
    node.forEach((child) => {
      if (child.type === tabType) {
        if (seenTab) right += " ";
        seenTab = true;
      } else if (seenTab) {
        right += child.text ?? "";
      } else {
        left += child.text ?? "";
      }
    });
    line.text = left;
    line.right = right;
  } else {
    let text = "";
    node.forEach((child) => {
      text += child.type === tabType ? " " : (child.text ?? "");
    });
    line.text = text;
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

/** Character used for a tab when searching text: one unit, never part of ": ". */
const TAB_CHAR = "\u0000";

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

  if (kind === "text") {
    // Each text character and each tab is one position, so string index == offset.
    let flat = "";
    node.forEach((child) => {
      flat += child.type === tabType ? TAB_CHAR : (child.text ?? "");
    });
    const i = flat.indexOf(": ");
    if (i < 0) return { part1: [0, size], part2: null };
    return { part1: [0, i], part2: [i + 2, size] };
  }

  return { part1: [0, size], part2: null };
}

export function partAtOffset(node: PMNode, offset: number): LinePart | null {
  const kind = node.attrs.kind as LineKind;
  if (kind === "bullet") return null;
  const { part1, part2 } = partRanges(node);
  if (hasTab(kind)) {
    return part2 === null || offset <= part1[1] ? 1 : 2;
  }
  if (kind === "text") {
    return part2 !== null && offset >= part2[0] ? 2 : 1;
  }
  return 1;
}
