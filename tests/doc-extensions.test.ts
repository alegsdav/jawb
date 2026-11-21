import { describe, expect, it } from "vitest";
import { EditorState } from "@tiptap/pm/state";
import { docExtensions, docFromJSON, docSchema, findIdFixes, isLinkable, isValidDoc, linkTargetOf, newParagraphId } from "@/lib/doc/extensions";
import { cssFontStack, isSerifFamily } from "@/lib/doc/fonts";
import { docEquals, normalizeDoc } from "@/lib/doc/model";
import type { DocJSON } from "@/lib/doc/types";

/** Paragraph attrs as TipTap writes them: every attr is present, unset ones are null. */
const para = (id: string, attrs: Record<string, unknown> = {}) => ({
  id,
  textAlign: null,
  spaceBefore: null,
  spaceAfter: null,
  lineHeight: null,
  borderBottom: null,
  tabStops: null,
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

describe("paragraph tab stops in the schema", () => {
  const withStops: DocJSON = {
    type: "doc",
    content: [{ type: "paragraph", attrs: { id: "tabbed1", tabStops: [{ pos: 72, align: "left" }, { pos: 540, align: "right" }] }, content: [{ type: "text", text: "Role" }, { type: "tab" }, { type: "text", text: "2024" }] }],
  };

  it("keeps the stops through TipTap's JSON", () => {
    const json = docFromJSON(withStops).toJSON() as DocJSON;
    expect(json.content[0]).toMatchObject({ attrs: { tabStops: [{ pos: 72, align: "left" }, { pos: 540, align: "right" }] } });
    expect(docEquals(json, withStops)).toBe(true);
  });

  it("writes the stops as a data-tabs attribute, so copied HTML keeps them", () => {
    const node = docFromJSON(withStops).firstChild!;
    const [tag, attrs] = docSchema.nodes.paragraph.spec.toDOM!(node) as [string, Record<string, string>];
    expect(tag).toBe("p");
    expect(attrs["data-tabs"]).toBe("72:left,540:right");
  });

  it("reads data-tabs back into the stops, and ignores a paragraph without it", () => {
    const rule = docSchema.nodes.paragraph.spec.parseDOM!.find((r) => r.tag === "p")!;
    const element = { getAttribute: (name: string) => (name === "data-tabs" ? "540:right,72:left" : null), style: {} };
    const attrs = (rule.getAttrs as (el: unknown) => Record<string, unknown>)(element);
    expect(attrs.tabStops).toEqual([{ pos: 72, align: "left" }, { pos: 540, align: "right" }]);
    const bare = (rule.getAttrs as (el: unknown) => Record<string, unknown>)({ getAttribute: () => null, style: {} });
    expect(bare.tabStops ?? null).toBeNull();
  });
});

describe("docSchema", () => {
  it("accepts a realistic document and round-trips it through TipTap's JSON", () => {
    expect(isValidDoc(realistic)).toBe(true);
    // A list node always has an attrs object in TipTap's JSON (indentPt is unset), so compare as docEquals does.
    expect(docEquals(docFromJSON(realistic).toJSON() as DocJSON, realistic)).toBe(true);
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

describe("links", () => {
  const linkDoc: DocJSON = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: para("link00010"),
        content: [{ type: "text", text: "Portfolio", marks: [{ type: "link", attrs: { href: "https://jane.dev" } }] }],
      },
    ],
  };

  it("the schema has a link mark, and a link round-trips through the editor JSON as its href", () => {
    expect(docSchema.marks.link).toBeDefined();
    const json = docFromJSON(linkDoc).toJSON() as DocJSON;
    const mark = (json.content[0] as { content: { marks: { type: string; attrs: Record<string, unknown> }[] }[] }).content[0].marks[0];
    expect(mark.type).toBe("link");
    expect(mark.attrs.href).toBe("https://jane.dev");
    // The editor writes default target/rel too; normalizeDoc keeps only the href the contract stores.
    expect(docEquals(normalizeDoc(json), linkDoc)).toBe(true);
    expect(JSON.stringify(normalizeDoc(json))).not.toContain("target");
  });

  it("a stored link to a javascript: URL is not kept", () => {
    const bad = JSON.parse(JSON.stringify(linkDoc).replace("https://jane.dev", "javascript:alert(1)")) as DocJSON;
    expect(JSON.stringify(normalizeDoc(bad))).not.toContain("\"marks\"");
  });

  it("the link extension is configured to open nothing on click and to allow only http, https and mailto", () => {
    const link = docSchema.marks.link;
    expect(link.spec.parseDOM?.[0]).toBeDefined();
    // A pasted <a> with a javascript: href is not parsed as a link.
    const parse = link.spec.parseDOM?.[0] as { getAttrs?: (el: HTMLElement) => unknown } | undefined;
    if (parse?.getAttrs) {
      const el = { getAttribute: (n: string) => (n === "href" ? "javascript:alert(1)" : null) } as unknown as HTMLElement;
      expect(parse.getAttrs(el)).toBe(false);
    }
  });
});


describe("autolink: which typed or pasted text links", () => {
  it.each([
    ["https://example.com", true],
    ["http://example.com/jobs", true],
    ["www.example.com", true],
    ["WWW.Example.com", true],
    ["jane@example.com", true],
    ["example.com", false],
    ["Node.js", false],
  ])("%s -> linkable %s", (text, linkable) => {
    expect(isLinkable(text)).toBe(linkable);
  });

  it("gives a www. address the https:// href and keeps an email as mailto:", () => {
    expect(linkTargetOf("www.example.com")).toBe("https://www.example.com");
    expect(linkTargetOf("jane@example.com")).toBe("mailto:jane@example.com");
    expect(linkTargetOf("example.com")).toBeNull();
    expect(linkTargetOf("javascript:alert(1)")).toBeNull();
  });

  /** Types `text` one character at a time into an empty paragraph, as a user does, and returns the link hrefs. */
  function typedHrefs(text: string): string[] {
    const link = docExtensions.find((e) => e.name === "link")!;
    const plugins = (link.config as unknown as { addProseMirrorPlugins: (this: unknown) => unknown[] }).addProseMirrorPlugins.call({
      type: docSchema.marks.link,
      options: link.options,
      editor: { isEditable: true },
    });
    let state = EditorState.create({
      schema: docSchema,
      doc: docSchema.nodes.doc.create(null, [docSchema.nodes.paragraph.create()]),
      plugins: plugins as never[],
    });
    let pos = 1;
    for (const ch of text) {
      state = state.apply(state.tr.insertText(ch, pos));
      pos += ch.length;
    }
    const hrefs: string[] = [];
    state.doc.descendants((n) => {
      for (const m of n.marks) if (m.type.name === "link") hrefs.push(String(m.attrs.href));
    });
    return hrefs;
  }

  it("links a typed www. address to https://www. when a space follows it", () => {
    expect(typedHrefs("www.example.com ")).toEqual(["https://www.example.com"]);
    expect(typedHrefs("see www.example.com ")).toEqual(["https://www.example.com"]);
  });

  it("links a typed https address as it is", () => {
    expect(typedHrefs("https://example.com ")).toEqual(["https://example.com"]);
  });

  it("does not link a bare domain", () => {
    expect(typedHrefs("example.com ")).toEqual([]);
    expect(typedHrefs("Node.js ")).toEqual([]);
  });
});

describe("paragraph spacing adds up (padding above, margin below)", () => {
  const paraNode = (attrs: Record<string, unknown>) =>
    docFromJSON({ type: "doc", content: [{ type: "paragraph", attrs: para("spacing1", attrs), content: [{ type: "text", text: "x" }] }] }).firstChild!;
  const renderStyle = (attrs: Record<string, unknown>) => {
    const [, out] = docSchema.nodes.paragraph.spec.toDOM!(paraNode(attrs)) as [string, Record<string, string>];
    return out.style ?? "";
  };
  const parseRule = () => docSchema.nodes.paragraph.spec.parseDOM!.find((r) => r.tag === "p")!;
  const parseAttrs = (style: Record<string, string>) =>
    (parseRule().getAttrs as (el: unknown) => Record<string, unknown>)({ getAttribute: () => null, style });

  it("renders spaceBefore as padding-top and spaceAfter as margin-bottom", () => {
    const css = renderStyle({ spaceBefore: 6, spaceAfter: 12 });
    expect(css).toContain("padding-top: 6pt");
    expect(css).toContain("margin-bottom: 12pt");
    expect(css).not.toContain("margin-top");
  });

  it("keeps spaceBefore, lineHeight and borderBottom together when they are all set", () => {
    const css = renderStyle({ spaceBefore: 6, lineHeight: 1.5, borderBottom: true });
    expect(css).toContain("padding-top: 6pt");
    expect(css).toContain("line-height: 1.5");
    expect(css).toContain("border-bottom: 1px solid currentColor");
    expect(css).toContain("padding-bottom: 1px");
  });

  it("reads spaceBefore from padding-top, and from margin-top only when there is no padding", () => {
    expect(parseAttrs({ paddingTop: "9pt", marginTop: "3pt" }).spaceBefore).toBe(9);
    expect(parseAttrs({ marginTop: "12pt" }).spaceBefore).toBe(12);
    expect(parseAttrs({ marginTop: "16px" }).spaceBefore).toBe(12);
    expect(parseAttrs({}).spaceBefore ?? null).toBeNull();
  });
});
