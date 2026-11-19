import { renderToBuffer } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { ResumePdf } from "@/components/ResumePdf";
import { listIndentDecorations, docFromJSON } from "@/lib/doc/extensions";
import { buildDoc, cleanListAttrs, flattenDoc, normalizeDoc, paragraph, type FlatEntry } from "@/lib/doc/model";
import type { DocJSON, DocList, DocListItem } from "@/lib/doc/types";
import { LIST_INDENT_PT, orderedMarker, renderBlocks } from "@/lib/docRender";
import { emptyResume, withDoc } from "@/lib/resume";

const item = (text: string, ...nested: DocList[]): DocListItem => ({
  type: "listItem",
  content: [paragraph(text), ...nested],
});
const bullets = (indentPt: number | null | undefined, ...items: DocListItem[]): DocList =>
  ({ type: "bulletList", ...(indentPt === undefined ? {} : { attrs: { indentPt } }), content: items }) as DocList;
const numbered = (attrs: Record<string, unknown>, ...items: DocListItem[]): DocList =>
  ({ type: "orderedList", attrs, content: items }) as DocList;
const docOf = (...content: DocList[]): DocJSON => ({ type: "doc", content });

describe("orderedMarker", () => {
  it("writes decimal, letters and roman numerals with a full stop", () => {
    expect(orderedMarker(3, "1")).toBe("3.");
    expect(orderedMarker(3, null)).toBe("3.");
    expect(orderedMarker(1, "a")).toBe("a.");
    expect(orderedMarker(26, "a")).toBe("z.");
    expect(orderedMarker(27, "a")).toBe("aa.");
    expect(orderedMarker(28, "A")).toBe("AB.");
    expect(orderedMarker(4, "i")).toBe("iv.");
    expect(orderedMarker(9, "i")).toBe("ix.");
    expect(orderedMarker(14, "I")).toBe("XIV.");
    expect(orderedMarker(1994, "i")).toBe("mcmxciv.");
  });

  it("falls back to decimal for numbers a style cannot write", () => {
    expect(orderedMarker(0, "a")).toBe("0.");
    expect(orderedMarker(2.5, "i")).toBe("2.5.");
    expect(orderedMarker(4000, "I")).toBe("4000.");
  });
});

describe("cleanListAttrs", () => {
  it("keeps valid type, start and indent, clamping the indent to 6..144", () => {
    expect(cleanListAttrs({ type: "A", start: 3, indentPt: 54 }, true)).toEqual({ type: "A", start: 3, indentPt: 54 });
    expect(cleanListAttrs({ indentPt: 2 }, false)).toEqual({ indentPt: 6 });
    expect(cleanListAttrs({ indentPt: 900 }, true)).toEqual({ indentPt: 144 });
  });

  it("drops unknown types, starts below 1 and non-finite indents", () => {
    expect(cleanListAttrs({ type: "x", start: 0, indentPt: Number.NaN }, true)).toBeUndefined();
    expect(cleanListAttrs({ type: "disc", start: 1.5 }, true)).toBeUndefined();
    expect(cleanListAttrs({ indentPt: "54" }, false)).toBeUndefined();
  });

  it("keeps only the indent on a bullet list", () => {
    expect(cleanListAttrs({ type: "a", start: 4, indentPt: 40 }, false)).toEqual({ indentPt: 40 });
  });
});

describe("list attrs through normalizeDoc", () => {
  it("keeps type, start and indentPt, and drops invalid ones", () => {
    const raw = {
      type: "doc",
      content: [
        { type: "orderedList", attrs: { type: "I", start: 5, indentPt: 72 }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] }] },
        { type: "bulletList", attrs: { indentPt: "x" }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] }] },
        { type: "orderedList", attrs: { type: "zz" }, content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "C" }] }] }] },
      ],
    };
    const doc = normalizeDoc(raw);
    expect(doc.content.map((b) => ("attrs" in b ? b.attrs : undefined))).toEqual([
      { type: "I", start: 5, indentPt: 72 },
      undefined,
      undefined,
    ]);
  });
});

