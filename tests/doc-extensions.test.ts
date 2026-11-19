import { describe, expect, it } from "vitest";
import { docExtensions, docFromJSON, docSchema, findIdFixes, isValidDoc, newParagraphId } from "@/lib/doc/extensions";
import { cssFontStack, isSerifFamily } from "@/lib/doc/fonts";
import type { DocJSON } from "@/lib/doc/types";

/** Paragraph attrs as TipTap writes them: every attr is present, unset ones are null. */
const para = (id: string, attrs: Record<string, unknown> = {}) => ({
  id,
  textAlign: null,
  spaceBefore: null,
  spaceAfter: null,
  lineHeight: null,
  borderBottom: null,
  ...attrs,
});

const realistic: DocJSON = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: para("name00001", { textAlign: "center" }),
      content: [
        {
          type: "text",
          text: "Jane Doe",
          // Mark order is schema order (textStyle before bold), as ProseMirror writes it.
          marks: [
            { type: "textStyle", attrs: { fontSize: "16pt", fontFamily: "Calibri" } },
            { type: "bold" },
          ],
        },
      ],
    },
    {
      type: "paragraph",
      attrs: para("contact002", { textAlign: "center" }),
      content: [{ type: "text", text: "Boston, MA | jane@example.com" }],
    },
    {
      type: "paragraph",
      attrs: para("head00003", { spaceBefore: 6, borderBottom: true }),
      content: [{ type: "text", text: "EXPERIENCE", marks: [{ type: "bold" }] }],
    },
    {
      type: "paragraph",
      attrs: para("job000004"),
      content: [
        { type: "text", text: "Acme Corp", marks: [{ type: "bold" }] },
        { type: "tab" },
        { type: "text", text: "Boston, MA" },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", attrs: para("bullet0005"), content: [{ type: "text", text: "Shipped the thing" }] }],
        },
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: para("bullet0006", { lineHeight: 1.5, spaceAfter: 2 }),
              content: [
                { type: "text", text: "Line one" },
                { type: "hardBreak" },
                { type: "text", text: "Line two", marks: [{ type: "italic" }] },
              ],
            },
          ],
        },
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 1, type: null } as { start?: number }, // TipTap also writes type: null
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              attrs: para("ordered007", {
                textAlign: "justify",
              }),
              content: [
                {
                  type: "text",
                  text: "Serif body",
                  marks: [{ type: "textStyle", attrs: { fontSize: "11pt", fontFamily: "Times New Roman" } }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("docSchema", () => {
  it("accepts a realistic document and round-trips it through TipTap's JSON", () => {
    expect(isValidDoc(realistic)).toBe(true);
    expect(docFromJSON(realistic).toJSON()).toEqual(realistic);
  });

  it("writes every paragraph attr, with null for unset ones", () => {
    const json = docFromJSON({ type: "doc", content: [{ type: "paragraph", attrs: para("abcdefgh") }] }).toJSON();
    expect(json.content?.[0].attrs).toEqual(para("abcdefgh"));
  });

  it("rejects unknown node types and a listItem directly in the doc", () => {
    expect(isValidDoc({ type: "doc", content: [{ type: "sectionTitle", content: [] }] })).toBe(false);
    expect(isValidDoc({ type: "doc", content: [{ type: "horizontalRule" }] })).toBe(false);
    expect(
      isValidDoc({ type: "doc", content: [{ type: "listItem", content: [{ type: "paragraph", attrs: para("x1x1x1x1") }] }] }),
    ).toBe(false);
  });

  it("rejects non-documents and bad content", () => {
    expect(isValidDoc(null)).toBe(false);
    expect(isValidDoc("doc")).toBe(false);
    expect(isValidDoc({ type: "paragraph", attrs: para("abcdefgh") })).toBe(false);
    expect(isValidDoc({ type: "doc", content: [{ type: "bulletList", content: [] }] })).toBe(false);
  });

  it("does not allow the removed StarterKit nodes", () => {
    const names = Object.keys(docSchema.nodes);
    expect(names).toEqual(expect.arrayContaining(["paragraph", "bulletList", "orderedList", "listItem", "tab", "hardBreak"]));
    for (const gone of ["heading", "blockquote", "codeBlock", "link", "horizontalRule"]) expect(names).not.toContain(gone);
    expect(docExtensions.length).toBeGreaterThan(0);
  });
});

describe("paragraph ids", () => {
  const withIds = (ids: (string | null)[]) =>
    docFromJSON({
      type: "doc",
      content: ids.map((id) => ({ type: "paragraph", attrs: para(id as string), content: [] })),
    } as unknown as DocJSON);

  it("fills in missing ids and keeps the first of each duplicate", () => {
    const doc = withIds(["aaaaaaaa", null, "aaaaaaaa", "bbbbbbbb", "", "bbbbbbbb"]);
    const fixes = findIdFixes(doc);
    // Fixes for paragraphs 1, 2, 4, 5 (0-based): the first "aaaaaaaa" and "bbbbbbbb" keep their ids.
    let pos = 0;
    const positions: number[] = [];
    doc.forEach((child) => {
      positions.push(pos);
      pos += child.nodeSize;
    });
    expect(fixes.map((f) => f.pos)).toEqual([positions[1], positions[2], positions[4], positions[5]]);
    expect(new Set(fixes.map((f) => f.id)).size).toBe(4);
  });

  it("does nothing when every id is unique", () => {
    expect(findIdFixes(withIds(["aaaaaaaa", "bbbbbbbb"]))).toEqual([]);
  });

  it("generates 8-character ids that avoid the taken set", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = newParagraphId(taken);
      expect(id).toMatch(/^[a-z0-9]{8}$/);
      expect(taken.has(id)).toBe(false);
      taken.add(id);
    }
  });
});

describe("fonts", () => {
  it("maps the menu fonts to their fallback stacks", () => {
    expect(cssFontStack("Calibri")).toBe(`Calibri, Carlito, "Segoe UI", Arial, sans-serif`);
    expect(cssFontStack("Arial")).toBe("Arial, Helvetica, Arimo, sans-serif");
    expect(cssFontStack("Times New Roman")).toBe(`"Times New Roman", Times, Tinos, serif`);
    expect(cssFontStack("Georgia")).toBe(`Georgia, "Times New Roman", serif`);
    expect(cssFontStack("Garamond")).toBe(`Garamond, "EB Garamond", "Times New Roman", serif`);
    expect(cssFontStack("Times")).toBe(`"Times New Roman", Times, Tinos, serif`);
    expect(cssFontStack("Helvetica")).toBe("Arial, Helvetica, Arimo, sans-serif");
  });

  it("falls back to the default font for empty input", () => {
    expect(cssFontStack(null)).toBe(cssFontStack("Calibri"));
    expect(cssFontStack(undefined)).toBe(cssFontStack("Calibri"));
    expect(cssFontStack("  ")).toBe(cssFontStack("Calibri"));
  });

  it("guesses serif for other names and quotes them", () => {
    expect(cssFontStack("Palatino Linotype")).toBe(`"Palatino Linotype", serif`);
    expect(cssFontStack("Verdana")).toBe(`"Verdana", sans-serif`);
    expect(cssFontStack('Odd "name"')).toBe(`"Odd \\"name\\"", sans-serif`);
  });

  it("classifies serif families", () => {
    for (const name of ["Times New Roman", "EB Garamond", "Georgia", "Cambria", "Book Antiqua", "Palatino", "Baskerville", "Didot", "Minion Pro", "Caslon", "Noto Serif"]) {
      expect(isSerifFamily(name)).toBe(true);
    }
    for (const name of ["Calibri", "Arial", "Helvetica", "Verdana", "Noto Sans Serif", ""]) {
      expect(isSerifFamily(name)).toBe(false);
    }
  });
});
