import { describe, expect, it } from "vitest";
import {
  buildDoc,
  docEquals,
  docPlainText,
  emptyDoc,
  ensureIds,
  findParagraph,
  flattenDoc,
  insertParagraphsAfter,
  normalizeDoc,
  paragraph,
  paragraphText,
  removeParagraphs,
  setParagraphText,
  type FlatEntry,
} from "@/lib/doc/model";
import type { DocJSON, DocParagraph } from "@/lib/doc/types";

const bullet = (id: string, text: string, depth = 1, listType: FlatEntry["listType"] = "bulletList", isBullet = true): FlatEntry => ({
  node: paragraph(text, { attrs: { id } }),
  listType,
  depth,
  bullet: isBullet,
});
const plain = (id: string, text: string): FlatEntry => ({ node: paragraph(text, { attrs: { id } }), listType: null, depth: 0, bullet: false });

/** A doc with a plain paragraph, a bullet list with two items (the second with a nested list), and a plain line. */
function sample(): DocJSON {
  return {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { id: "p1" }, content: [{ type: "text", text: "Intro" }] },
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", attrs: { id: "b1" }, content: [{ type: "text", text: "First" }] },
              { type: "paragraph", attrs: { id: "b1c" }, content: [{ type: "text", text: "continued" }] },
            ],
          },
          {
            type: "listItem",
            content: [
              { type: "paragraph", attrs: { id: "b2" }, content: [{ type: "text", text: "Second" }] },
              {
                type: "bulletList",
                content: [{ type: "listItem", content: [{ type: "paragraph", attrs: { id: "b2a" }, content: [{ type: "text", text: "Nested" }] }] }],
              },
            ],
          },
        ],
      },
      { type: "paragraph", attrs: { id: "p2" }, content: [{ type: "text", text: "Outro" }] },
    ],
  };
}

describe("paragraph helpers", () => {
  it("builds tabs and hard breaks from text and gives fresh ids", () => {
    const p = paragraph("Acme\tBoston\nline 2");
    expect(p.content).toEqual([
      { type: "text", text: "Acme" },
      { type: "tab" },
      { type: "text", text: "Boston" },
      { type: "hardBreak" },
      { type: "text", text: "line 2" },
    ]);
    expect(p.attrs.id).toMatch(/^\w{8}$/);
    expect(paragraphText(p)).toBe("Acme\tBoston\nline 2");
  });

  it("gives every text run the marks and keeps a given id; empty text has no content key", () => {
    const p = paragraph("Hi", { marks: [{ type: "bold" }], attrs: { id: "keep-me" } });
    expect(p.attrs.id).toBe("keep-me");
    expect(p.content).toEqual([{ type: "text", text: "Hi", marks: [{ type: "bold" }] }]);
    expect(paragraph("")).not.toHaveProperty("content");
  });

  it("emptyDoc has one empty paragraph with an id", () => {
    const d = emptyDoc();
    expect(d.content).toHaveLength(1);
    expect(d.content[0]).toMatchObject({ type: "paragraph" });
    expect((d.content[0] as DocParagraph).attrs.id).toBeTruthy();
  });
});

describe("flattenDoc and buildDoc", () => {
  it("lists every paragraph in order with list depth and bullet flags", () => {
    const flat = flattenDoc(sample());
    expect(flat.map((p) => [p.id, p.listType, p.depth, p.bullet])).toEqual([
      ["p1", null, 0, false],
      ["b1", "bulletList", 1, true],
      ["b1c", "bulletList", 1, false],
      ["b2", "bulletList", 1, true],
      ["b2a", "bulletList", 2, true],
      ["p2", null, 0, false],
    ]);
    expect(flat[1].text).toBe("First");
  });

  it("skips horizontal rules", () => {
    const d: DocJSON = { type: "doc", content: [plain("a", "A").node, { type: "horizontalRule" }, plain("b", "B").node] };
    expect(flattenDoc(d).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("round-trips nested lists, continuation paragraphs and ordered lists", () => {
    const d = sample();
    expect(docEquals(buildDoc(flattenDoc(d).map(toEntry)), d)).toBe(true);
    const ordered: DocJSON = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", attrs: { id: "o1" }, content: [{ type: "text", text: "One" }] }] },
            { type: "listItem", content: [{ type: "paragraph", attrs: { id: "o2" }, content: [{ type: "text", text: "Two" }] }] },
          ],
        },
      ],
    };
    expect(docEquals(buildDoc(flattenDoc(ordered).map(toEntry)), ordered)).toBe(true);
  });

  it("builds a list type change as two lists and an empty input as emptyDoc", () => {
    const d = buildDoc([bullet("a", "A"), bullet("b", "B", 1, "orderedList")]);
    expect(d.content.map((b) => b.type)).toEqual(["bulletList", "orderedList"]);
    expect(flattenDoc(buildDoc([])).map((p) => p.text)).toEqual([""]);
  });

  it("a deeper entry nests in the current item; a continuation at depth 1 returns to it", () => {
    const d = buildDoc([bullet("a", "A"), bullet("b", "B", 2), bullet("c", "C", 1, "bulletList", false)]);
    expect(d.content).toHaveLength(1);
    const list = d.content[0] as { content: { content: { type: string }[] }[] };
    expect(list.content).toHaveLength(1);
    expect(list.content[0].content.map((c) => c.type)).toEqual(["paragraph", "bulletList", "paragraph"]);
  });
});

