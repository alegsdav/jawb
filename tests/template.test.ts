import { describe, expect, it } from "vitest";
import { HARVARD_PAGE, harvardBullet, harvardContact, harvardEntry, harvardHeading, harvardLabelLine, harvardName, harvardRole, TEMPLATE } from "@/lib/template";
import { normalizeResume, RESUME_VERSION, resumeDoc, resumeToPlainText, resumeToPromptText } from "@/lib/resume";
import { buildDraftResume, emptyBuilder } from "@/lib/builder";
import { buildDoc, flattenDoc } from "@/lib/doc/model";
import type { DocMark, DocParagraph, DocText } from "@/lib/doc/types";
import type { Resume } from "@/lib/types";

describe("TEMPLATE (legacy, for version 2-3 data)", () => {
  it("is the Harvard look: name 16pt bold centered, contact 10pt centered, headings bold with a rule, caps, 6pt above", () => {
    expect(TEMPLATE.name).toEqual({ format: { bold: true, size: 16 }, para: { align: "center" } });
    expect(TEMPLATE.contact).toEqual({ format: { size: 10 }, para: { align: "center" } });
    expect(TEMPLATE.heading).toEqual({ format: { bold: true }, para: { rule: true, caps: true, spaceBefore: 6 } });
    expect(TEMPLATE.entry).toEqual({ para: { spaceBefore: 3 } });
  });
});

// ---- helpers over documents ----

/** The paragraph whose text is `text`. */
const find = (r: Resume, text: string): DocParagraph => {
  const p = flattenDoc(resumeDoc(r)).find((x) => x.text === text);
  if (!p) throw new Error(`no paragraph "${text}"`);
  return p.node;
};
const runs = (node: DocParagraph): DocText[] => (node.content ?? []).filter((n): n is DocText => n.type === "text");
const hasMark = (run: DocText, type: DocMark["type"]) => (run.marks ?? []).some((m) => m.type === type);
/** The text of the bold runs. */
const boldText = (node: DocParagraph) => runs(node).filter((n) => hasMark(n, "bold")).map((n) => n.text).join("");
const fontSize = (node: DocParagraph) => {
  const mark = runs(node)[0]?.marks?.find((m) => m.type === "textStyle");
  return mark?.type === "textStyle" ? mark.attrs.fontSize : undefined;
};

// ---- the Harvard paragraph builders ----

