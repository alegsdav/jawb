import { describe, expect, it } from "vitest";
import { docFromJSON, sizeDecorations } from "@/lib/doc/extensions";
import { paragraph } from "@/lib/doc/model";
import { DEFAULT_FONT_SIZE_PT, type DocInline, type DocJSON, type DocMark } from "@/lib/doc/types";
import { paragraphSizePt, renderBlocks } from "@/lib/docRender";

const size = (pt: string): DocMark => ({ type: "textStyle", attrs: { fontSize: pt, fontFamily: null } });
const bold: DocMark = { type: "bold" };

describe("paragraphSizePt (one rule for the editor, the read-only view and the PDF)", () => {
  it("is the largest run size in the paragraph", () => {
    const content: DocInline[] = [
      { type: "text", text: "Small ", marks: [size("9pt")] },
      { type: "text", text: "Big", marks: [size("14pt")] },
      { type: "tab" },
      { type: "text", text: "Medium", marks: [size("10.5pt")] },
    ];
    expect(paragraphSizePt(content)).toBe(14);
  });

  it("counts a run without a size mark as the document default", () => {
    expect(paragraphSizePt([{ type: "text", text: "plain" }])).toBe(DEFAULT_FONT_SIZE_PT);
    expect(paragraphSizePt([{ type: "text", text: "bold only", marks: [bold] }])).toBe(DEFAULT_FONT_SIZE_PT);
    // A 9pt run next to an unsized run: the unsized one is 11pt, so the paragraph is 11pt.
    expect(paragraphSizePt([{ type: "text", text: "9", marks: [size("9pt")] }, { type: "text", text: " plain" }])).toBe(11);
  });

  it("is the default for an empty paragraph", () => {
    expect(paragraphSizePt(undefined)).toBe(DEFAULT_FONT_SIZE_PT);
    expect(paragraphSizePt([])).toBe(DEFAULT_FONT_SIZE_PT);
  });

  it("is the size of a paragraph of 9pt text", () => {
    expect(paragraphSizePt([{ type: "text", text: "nine", marks: [size("9pt")] }])).toBe(9);
  });
});

describe("renderBlocks carries the paragraph size to the view and the PDF", () => {
  const doc: DocJSON = {
    type: "doc",
    content: [
      paragraph("Small line", { marks: [size("9pt")] }),
      paragraph("Plain line"),
      { type: "bulletList", content: [{ type: "listItem", content: [paragraph("Small bullet", { marks: [size("9pt")] })] }] },
    ],
  };
  const [small, plain, bullet] = renderBlocks(doc);

  it("gives each paragraph its size", () => {
    expect(small.sizePt).toBe(9);
    expect(plain.sizePt).toBe(DEFAULT_FONT_SIZE_PT);
  });

  it("sizes a bullet's marker from its paragraph, not from the first run's own size", () => {
    expect(bullet.marker).toMatchObject({ text: "•", style: { sizePt: 9 } });
  });
});

describe("sizeDecorations (the editor's paragraph and list item sizes)", () => {
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
    sizeDecorations(doc)
      .find()
      .map((d) => {
        // A node decoration keeps its attrs on its type (not in the typings).
        const attrs = (d as unknown as { type: { attrs: { style: string } } }).type.attrs;
        return [d.from, d.to, attrs.style];
      });

  it("decorates only paragraphs and list items whose size is not the default", () => {
    const sizes = decorated().map((d) => d[2]);
    // Paragraph "Nine", the list item and its first paragraph; "Eleven" and "Plain tail" keep the default.
    expect(sizes).toEqual(["font-size: 9pt", "font-size: 9pt", "font-size: 9pt"]);
  });

  it("sizes the list item from its first paragraph", () => {
    const [, item] = decorated();
    expect(doc.nodeAt(item[0] as number)?.type.name).toBe("listItem");
  });

  it("has no decorations when every paragraph is the default size", () => {
    const plain = docFromJSON({ type: "doc", content: [paragraph("Plain")] });
    expect(sizeDecorations(plain).find()).toEqual([]);
  });
});