function toEntry(p: ReturnType<typeof flattenDoc>[number]): FlatEntry {
  return { node: p.node, listType: p.listType, depth: p.depth, bullet: p.bullet };
}

describe("docPlainText", () => {
  it("prefixes list items, indents nesting, and turns tabs into four spaces", () => {
    const d = buildDoc([plain("p", "Intro\tRight"), bullet("b", "First"), bullet("c", "Nested", 2), plain("q", "Outro")]);
    expect(docPlainText(d)).toBe("Intro    Right\n• First\n  • Nested\nOutro");
  });

  it("numbers ordered items", () => {
    const d = buildDoc([bullet("a", "One", 1, "orderedList"), bullet("b", "Two", 1, "orderedList")]);
    expect(docPlainText(d)).toBe("1. One\n2. Two");
  });
});

describe("findParagraph and setParagraphText", () => {
  it("finds paragraphs anywhere, or null", () => {
    expect(findParagraph(sample(), "b2a")?.text).toBe("Nested");
    expect(findParagraph(sample(), "nope")).toBeNull();
  });

  it("replaces the text and keeps the attrs and the first run's marks", () => {
    const d: DocJSON = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "t", textAlign: "center" }, content: [{ type: "text", text: "Harvard", marks: [{ type: "bold" }] }] }],
    };
    const out = setParagraphText(d, "t", "Yale");
    expect(out.content[0]).toEqual({ type: "paragraph", attrs: { id: "t", textAlign: "center" }, content: [{ type: "text", text: "Yale", marks: [{ type: "bold" }] }] });
    expect(d.content[0]).toHaveProperty("content.0.text", "Harvard"); // input untouched
  });

  it("gives the part after a tab the marks of the first run after the old tab", () => {
    const d: DocJSON = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "t" },
          content: [
            { type: "text", text: "Acme", marks: [{ type: "bold" }] },
            { type: "tab" },
            { type: "text", text: "Boston", marks: [{ type: "italic" }] },
          ],
        },
      ],
    };
    const out = setParagraphText(d, "t", "Beta\tCambridge");
    expect((out.content[0] as DocParagraph).content).toEqual([
      { type: "text", text: "Beta", marks: [{ type: "bold" }] },
      { type: "tab" },
      { type: "text", text: "Cambridge", marks: [{ type: "italic" }] },
    ]);
  });

  it("returns the same doc for an unknown id", () => {
    const d = sample();
    expect(setParagraphText(d, "nope", "x")).toBe(d);
  });
});