describe("Harvard paragraphs", () => {
  it("the name is 16pt bold and centered; the contact line 10.5pt and centered; all in Times New Roman", () => {
    const name = harvardName("Ada Lovelace").node;
    expect(name.attrs).toMatchObject({ textAlign: "center" });
    expect(name.content).toEqual([
      { type: "text", text: "Ada Lovelace", marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontFamily: "Times New Roman", fontSize: "16pt" } }] },
    ]);
    expect(fontSize(harvardContact("ada@example.com").node)).toBe("10.5pt");
    expect(harvardContact("ada@example.com").node.attrs).toMatchObject({ textAlign: "center" });
  });

  it("a heading is bold capitals with a rule under it and 10pt above", () => {
    const h = harvardHeading("Experience").node;
    expect(h.attrs).toMatchObject({ borderBottom: true, spaceBefore: 10 });
    expect(runs(h)[0].text).toBe("EXPERIENCE");
    expect(boldText(h)).toBe("EXPERIENCE");
    expect(fontSize(h)).toBe("11pt");
  });

  it("an entry is the organization in bold, a tab, then the location; a role is italic, a tab, then the dates", () => {
    const e = harvardEntry("Acme", "Boston, MA", { id: "x1" }).node;
    expect(e.attrs?.id).toBe("x1");
    expect(e.content?.map((n) => n.type)).toEqual(["text", "tab", "text"]);
    expect(boldText(e)).toBe("Acme");
    const role = harvardRole("Engineer", "2025").node;
    expect(runs(role)[0]).toMatchObject({ text: "Engineer", marks: expect.arrayContaining([{ type: "italic" }]) });
    expect(boldText(role)).toBe("");
  });

  it("an entry can be spaced from the entry above it", () => {
    expect(harvardEntry("Acme", "", { spaceBefore: 4 }).node.attrs?.spaceBefore).toBe(4);
    expect(harvardEntry("Acme", "").node.attrs?.spaceBefore).toBeUndefined();
  });

  it("a bullet is a depth 1 bullet list item; a label line has a bold label", () => {
    expect(harvardBullet("Did a thing")).toMatchObject({ listType: "bulletList", depth: 1, bullet: true });
    const label = harvardLabelLine("Languages", "Python", { spaceBefore: 4 });
    expect(runs(label.node).map((n) => [n.text, hasMark(n, "bold")])).toEqual([["Languages: ", true], ["Python", false]]);
    expect(label.node.attrs?.spaceBefore).toBe(4);
  });

  it("the page is 0.5 inch top and bottom, 0.75 inch on the sides", () => {
    expect(HARVARD_PAGE).toEqual({ marginTop: 0.5, marginBottom: 0.5, marginLeft: 0.75, marginRight: 0.75 });
  });

  it("the builders make a document the outline reads back (name, heading, entry with role and bullet)", () => {
    const doc = buildDoc([
      harvardName("Ada"),
      harvardContact("ada@example.com"),
      harvardHeading("Experience"),
      harvardEntry("Acme", "Boston", { id: "x1" }),
      harvardRole("Engineer", "2025"),
      harvardBullet("Built a dashboard"),
    ]);
    const r = normalizeResume({ version: 4, doc, header: { name: "", contact: "" }, sections: [] });
    expect(r.header).toEqual({ name: "Ada", contact: "ada@example.com" });
    expect(r.sections[0]).toMatchObject({ title: "EXPERIENCE", items: [{ id: "x1", title: "Acme", location: "Boston", subtitle: "Engineer", dates: "2025" }] });
    expect(r.sections[0].items[0].bullets.map((b) => b.text)).toEqual(["Built a dashboard"]);
  });
});

// ---- migrating version 2 (implied Harvard look) to a document ----

/** A version 2 resume as the Harvard layout stored it: the look is implied by field. */
const v2 = (over: Record<string, unknown> = {}) =>
  ({
    version: 2,
    header: { name: "Ada Lovelace", contact: "ada@example.com" },
    sections: [
      {
        id: "s1",
        title: "Experience",
        items: [
          {
            id: "i1",
            title: "Acme",
            subtitle: "Engineer",
            location: "Boston",
            dates: "2025",
            bullets: [{ id: "b1", text: "Built a dashboard" }],
          },
        ],
      },
      {
        id: "s2",
        title: "Skills",
        items: [{ id: "i2", title: "Languages", subtitle: "Python", location: "", dates: "", bullets: [] }],
      },
    ],
    ...over,
  }) as unknown;

