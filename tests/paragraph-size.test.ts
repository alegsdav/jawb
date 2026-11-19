import { describe, expect, it } from "vitest";
import { docFromJSON, strutDecorations } from "@/lib/doc/extensions";
import { paragraph } from "@/lib/doc/model";
import { DEFAULT_FONT_SIZE_PT, type DocInline, type DocJSON, type DocMark } from "@/lib/doc/types";
import { paragraphStrutPt, renderBlocks } from "@/lib/docRender";

const size = (pt: string): DocMark => ({ type: "textStyle", attrs: { fontSize: pt, fontFamily: null } });
const bold: DocMark = { type: "bold" };
const hardBreak: DocInline = { type: "hardBreak" };

describe("paragraphStrutPt (one rule for the editor, the read-only view and the PDF)", () => {
  it("is the smallest run size when every text run is sized", () => {
    const content: DocInline[] = [
      { type: "text", text: "Big", marks: [size("14pt")] },
      { type: "tab" },
      { type: "text", text: "Small", marks: [size("9pt")] },
    ];
    expect(paragraphStrutPt(content)).toBe(9);
  });

  it("is the default when any text has no size mark, so unsized text keeps its size", () => {
    // The name is 18pt; the contact line after the hard break is unsized, so the strut stays 11pt.
    const name: DocInline[] = [
      { type: "text", text: "Ada", marks: [bold, size("18pt")] },
      hardBreak,
      { type: "text", text: "London | ada@example.com" },
    ];
    expect(paragraphStrutPt(name)).toBe(DEFAULT_FONT_SIZE_PT);
    expect(paragraphStrutPt([{ type: "text", text: "plain" }])).toBe(DEFAULT_FONT_SIZE_PT);
    expect(paragraphStrutPt([{ type: "text", text: "bold only", marks: [bold] }])).toBe(DEFAULT_FONT_SIZE_PT);
  });

  it("ignores hard breaks and empty text when deciding whether text is unsized", () => {
    const content: DocInline[] = [{ type: "text", text: "Nine", marks: [size("9pt")] }, hardBreak, { type: "text", text: "" }];
    expect(paragraphStrutPt(content)).toBe(9);
  });

  it("is the default for an empty paragraph", () => {
    expect(paragraphStrutPt(undefined)).toBe(DEFAULT_FONT_SIZE_PT);
    expect(paragraphStrutPt([])).toBe(DEFAULT_FONT_SIZE_PT);
  });

  it("is the size of a paragraph of 9pt text", () => {
    expect(paragraphStrutPt([{ type: "text", text: "nine", marks: [size("9pt")] }])).toBe(9);
  });
});

describe("renderBlocks carries the strut to the view and the PDF", () => {
  const doc: DocJSON = {
    type: "doc",
    content: [
      paragraph("Small line", { marks: [size("9pt")] }),
      paragraph("Plain line"),
      { type: "bulletList", content: [{ type: "listItem", content: [paragraph("Small bullet", { marks: [size("9pt")] })] }] },
    ],
  };
  const [small, plain, bullet] = renderBlocks(doc);

  it("gives each paragraph its strut", () => {
    expect(small.strutPt).toBe(9);
    expect(plain.strutPt).toBe(DEFAULT_FONT_SIZE_PT);
  });

  it("sizes a bullet's marker from its paragraph, not from the first run's own size", () => {
    expect(bullet.marker).toMatchObject({ text: "•", style: { sizePt: 9 } });
  });

  it("keeps the name's 18pt run and the unsized contact line at 11pt in one paragraph", () => {
    const [name] = renderBlocks({
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "name" }, content: [{ type: "text", text: "Ada", marks: [bold, size("18pt")] }, hardBreak, { type: "text", text: "contact" }] }],
    });
    expect(name.strutPt).toBe(DEFAULT_FONT_SIZE_PT);
    expect(name.lines.map((l) => l.left.map((r) => r.style.sizePt))).toEqual([[18], [11]]);
  });
});

describe("strutDecorations (the editor's paragraph and list item struts)", () => {
  const doc = docFromJSON({
    type: "doc",
    content: [
      paragraph("Nine", { marks: [size("9pt")] }),
      paragraph("Eleven"),
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [paragraph("Nine bullet", { marks: [size("9pt")] }), paragraph("Plain tail")] },
        ],
      },
    ],
  });

  /** The decorated node ranges, as [from, to, style], in document order. */
  const decorated = () =>
    strutDecorations(doc)
      .find()
      .map((d) => {
        // A node decoration keeps its attrs on its type (not in the typings).
        const attrs = (d as unknown as { type: { attrs: { style: string } } }).type.attrs;
        return [d.from, d.to, attrs.style];
      });

  it("decorates only paragraphs and list items whose strut is not the default", () => {
    const sizes = decorated().map((d) => d[2]);
    // Paragraph "Nine", the list item and its first paragraph; "Eleven" and "Plain tail" keep the default.
    expect(sizes).toEqual(["font-size: 9pt", "font-size: 9pt", "font-size: 9pt"]);
  });

  it("sizes the list item from its first paragraph", () => {
    const [, item] = decorated();
    expect(doc.nodeAt(item[0] as number)?.type.name).toBe("listItem");
  });

  it("does not size a paragraph whose unsized text keeps the default strut", () => {
    const mixed = docFromJSON({
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "name" }, content: [{ type: "text", text: "Ada", marks: [bold, size("18pt")] }, hardBreak, { type: "text", text: "contact" }] }],
    });
    expect(strutDecorations(mixed).find()).toEqual([]);
  });

  it("has no decorations when every paragraph is the default size", () => {
    const plain = docFromJSON({ type: "doc", content: [paragraph("Plain")] });
    expect(strutDecorations(plain).find()).toEqual([]);
  });
});
