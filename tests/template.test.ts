import { describe, expect, it } from "vitest";
import { TEMPLATE, templateForImport } from "@/lib/template";
import { normalizeResume, RESUME_VERSION, resumeToPlainText, resumeToPromptText } from "@/lib/resume";
import { buildDraftResume, emptyBuilder } from "@/lib/builder";

describe("TEMPLATE", () => {
  it("is the Harvard look: name 16pt bold centered, contact 10pt centered, headings bold with a rule, caps, 6pt above", () => {
    expect(TEMPLATE.name).toEqual({ format: { bold: true, size: 16 }, para: { align: "center" } });
    expect(TEMPLATE.contact).toEqual({ format: { size: 10 }, para: { align: "center" } });
    expect(TEMPLATE.heading).toEqual({ format: { bold: true }, para: { rule: true, caps: true, spaceBefore: 6 } });
    expect(TEMPLATE.entry).toEqual({ para: { spaceBefore: 3 } });
  });
});

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

describe("migrating version 2 (implied Harvard look) to explicit formatting", () => {
  it("writes version 3 and drops every styles/style key", () => {
    const r = normalizeResume(v2({ header: { name: "A", contact: "B", styles: { name: { italic: true } } } }));
    expect(r.version).toBe(RESUME_VERSION);
    expect(JSON.stringify(r)).not.toMatch(/"styles?"/);
  });

  it("makes the name 16pt bold, centered, and the contact line 10pt, centered", () => {
    const r = normalizeResume(v2());
    expect(r.header.marks).toEqual({
      name: [{ from: 0, to: "Ada Lovelace".length, bold: true, size: 16 }],
      contact: [{ from: 0, to: "ada@example.com".length, size: 10 }],
    });
    expect(r.header.para).toEqual({ name: { align: "center" }, contact: { align: "center" } });
  });

  it("makes section headings bold, with the rule, caps and spacing of the template", () => {
    const [exp] = normalizeResume(v2()).sections;
    expect(exp.marks).toEqual([{ from: 0, to: "Experience".length, bold: true }]);
    expect(exp.para).toEqual({ rule: true, caps: true, spaceBefore: 6 });
  });

  it("makes an entry's title bold, its role italic, and its location and dates plain", () => {
    const it = normalizeResume(v2()).sections[0].items[0];
    expect(it.marks).toEqual({
      title: [{ from: 0, to: "Acme".length, bold: true }],
      subtitle: [{ from: 0, to: "Engineer".length, italic: true }],
    });
    expect(it.para).toEqual({ entry: { spaceBefore: 3 } });
  });

  it("makes an inline item's label bold when it has details, and its details plain, with no paragraph spacing", () => {
    const it = normalizeResume(v2()).sections[1].items[0];
    expect(it.marks).toEqual({ title: [{ from: 0, to: "Languages".length, bold: true }] });
    expect(it.subtitle).toBe("Python");
    expect(it.para).toBeUndefined();
  });

  it("gives an inline item with no details no formatting at all", () => {
    const r = normalizeResume(
      v2({ sections: [{ id: "s", title: "T", items: [{ id: "i", title: "Rowing", subtitle: "", location: "", dates: "", bullets: [] }] }] }),
    );
    const it = r.sections[0].items[0];
    expect(it.marks).toBeUndefined();
    expect(it.para).toBeUndefined();
  });

  it("an override that turns bold off leaves no bold mark on that field", () => {
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
    expect(r.sections[0].marks).toBeUndefined();
    expect(r.sections[0].para).toEqual({ rule: true, caps: true, spaceBefore: 6 });
    expect(r.sections[0].items[0].marks).toBeUndefined();
  });

  it("applies header overrides on top of the template (italic name, plain contact)", () => {
    const r = normalizeResume(v2({ header: { name: "Ada", contact: "ada@x.io", styles: { name: { bold: false, italic: true }, contact: { bold: true } } } }));
    expect(r.header.marks).toEqual({
      name: [{ from: 0, to: 3, italic: true, size: 16 }],
      contact: [{ from: 0, to: "ada@x.io".length, bold: true, size: 10 }],
    });
  });

  it("applies an italic override on an entry's title on top of the bold default", () => {
    const r = normalizeResume(
      v2({
        sections: [{ id: "s", title: "T", items: [{ id: "i", title: "Acme", subtitle: "", location: "", dates: "2025", bullets: [], styles: { title: { italic: true } } }] }],
      }),
    );
    expect(r.sections[0].items[0].marks).toEqual({ title: [{ from: 0, to: 4, bold: true, italic: true }] });
  });

  it("keeps bullets as plain text with no formatting", () => {
    const r = normalizeResume(v2());
    expect(r.sections[0].items[0].bullets).toEqual([{ id: "b1", text: "Built a dashboard" }]);
  });

  it("swaps v1 title and subtitle before choosing the look (the organization is the bold line)", () => {
    const r = normalizeResume({
      header: { name: "A", contact: "" },
      sections: [{ title: "Experience", items: [{ title: "Software Intern", subtitle: "Acme", dates: "2025", bullets: [] }] }],
    });
    const it = r.sections[0].items[0];
    expect(it.title).toBe("Acme");
    expect(it.marks).toEqual({
      title: [{ from: 0, to: 4, bold: true }],
      subtitle: [{ from: 0, to: "Software Intern".length, italic: true }],
    });
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
    expect(r.sections[0].items[0].bullets[0].marks).toEqual([
      { from: 0, to: 4, bold: true },
      { from: 4, to: 5, bold: true, italic: true },
    ]);
  });

  it("keeps valid paragraph formatting and drops invalid values", () => {
    const r = normalizeResume({
      version: 3,
      header: { name: "A", contact: "", para: { name: { align: "left", rule: "yes" } } },
      sections: [{ id: "s", title: "T", para: { rule: true, caps: true, spaceBefore: 6, align: "justify" }, items: [] }],
    });
    expect(r.header.para).toBeUndefined();
    expect(r.header).not.toHaveProperty("para");
    expect(r.sections[0].para).toEqual({ rule: true, caps: true, spaceBefore: 6, align: "justify" });
  });

  it("drops styles keys from a version 3 document and omits empty objects", () => {
    const r = normalizeResume({
      version: 3,
      header: { name: "A", contact: "B", styles: { name: { bold: true } }, marks: {}, para: {} },
      sections: [{ id: "s", title: "T", style: { bold: true }, marks: [], items: [{ id: "i", title: "x", styles: { title: { bold: true } }, marks: {}, bullets: [] }] }],
    });
    expect(r.header).toEqual({ name: "A", contact: "B" });
    expect(r.sections[0]).toEqual({ id: "s", title: "T", items: [{ id: "i", title: "x", subtitle: "", location: "", dates: "", bullets: [] }] });
  });

  it("keeps marks that are already clean", () => {
    const marks = [{ from: 0, to: 3, bold: true as const }];
    const r = normalizeResume({
      version: 3,
      header: { name: "Ada", contact: "" },
      sections: [{ id: "s", title: "T", items: [{ id: "i", title: "Ada", subtitle: "", location: "", dates: "", bullets: [], marks: { title: marks } }] }],
    });
    expect(r.sections[0].items[0].marks).toEqual({ title: marks });
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
  it("builder output has the template's name formatting, made explicit", () => {
    const a = emptyBuilder("jo@college.edu");
    a.about.name = "Jo Lee";
    const r = buildDraftResume(a, "nonsense");
    expect(r.version).toBe(RESUME_VERSION);
    expect(r.header.marks?.name).toEqual([{ from: 0, to: "Jo Lee".length, bold: true, size: 16 }]);
    expect(r.header.para?.name).toEqual({ align: "center" });
  });

  it("a version 2 import (what parse-resume passes) gets the template", () => {
    const r = normalizeResume({ ...(v2() as object), version: 2 });
    expect(r.header.para?.name).toEqual({ align: "center" });
    expect(r.sections[0].para).toEqual({ rule: true, caps: true, spaceBefore: 6 });
  });
});

describe("templateForImport", () => {
  it("applies the template to pasted text and text uploads only, never to a PDF", () => {
    expect(templateForImport("text")).toBe(true);
    expect(templateForImport("pdf")).toBe(false);
  });
});