describe("flattenDoc and buildDoc keep list attrs", () => {
  const doc = docOf(
    numbered({ type: "i", start: 2, indentPt: 60 }, item("one", bullets(90, item("nested")))),
    numbered({ type: "a" }, item("letters")),
  );

  it("carries the list's attrs on every paragraph of it", () => {
    const flat = flattenDoc(doc);
    expect(flat[0].listAttrs).toEqual({ type: "i", start: 2, indentPt: 60 });
    expect(flat[1].listAttrs).toEqual({ indentPt: 90 });
    expect(flat[2].listAttrs).toEqual({ type: "a" });
  });

  it("round-trips the attrs of nested and adjacent lists", () => {
    expect(buildDoc(flattenDoc(doc).map(toEntry))).toEqual(doc);
  });

  it("starts a new list when the attrs differ, and keeps merging when they match", () => {
    const entries: FlatEntry[] = [
      { node: paragraph("A"), listType: "orderedList", listAttrs: { type: "a" }, depth: 1, bullet: true },
      { node: paragraph("B"), listType: "orderedList", listAttrs: { type: "A" }, depth: 1, bullet: true },
      { node: paragraph("C"), listType: "orderedList", listAttrs: { type: "A" }, depth: 1, bullet: true },
    ];
    const built = buildDoc(entries);
    expect(built.content.map((b) => b.type)).toEqual(["orderedList", "orderedList"]);
    expect((built.content[1] as DocList).content).toHaveLength(2);
  });

  it("does not merge a bullet list into a list with another indent", () => {
    const entries: FlatEntry[] = [
      { node: paragraph("A"), listType: "bulletList", listAttrs: { indentPt: 30 }, depth: 1, bullet: true },
      { node: paragraph("B"), listType: "bulletList", listAttrs: { indentPt: 40 }, depth: 1, bullet: true },
    ];
    expect(buildDoc(entries).content).toHaveLength(2);
  });
});

/** A flat entry from a flat paragraph, as the helpers in extensions use them. */
function toEntry(p: ReturnType<typeof flattenDoc>[number]): FlatEntry {
  return { node: p.node, listType: p.listType, listAttrs: p.listAttrs, depth: p.depth, bullet: p.bullet };
}

describe("renderBlocks: list text positions and markers", () => {
  it("keeps the default indents and markers of a list with no attrs", () => {
    const blocks = renderBlocks(docOf(bullets(undefined, item("top", bullets(undefined, item("deep"))))));
    expect(blocks.map((b) => b.textIndentPt)).toEqual([LIST_INDENT_PT, 2 * LIST_INDENT_PT]);
    expect(blocks[0].marker).toMatchObject({ text: "•", x: 0, align: "left", gapPt: 0 });
    expect(blocks[1].marker).toMatchObject({ text: "◦", x: LIST_INDENT_PT, align: "left" });
  });

  it("starts the text at indentPt and right-aligns the marker before it", () => {
    const [p] = renderBlocks(docOf(numbered({ type: "a", indentPt: 54 }, item("letters"))));
    expect(p.textIndentPt).toBe(54);
    expect(p.marker).toMatchObject({ text: "a.", x: 0, align: "right", gapPt: 5 });
  });

  it("numbers with the list's type and start", () => {
    const blocks = renderBlocks(docOf(numbered({ type: "I", start: 4 }, item("four"), item("five"))));
    expect(blocks.map((b) => b.marker?.text)).toEqual(["IV.", "V."]);
  });

  it("nests a list without an indent from its parent's text, and a top-level one back at the default", () => {
    const blocks = renderBlocks(
      docOf(bullets(60, item("top", bullets(undefined, item("default child")))), bullets(undefined, item("x"))),
    );
    expect(blocks[0].textIndentPt).toBe(60);
    expect(blocks[1].textIndentPt).toBe(60 + LIST_INDENT_PT);
    expect(blocks[1].marker?.x).toBe(60);
    expect(blocks[2].textIndentPt).toBe(LIST_INDENT_PT);
  });

  it("clamps an out-of-range indent", () => {
    const [p] = renderBlocks(docOf(bullets(2, item("tiny"))));
    expect(p.textIndentPt).toBe(6);
  });
});

describe("editor list indents", () => {
  const paddings = (json: DocJSON) => {
    const set = listIndentDecorations(docFromJSON(json));
    // A node decoration's spec (its style) is not typed on Decoration, so read it from the decoration's type.
    return set.find().map((d) => (d as unknown as { type: { attrs: { style: string } } }).type.attrs.style);
  };

  it("draws no padding for lists without an indent", () => {
    expect(paddings(docOf(bullets(undefined, item("a"))))).toEqual([]);
  });

  it("gives a custom list padding from the content edge, and a nested one only the difference", () => {
    const json = docOf(bullets(60, item("outer", bullets(90, item("inner")))));
    expect(paddings(json)).toEqual(["padding-left: 60pt", "padding-left: 30pt"]);
  });

  it("keeps the indent in the schema attrs of the list", () => {
    const node = docFromJSON(docOf(numbered({ type: "a", indentPt: 54 }, item("x"))));
    expect(node.firstChild?.attrs).toMatchObject({ type: "a", indentPt: 54 });
  });
});

describe("ResumePdf with list indents and numbering styles", () => {
  it("renders custom indents, every numbering style and a shape marker to a PDF", async () => {
    const doc = docOf(
      numbered({ type: "a", indentPt: 40 }, item("first"), item("second", bullets(12, item("tiny indent")))),
      numbered({ type: "I", start: 9 }, item("roman")),
      bullets(72, item("wide indent")),
    );
    const buffer = await renderToBuffer(ResumePdf({ resume: withDoc(emptyResume(), doc) }));
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});