describe("migrating version 2 (implied Harvard look) to a document", () => {
  it("writes version 4 and no styles keys", () => {
    const r = normalizeResume(v2({ header: { name: "A", contact: "B", styles: { name: { italic: true } } } }));
    expect(r.version).toBe(RESUME_VERSION);
    expect(JSON.stringify(r)).not.toMatch(/"styles?"/);
  });

  it("makes the name 16pt bold, centered, and the contact line 10pt, centered", () => {
    const r = normalizeResume(v2());
    expect(find(r, "Ada Lovelace")).toMatchObject({ attrs: { textAlign: "center" } });
    expect(boldText(find(r, "Ada Lovelace"))).toBe("Ada Lovelace");
    expect(fontSize(find(r, "Ada Lovelace"))).toBe("16pt");
    expect(find(r, "ada@example.com")).toMatchObject({ attrs: { textAlign: "center" } });
    expect(fontSize(find(r, "ada@example.com"))).toBe("10pt");
    expect(boldText(find(r, "ada@example.com"))).toBe("");
  });

  it("makes section headings bold, with the rule, caps and spacing of the template", () => {
    const h = find(normalizeResume(v2()), "EXPERIENCE");
    expect(h.attrs).toMatchObject({ borderBottom: true, spaceBefore: 6 });
    expect(boldText(h)).toBe("EXPERIENCE");
  });

  it("makes an entry's organization bold, its role italic, and its location and dates plain", () => {
    const r = normalizeResume(v2());
    expect(boldText(find(r, "Acme\tBoston"))).toBe("Acme");
    const role = runs(find(r, "Engineer\t2025"));
    expect(role[0]).toMatchObject({ text: "Engineer" });
    expect(hasMark(role[0], "italic")).toBe(true);
    expect(hasMark(role[0], "bold")).toBe(false);
  });

  it("makes an inline item's label bold, its details plain, with no paragraph spacing", () => {
    const p = find(normalizeResume(v2()), "Languages: Python");
    expect(boldText(p)).toMatch(/^Languages/);
    expect(boldText(p)).not.toContain("Python");
    expect(p.attrs?.spaceBefore).toBeUndefined();
  });

  it("gives an inline item with no details no formatting at all", () => {
    const r = normalizeResume(
      v2({ sections: [{ id: "s", title: "T", items: [{ id: "i", title: "Rowing", subtitle: "", location: "", dates: "", bullets: [] }] }] }),
    );
    const p = find(r, "Rowing");
    expect(runs(p).some((n) => (n.marks ?? []).some((m) => m.type === "bold" || m.type === "italic"))).toBe(false);
    expect(p.attrs?.spaceBefore).toBeUndefined();
  });

  it("an override that turns bold off leaves no bold on that heading", () => {
    const r = normalizeResume(
      v2({
        sections: [
          {
            id: "s1",
            title: "Experience",
            style: { bold: false },
            items: [{ id: "i1", title: "Acme", subtitle: "Engineer", location: "", dates: "", bullets: [], styles: { title: { bold: false } } }],
          },
        ],
      }),
    );
    const h = find(r, "EXPERIENCE");
    expect(boldText(h)).toBe("");
    expect(h.attrs).toMatchObject({ borderBottom: true, spaceBefore: 6 });
    expect(boldText(find(r, "Acme: Engineer"))).toBe("");
  });

  it("applies header overrides on top of the template (italic name, bold contact)", () => {
    const r = normalizeResume(v2({ header: { name: "Ada", contact: "ada@x.io", styles: { name: { bold: false, italic: true }, contact: { bold: true } } } }));
    const name = runs(find(r, "Ada"))[0];
    expect(hasMark(name, "italic")).toBe(true);
    expect(hasMark(name, "bold")).toBe(false);
    expect(boldText(find(r, "ada@x.io"))).toBe("ada@x.io");
  });

  it("applies an italic override on an entry's title on top of the bold default", () => {
    const r = normalizeResume(
      v2({
        sections: [{ id: "s", title: "T", items: [{ id: "i", title: "Acme", subtitle: "", location: "", dates: "2025", bullets: [], styles: { title: { italic: true } } }] }],
      }),
    );
    const acme = runs(find(r, "Acme"))[0];
    expect(hasMark(acme, "bold")).toBe(true);
    expect(hasMark(acme, "italic")).toBe(true);
  });

  it("keeps bullets as list items with plain text", () => {
    const r = normalizeResume(v2());
    const p = flattenDoc(resumeDoc(r)).find((x) => x.text === "Built a dashboard");
    expect(p?.listType).toBe("bulletList");
    expect(boldText(p!.node)).toBe("");
  });

  it("swaps v1 title and subtitle before choosing the look (the organization is the bold line)", () => {
    const r = normalizeResume({
      header: { name: "A", contact: "" },
      sections: [{ title: "Experience", items: [{ title: "Software Intern", subtitle: "Acme", dates: "2025", bullets: [] }] }],
    });
    expect(boldText(find(r, "Acme"))).toBe("Acme");
    expect(runs(find(r, "Software Intern\t2025"))[0]).toMatchObject({ text: "Software Intern" });
    expect(hasMark(runs(find(r, "Software Intern\t2025"))[0], "italic")).toBe(true);
  });
});