describe("removeParagraphs and insertParagraphsAfter", () => {
  it("removes paragraphs and collapses lists that become empty", () => {
    const d = removeParagraphs(sample(), ["b1", "b1c", "b2", "b2a"]);
    expect(d.content.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(flattenDoc(d).map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("never returns a doc without paragraphs", () => {
    const d = removeParagraphs(sample(), ["p1", "b1", "b1c", "b2", "b2a", "p2"]);
    expect(flattenDoc(d)).toHaveLength(1);
    expect(d.content.length).toBeGreaterThan(0);
  });

  it("keeps horizontal rules when removing", () => {
    const d: DocJSON = { type: "doc", content: [plain("a", "A").node, { type: "horizontalRule" }, plain("b", "B").node] };
    expect(removeParagraphs(d, ["a"]).content.map((b) => b.type)).toEqual(["horizontalRule", "paragraph"]);
  });

  it("inserts a bullet into a list after a bullet", () => {
    const out = insertParagraphsAfter(sample(), "b1c", [bullet("new", "Inserted")]);
    const flat = flattenDoc(out).map((p) => [p.id, p.depth, p.bullet]);
    expect(flat.slice(0, 4)).toEqual([["p1", 0, false], ["b1", 1, true], ["b1c", 1, false], ["new", 1, true]]);
    expect(out.content[1].type).toBe("bulletList");
    expect(out.content).toHaveLength(3);
  });

  it("inserts a plain paragraph after a plain paragraph", () => {
    const out = insertParagraphsAfter(sample(), "p1", [plain("n", "New line")]);
    expect(flattenDoc(out).map((p) => p.id)).toEqual(["p1", "n", "b1", "b1c", "b2", "b2a", "p2"]);
  });

  it("inserts at the start with null, and at the end for an unknown id", () => {
    expect(flattenDoc(insertParagraphsAfter(sample(), null, [plain("s", "Start")]))[0].id).toBe("s");
    const end = flattenDoc(insertParagraphsAfter(sample(), "unknown", [plain("e", "End")]));
    expect(end[end.length - 1].id).toBe("e");
  });

  it("gives inserted paragraphs fresh ids when they clash", () => {
    const out = insertParagraphsAfter(sample(), "p1", [plain("p2", "Clash")]);
    const ids = flattenDoc(out).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("p2");
  });
});

describe("ensureIds", () => {
  it("keeps the first occurrence of a duplicate id and renames the rest", () => {
    const d: DocJSON = {
      type: "doc",
      content: [
        { type: "paragraph", attrs: { id: "dup" }, content: [{ type: "text", text: "A" }] },
        { type: "paragraph", attrs: { id: "dup" }, content: [{ type: "text", text: "B" }] },
        { type: "paragraph", attrs: { id: "" }, content: [{ type: "text", text: "C" }] },
        { type: "paragraph", content: [{ type: "text", text: "D" }] } as unknown as DocParagraph,
      ],
    };
    const ids = flattenDoc(ensureIds(d)).map((p) => p.id);
    expect(ids[0]).toBe("dup");
    expect(new Set(ids).size).toBe(4);
    expect(ids.slice(1).every((id) => id.length >= 8)).toBe(true);
  });
});

describe("normalizeDoc", () => {
  it("drops unknown marks and bad attrs, keeps the valid ones, and ignores nulls (TipTap style)", () => {
    const raw = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { id: "x1", textAlign: "center", spaceBefore: null, lineHeight: 9, borderBottom: "yes", spaceAfter: 4 },
          content: [
            { type: "text", text: "Styled", marks: [{ type: "bold" }, { type: "color", attrs: { color: "red" } }, { type: "textStyle", attrs: { fontSize: "11pt", fontFamily: null } }] },
            { type: "text", text: "", marks: [{ type: "bold" }] },
            { type: "tab" },
          ],
        },
      ],
    };
    const d = normalizeDoc(raw);
    expect(d.content[0]).toEqual({
      type: "paragraph",
      attrs: { id: "x1", textAlign: "center", spaceAfter: 4 },
      content: [
        { type: "text", text: "Styled", marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontSize: "11pt" } }] },
        { type: "tab" },
      ],
    });
  });

  it("rejects font sizes out of range or malformed and families that are too long", () => {
    const d = normalizeDoc({
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "s" }, content: [{ type: "text", text: "x", marks: [{ type: "textStyle", attrs: { fontSize: "99pt", fontFamily: "F".repeat(65) } }, { type: "textStyle", attrs: { fontSize: "11px" } }] }] }],
    });
    expect(d.content[0]).toEqual({ type: "paragraph", attrs: { id: "s" }, content: [{ type: "text", text: "x" }] });
  });

  it("keeps the text of unknown blocks as plain paragraphs", () => {
    const d = normalizeDoc({
      type: "doc",
      content: [
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted" }] }] },
        { type: "codeBlock", content: [{ type: "text", text: "code line" }] },
        { type: "image", attrs: { src: "x.png" } },
      ],
    });
    expect(flattenDoc(d).map((p) => p.text)).toEqual(["Quoted", "code line"]);
  });

  it("handles missing content, null and junk", () => {
    expect(flattenDoc(normalizeDoc(null)).map((p) => p.text)).toEqual([""]);
    expect(flattenDoc(normalizeDoc("nope")).map((p) => p.text)).toEqual([""]);
    const d = normalizeDoc({ type: "doc", content: [{ type: "paragraph" }, { type: "bulletList", content: [] }, 42] });
    expect(flattenDoc(d)).toHaveLength(1);
    expect(d.content.every((b) => b.type === "paragraph")).toBe(true);
  });

  it("gives every list item a paragraph first and gives ids to paragraphs without one", () => {
    const d = normalizeDoc({
      type: "doc",
      content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "deep" }] }] }] }] }] }],
    });
    const item = (d.content[0] as { content: { content: { type: string }[] }[] }).content[0];
    expect(item.content[0].type).toBe("paragraph");
    expect(flattenDoc(d).map((p) => p.text)).toEqual(["", "deep"]);
    expect(flattenDoc(d).every((p) => p.id)).toBe(true);
  });

  it("is idempotent on its own output", () => {
    const once = normalizeDoc(sample());
    expect(normalizeDoc(once)).toEqual(once);
  });
});

describe("docEquals", () => {
  it("ignores null-valued attrs and absent-vs-empty content", () => {
    const a: DocJSON = { type: "doc", content: [{ type: "paragraph", attrs: { id: "q", textAlign: null }, content: [] }] };
    const b: DocJSON = { type: "doc", content: [{ type: "paragraph", attrs: { id: "q" } }] };
    expect(docEquals(a, b)).toBe(true);
  });

  it("sees different text, marks or ids", () => {
    const a = sample();
    const b = sample();
    expect(docEquals(a, b)).toBe(true);
    const c = setParagraphText(sample(), "p2", "Other");
    expect(docEquals(a, c)).toBe(false);
    const d = sample();
    (d.content[0] as DocParagraph).attrs.id = "other";
    expect(docEquals(a, d)).toBe(false);
  });
});