describe("version 3 data", () => {
  it("clamps marks to the text, drops garbage, and merges adjacent equal ranges", () => {
    const r = normalizeResume({
      version: 3,
      header: { name: "A", contact: "" },
      sections: [
        {
          id: "s",
          title: "T",
          items: [
            {
              id: "i",
              title: "",
              subtitle: "",
              location: "",
              dates: "",
              bullets: [
                {
                  id: "b",
                  text: "Hello",
                  marks: [
                    { from: -2, to: 3, bold: true },
                    { from: 3, to: 5, bold: true },
                    { from: 4, to: 99, italic: true },
                    { from: "x", to: 2, bold: true },
                    { from: 0, to: 2 },
                    "bold",
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    // [0,3) bold, [3,5) bold, [4,5) italic: the bold ranges merge, the overlap at 4 is bold italic.
    const hello = runs(find(r, "Hello")).map((n) => [n.text, hasMark(n, "bold"), hasMark(n, "italic")]);
    expect(hello).toEqual([
      ["Hell", true, false],
      ["o", true, true],
    ]);
  });

  it("keeps valid paragraph formatting and drops invalid values", () => {
    const r = normalizeResume({
      version: 3,
      header: { name: "A", contact: "", para: { name: { align: "left", rule: "yes" } } },
      sections: [{ id: "s", title: "T", para: { rule: true, caps: true, spaceBefore: 6, align: "justify" }, items: [] }],
    });
    expect(find(r, "A").attrs).not.toHaveProperty("borderBottom");
    expect(find(r, "A").attrs?.textAlign).toBeUndefined();
    expect(find(r, "T").attrs).toMatchObject({ borderBottom: true, spaceBefore: 6, textAlign: "justify" });
  });

  it("drops styles keys from a version 3 document and keeps the text in order", () => {
    const r = normalizeResume({
      version: 3,
      header: { name: "A", contact: "B", styles: { name: { bold: true } }, marks: {}, para: {} },
      sections: [{ id: "s", title: "T", style: { bold: true }, marks: [], items: [{ id: "i", title: "x", styles: { title: { bold: true } }, marks: {}, bullets: [] }] }],
    });
    expect(JSON.stringify(r)).not.toMatch(/"styles?"/);
    expect(flattenDoc(resumeDoc(r)).map((p) => p.text)).toEqual(["A", "B", "T", "x"]);
  });

  it("keeps marks that are already clean", () => {
    const r = normalizeResume({
      version: 3,
      header: { name: "Ann", contact: "" },
      sections: [{ id: "s", title: "T", items: [{ id: "i", title: "Ada", subtitle: "", location: "", dates: "", bullets: [], marks: { title: [{ from: 0, to: 3, bold: true }] } }] }],
    });
    expect(boldText(find(r, "Ada"))).toBe("Ada");
  });
});

describe("the formatting never reaches the AI or the plain-text copy", () => {
  it("prints inline items as 'label: details' with no formatting", () => {
    const r = normalizeResume(v2());
    const text = resumeToPromptText(r);
    expect(text).toContain("- Languages: Python");
    expect(text).toContain("- Acme | Engineer | Boston | 2025");
    expect(text).not.toMatch(/\*|bold|italic/i);
    expect(resumeToPlainText(r)).toContain("• Built a dashboard");
  });
});

describe("the builder and the AI import get the template", () => {
  it("builder output has the template's name and heading formatting", () => {
    const a = emptyBuilder("jo@college.edu");
    a.about.name = "Jo Lee";
    a.about.school = "State U";
    const r = buildDraftResume(a, "nonsense");
    expect(r.version).toBe(RESUME_VERSION);
    expect(find(r, "Jo Lee").attrs).toMatchObject({ textAlign: "center" });
    expect(fontSize(find(r, "Jo Lee"))).toBe("16pt");
    expect(find(r, "EDUCATION").attrs).toMatchObject({ borderBottom: true, spaceBefore: 10 });
  });

  it("a version 2 import gets the template", () => {
    const r = normalizeResume({ ...(v2() as object), version: 2 });
    expect(find(r, "Ada Lovelace").attrs).toMatchObject({ textAlign: "center" });
    expect(find(r, "EXPERIENCE").attrs).toMatchObject({ borderBottom: true, spaceBefore: 6 });
  });
});
