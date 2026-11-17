import { describe, expect, it } from "vitest";
import type { DocLine } from "@/lib/docLineTypes";
import { linesToResume, nextKind, resumeToLines } from "@/lib/docLines";
import type { Item, Resume } from "@/lib/types";

/** A realistic version 3 resume with formatting everywhere (no legacy subtitle on inline items). */
const v3: Resume = {
  version: 3,
  header: {
    name: "Ada Lovelace",
    contact: "London • ada@example.com",
    marks: { name: [{ from: 0, to: 12, bold: true, size: 16 }] },
    para: { name: { align: "center" }, contact: { align: "center" } },
  },
  sections: [
    {
      id: "edu",
      title: "EDUCATION",
      marks: [{ from: 0, to: 9, bold: true }],
      para: { rule: true, caps: true, spaceBefore: 6 },
      items: [
        {
          id: "e1",
          title: "University of Cambridge",
          subtitle: "BA Mathematics",
          location: "",
          dates: "1835 – 1837",
          bullets: [],
          marks: { title: [{ from: 0, to: 23, bold: true }], subtitle: [{ from: 0, to: 14, italic: true }] },
        },
      ],
    },
    {
      id: "exp",
      title: "EXPERIENCE",
      items: [
        {
          id: "x1",
          title: "Analytical Engine Co.",
          subtitle: "Engineer",
          location: "London",
          dates: "1843 – 1845",
          bullets: [
            { id: "b1", text: "Wrote the first program", marks: [{ from: 10, to: 15, bold: true }] },
            { id: "b2", text: "" },
          ],
          marks: { title: [{ from: 0, to: 21, bold: true }], subtitle: [{ from: 0, to: 8, italic: true }] },
          para: { entry: { spaceBefore: 4 } },
        },
        {
          id: "x2",
          title: "Freelance Translator",
          subtitle: "",
          location: "Remote",
          dates: "",
          bullets: [{ id: "b3", text: "Translated papers" }],
        },
      ],
    },
    {
      id: "skills",
      title: "SKILLS",
      items: [
        {
          id: "k1",
          title: "Languages: Python",
          subtitle: "",
          location: "",
          dates: "",
          bullets: [],
          marks: { title: [{ from: 0, to: 10, bold: true }] },
        },
        { id: "k2", title: "Dean's List", subtitle: "", location: "", dates: "", bullets: [] },
      ],
    },
  ],
};

/** Version 2 data: an inline item with the legacy "title: subtitle" split, bold label and italic value. */
const legacy: Resume = {
  version: 2,
  header: { name: "Ada", contact: "" },
  sections: [
    {
      id: "skills",
      title: "SKILLS",
      items: [
        {
          id: "k1",
          title: "Languages",
          subtitle: "Python",
          location: "",
          dates: "",
          bullets: [],
          marks: { title: [{ from: 0, to: 9, bold: true }], subtitle: [{ from: 0, to: 6, italic: true }] },
        },
      ],
    },
  ],
};

const line = (l: Partial<DocLine> & Pick<DocLine, "kind" | "text">): DocLine => l as DocLine;

/** A minimal header so tests can focus on the lines under test. */
const head = [line({ kind: "name", text: "Ada" }), line({ kind: "contact", text: "" })];

describe("resumeToLines", () => {
  it("emits explicit marks and para on the lines that carry them", () => {
    expect(resumeToLines(v3)).toStrictEqual<DocLine[]>([
      {
        kind: "name",
        text: "Ada Lovelace",
        marks: [{ from: 0, to: 12, bold: true, size: 16 }],
        para: { align: "center" },
      },
      { kind: "contact", text: "London • ada@example.com", para: { align: "center" } },
      {
        kind: "heading",
        text: "EDUCATION",
        sid: "edu",
        marks: [{ from: 0, to: 9, bold: true }],
        para: { rule: true, caps: true, spaceBefore: 6 },
      },
      {
        kind: "entry",
        text: "University of Cambridge",
        right: "",
        sid: "edu",
        iid: "e1",
        marks: [{ from: 0, to: 23, bold: true }],
      },
      {
        kind: "role",
        text: "BA Mathematics",
        right: "1835 – 1837",
        sid: "edu",
        iid: "e1",
        marks: [{ from: 0, to: 14, italic: true }],
      },
      { kind: "heading", text: "EXPERIENCE", sid: "exp" },
      {
        kind: "entry",
        text: "Analytical Engine Co.",
        right: "London",
        sid: "exp",
        iid: "x1",
        marks: [{ from: 0, to: 21, bold: true }],
        para: { spaceBefore: 4 },
      },
      {
        kind: "role",
        text: "Engineer",
        right: "1843 – 1845",
        sid: "exp",
        iid: "x1",
        marks: [{ from: 0, to: 8, italic: true }],
      },
      {
        kind: "bullet",
        text: "Wrote the first program",
        sid: "exp",
        iid: "x1",
        bid: "b1",
        marks: [{ from: 10, to: 15, bold: true }],
      },
      { kind: "bullet", text: "", sid: "exp", iid: "x1", bid: "b2" },
      { kind: "entry", text: "Freelance Translator", right: "Remote", sid: "exp", iid: "x2" },
      { kind: "bullet", text: "Translated papers", sid: "exp", iid: "x2", bid: "b3" },
      { kind: "heading", text: "SKILLS", sid: "skills" },
      { kind: "text", text: "Languages: Python", sid: "skills", iid: "k1", marks: [{ from: 0, to: 10, bold: true }] },
      { kind: "text", text: "Dean's List", sid: "skills", iid: "k2" },
    ]);
  });

  it("emits no marks, para or right keys when nothing is formatted", () => {
    const plain: Resume = {
      header: { name: "Ada", contact: "c" },
      sections: [
        {
          id: "s",
          title: "S",
          items: [{ id: "i", title: "A", subtitle: "", location: "L", dates: "", bullets: [{ id: "b", text: "x" }] }],
        },
      ],
    };
    expect(resumeToLines(plain)).toStrictEqual<DocLine[]>([
      { kind: "name", text: "Ada" },
      { kind: "contact", text: "c" },
      { kind: "heading", text: "S", sid: "s" },
      { kind: "entry", text: "A", right: "L", sid: "s", iid: "i" },
      { kind: "bullet", text: "x", sid: "s", iid: "i", bid: "b" },
    ]);
  });

  it("writes a legacy subtitle as one line, the separator taking the title's last-character format", () => {
    const lines = resumeToLines(legacy);
    expect(lines[2]).toStrictEqual<DocLine>({
      kind: "text",
      text: "Languages: Python",
      sid: "skills",
      iid: "k1",
      marks: [
        { from: 0, to: 11, bold: true },
        { from: 11, to: 17, italic: true },
      ],
    });
  });

  it("gives the separator no format when the title is unformatted at its last character", () => {
    const item: Item = {
      id: "k",
      title: "Languages",
      subtitle: "Python",
      location: "",
      dates: "",
      bullets: [],
      marks: { title: [{ from: 0, to: 5, bold: true }] },
    };
    const r: Resume = { header: { name: "", contact: "" }, sections: [{ id: "s", title: "S", items: [item] }] };
    // No header lines (empty name and contact, with sections): heading, then the text line.
    expect(resumeToLines(r)[1]).toStrictEqual<DocLine>({
      kind: "text",
      text: "Languages: Python",
      sid: "s",
      iid: "k",
      marks: [{ from: 0, to: 5, bold: true }],
    });
  });

  it("always emits the empty heading of a section with no title", () => {
    expect(resumeToLines({ header: { name: "", contact: "" }, sections: [{ id: "s", title: "", items: [] }] })).toStrictEqual([
      { kind: "heading", text: "", sid: "s" },
    ]);
  });

  it("emits no heading for an untitled first section with items, so no blank line appears", () => {
    const r: Resume = {
      header: { name: "Ada", contact: "London" },
      sections: [
        { id: "pre", title: "", items: [{ id: "k", title: "ada@example.com", subtitle: "", location: "", dates: "", bullets: [] }] },
        { id: "edu", title: "EDUCATION", items: [] },
      ],
    };
    expect(resumeToLines(r)).toStrictEqual<DocLine[]>([
      { kind: "name", text: "Ada" },
      { kind: "contact", text: "London" },
      { kind: "text", text: "ada@example.com", sid: "pre", iid: "k" },
      { kind: "heading", text: "EDUCATION", sid: "edu" },
    ]);
  });

  it("keeps the heading of an untitled section that is not first, so its boundary survives", () => {
    const r: Resume = {
      header: { name: "Ada", contact: "" },
      sections: [
        { id: "a", title: "A", items: [] },
        { id: "b", title: "", items: [{ id: "k", title: "X", subtitle: "", location: "", dates: "", bullets: [] }] },
      ],
    };
    // The empty contact is omitted (the resume has content), as for any other resume.
    expect(resumeToLines(r).map((l) => l.kind)).toEqual(["name", "heading", "heading", "text"]);
  });

  it("keeps the heading of an untitled first section with no items", () => {
    expect(resumeToLines({ header: { name: "Ada", contact: "" }, sections: [{ id: "s", title: "", items: [] }] })).toStrictEqual([
      { kind: "name", text: "Ada" },
      { kind: "heading", text: "", sid: "s" },
    ]);
  });

  it("emits both empty header lines only for a completely blank resume", () => {
    expect(resumeToLines({ header: { name: "", contact: "" }, sections: [] })).toStrictEqual([
      { kind: "name", text: "" },
      { kind: "contact", text: "" },
    ]);
  });

  it("omits an empty name or contact line when the resume has content", () => {
    expect(resumeToLines({ header: { name: "", contact: "c" }, sections: [] })).toStrictEqual([
      { kind: "contact", text: "c" },
    ]);
  });
});

describe("linesToResume", () => {
  it("round-trips a version 3 resume exactly", () => {
    const { resume: back } = linesToResume(resumeToLines(v3), v3);
    expect(back).toStrictEqual(v3);
  });

  it("returns one id entry per line, matching the original ids on a round trip", () => {
    const lines = resumeToLines(v3);
    const { ids } = linesToResume(lines, v3);
    expect(ids).toHaveLength(lines.length);
    expect(ids[0]).toEqual({});
    expect(ids[1]).toEqual({});
    expect(ids[2]).toEqual({ sid: "edu" });
    expect(ids[3]).toEqual({ sid: "edu", iid: "e1" });
    expect(ids[8]).toEqual({ sid: "exp", iid: "x1", bid: "b1" });
    expect(ids[9]).toEqual({ sid: "exp", iid: "x1", bid: "b2" });
    expect(ids[13]).toEqual({ sid: "skills", iid: "k1" });
  });

  it("gives a fresh id to a duplicate bullet id and keeps it on the first", () => {
    const lines = [
      ...head,
      line({ kind: "heading", text: "S", sid: "s" }),
      line({ kind: "entry", text: "A", right: "", sid: "s", iid: "i" }),
      line({ kind: "bullet", text: "x", sid: "s", iid: "i", bid: "b" }),
      line({ kind: "bullet", text: "y", sid: "s", iid: "i", bid: "b" }),
    ];
    const { resume: r, ids } = linesToResume(lines, v3);
    expect(ids[2].bid).toBeUndefined();
    expect(ids[4].bid).toBe("b");
    expect(ids[5].bid).toBeTruthy();
    expect(ids[5].bid).not.toBe("b");
    expect(r.sections[0].items[0].bullets.map((b) => b.id)).toEqual(["b", ids[5].bid]);
  });

  it("gives a fresh id to a duplicate item id on a second entry", () => {
    const lines = [
      ...head,
      line({ kind: "heading", text: "S", sid: "s" }),
      line({ kind: "entry", text: "A", right: "X", sid: "s", iid: "i" }),
      line({ kind: "entry", text: "B", right: "Y", sid: "s", iid: "i" }),
    ];
    const { resume: r, ids } = linesToResume(lines, v3);
    expect(ids[3].iid).toBe("i");
    expect(ids[4].iid).toBeTruthy();
    expect(ids[4].iid).not.toBe("i");
    expect(r.sections[0].items.map((it) => it.id)).toEqual(["i", ids[4].iid]);
  });

  it("makes a bullet right after a heading an untitled item", () => {
    const lines = [
      ...head,
      line({ kind: "heading", text: "S", sid: "s" }),
      line({ kind: "bullet", text: "Did it", sid: "s", iid: "i", bid: "b" }),
    ];
    const { resume: r } = linesToResume(lines, v3);
    expect(r.sections[0].items).toStrictEqual([
      { id: "i", title: "", subtitle: "", location: "", dates: "", bullets: [{ id: "b", text: "Did it" }] },
    ]);
  });

  it("makes a bullet after a text line a new item and keeps the text item inline", () => {
    const lines = [
      ...head,
      line({ kind: "heading", text: "S", sid: "s" }),
      line({ kind: "text", text: "Languages: Python", sid: "s", iid: "k" }),
      line({ kind: "bullet", text: "Oops", sid: "s", iid: "k", bid: "b" }),
    ];
    const { resume: r, ids } = linesToResume(lines, v3);
    const items = r.sections[0].items;
    expect(items).toHaveLength(2);
    expect(items[0]).toStrictEqual({ id: "k", title: "Languages: Python", subtitle: "", location: "", dates: "", bullets: [] });
    expect(items[1].title).toBe("");
    expect(items[1].bullets).toEqual([{ id: "b", text: "Oops" }]);
    expect(ids[4].iid).toBe(items[1].id);
  });

  it("makes a role line with no preceding entry an item with an empty title", () => {
    const lines = [
      ...head,
      line({ kind: "heading", text: "S", sid: "s" }),
      line({ kind: "role", text: "Engineer", right: "2020", sid: "s", iid: "i" }),
    ];
    const { resume: r } = linesToResume(lines, v3);
    expect(r.sections[0].items).toStrictEqual([
      { id: "i", title: "", subtitle: "Engineer", location: "", dates: "2020", bullets: [] },
    ]);
  });

  it("puts lines before any heading into an implicit section with an empty title", () => {
    const lines = [...head, line({ kind: "text", text: "Languages: Python", sid: "s", iid: "k" })];
    const { resume: r, ids } = linesToResume(lines, v3);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].title).toBe("");
    expect(r.sections[0].items).toStrictEqual([
      { id: "k", title: "Languages: Python", subtitle: "", location: "", dates: "", bullets: [] },
    ]);
    expect(ids[2]).toEqual({ sid: r.sections[0].id, iid: "k" });
  });

  it("treats a second name line as a text line", () => {
    const lines = [
      line({ kind: "name", text: "Ada" }),
      line({ kind: "contact", text: "" }),
      line({ kind: "heading", text: "S", sid: "s" }),
      line({ kind: "name", text: "Foo: bar", sid: "s", iid: "n" }),
    ];
    const { resume: r, ids } = linesToResume(lines, v3);
    expect(r.header.name).toBe("Ada");
    expect(r.sections[0].items).toStrictEqual([
      { id: "n", title: "Foo: bar", subtitle: "", location: "", dates: "", bullets: [] },
    ]);
    expect(ids[3]).toEqual({ sid: "s", iid: "n" });
  });

  it("takes the header from the first name and contact lines even after a heading", () => {
    const lines = [
      line({ kind: "heading", text: "S", sid: "s" }),
      line({ kind: "name", text: "Ada" }),
      line({ kind: "contact", text: "ada@example.com" }),
      line({ kind: "name", text: "Second" }),
    ];
    const { resume: r, ids } = linesToResume(lines, v3);
    expect(r.header.name).toBe("Ada");
    expect(r.header.contact).toBe("ada@example.com");
    expect(r.sections[0].items).toHaveLength(1);
    expect(r.sections[0].items[0].title).toBe("Second");
    expect(ids[0]).toEqual({ sid: "s" });
    expect(ids[1]).toEqual({});
    expect(ids[2]).toEqual({});
    expect(ids[3]).toEqual({ sid: "s", iid: r.sections[0].items[0].id });
  });

  it("drops marks that are out of range or empty", () => {
    const lines = [
      ...head,
      line({ kind: "heading", text: "S", sid: "s" }),
      line({
        kind: "bullet",
        text: "Hi",
        sid: "s",
        iid: "i",
        bid: "b",
        marks: [
          { from: -5, to: 1, bold: true },
          { from: 1, to: 9, italic: true },
          { from: 1, to: 1, bold: true },
        ],
      }),
    ];
    const { resume: r } = linesToResume(lines, v3);
    expect(r.sections[0].items[0].bullets[0].marks).toStrictEqual([
      { from: 0, to: 1, bold: true },
      { from: 1, to: 2, italic: true },
    ]);
  });

  it("cleans entry marks against the length of each field", () => {
    const lines = [
      ...head,
      line({ kind: "heading", text: "S", sid: "s" }),
      line({
        kind: "entry",
        text: "Acme",
        right: "NYC",
        sid: "s",
        iid: "i",
        marks: [{ from: 0, to: 100, bold: true }],
        rightMarks: [{ from: 1, to: 3, italic: true }],
      }),
    ];
    const { resume: r } = linesToResume(lines, v3);
    expect(r.sections[0].items[0].marks).toStrictEqual({
      title: [{ from: 0, to: 4, bold: true }],
      location: [{ from: 1, to: 3, italic: true }],
    });
  });

  it("maps para on every kind to the matching field", () => {
    const lines = [
      line({ kind: "name", text: "Ada", para: { align: "center" } }),
      line({ kind: "contact", text: "c", para: { align: "center" } }),
      line({ kind: "heading", text: "S", sid: "s", para: { rule: true } }),
      line({ kind: "entry", text: "A", right: "X", sid: "s", iid: "i", para: { spaceBefore: 4 } }),
      line({ kind: "role", text: "R", right: "2020", sid: "s", iid: "i", para: { align: "right" } }),
      line({ kind: "bullet", text: "b", sid: "s", iid: "i", bid: "b", para: { caps: true } }),
      line({ kind: "text", text: "T", sid: "s", iid: "t", para: { align: "justify" } }),
    ];
    const { resume: r } = linesToResume(lines, v3);
    expect(r.header.para).toStrictEqual({ name: { align: "center" }, contact: { align: "center" } });
    expect(r.sections[0].para).toStrictEqual({ rule: true });
    expect(r.sections[0].items[0].para).toStrictEqual({ entry: { spaceBefore: 4 }, role: { align: "right" } });
    expect(r.sections[0].items[0].bullets[0].para).toStrictEqual({ caps: true });
    expect(r.sections[0].items[1]).toStrictEqual({
      id: "t",
      title: "T",
      subtitle: "",
      location: "",
      dates: "",
      bullets: [],
      para: { entry: { align: "justify" } },
    });
  });

  it("maps a legacy-style text line to one title with its whole marks", () => {
    const { resume: r } = linesToResume(resumeToLines(legacy), legacy);
    expect(r.sections[0].items[0]).toStrictEqual({
      id: "k1",
      title: "Languages: Python",
      subtitle: "",
      location: "",
      dates: "",
      bullets: [],
      marks: {
        title: [
          { from: 0, to: 11, bold: true },
          { from: 11, to: 17, italic: true },
        ],
      },
    });
  });

  it("keeps marks on a text line as the title's marks", () => {
    const lines = [
      ...head,
      line({ kind: "heading", text: "S", sid: "s" }),
      line({ kind: "text", text: "Languages: Python", sid: "s", iid: "k", marks: [{ from: 0, to: 10, bold: true }] }),
    ];
    const { resume: r } = linesToResume(lines, v3);
    expect(r.sections[0].items[0]).toStrictEqual({
      id: "k",
      title: "Languages: Python",
      subtitle: "",
      location: "",
      dates: "",
      bullets: [],
      marks: { title: [{ from: 0, to: 10, bold: true }] },
    });
  });

  it("removes legacy styles keys from prev", () => {
    const prev = {
      ...v3,
      styles: { title: { bold: true } },
      style: { italic: true },
      header: { ...v3.header, styles: { name: { bold: true } } },
    } as unknown as Resume;
    const { resume: r } = linesToResume(resumeToLines(v3), prev);
    expect(r).not.toHaveProperty("styles");
    expect(r).not.toHaveProperty("style");
    expect(r.header).not.toHaveProperty("styles");
  });

  it("keeps the other keys of prev", () => {
    const prev: Resume = { ...v3, baseline: { b1: "old" }, facts: ["f"] };
    const { resume: r } = linesToResume(resumeToLines(v3), prev);
    expect(r.baseline).toEqual({ b1: "old" });
    expect(r.facts).toEqual(["f"]);
    expect(r.version).toBe(3);
  });
});

describe("round trip of an untitled section before the first heading", () => {
  const untitled: Resume = {
    header: { name: "Ada", contact: "London" },
    sections: [
      {
        id: "pre",
        title: "",
        items: [
          { id: "k", title: "ada@example.com", subtitle: "", location: "", dates: "", bullets: [] },
        ],
      },
      { id: "edu", title: "EDUCATION", items: [] },
    ],
  };

  it("linesToResume(resumeToLines(r)) gives back r", () => {
    const { resume: back } = linesToResume(resumeToLines(untitled), untitled);
    expect(back).toStrictEqual(untitled);
  });

  it("resumeToLines(linesToResume(lines)) gives back the same lines", () => {
    const lines = resumeToLines(untitled);
    const { resume } = linesToResume(lines, untitled);
    expect(resumeToLines(resume)).toStrictEqual(lines);
  });

  it("a text line typed before the first heading is an untitled section with no blank heading after a rebuild", () => {
    const lines = [...head, line({ kind: "text", text: "ada@example.com", sid: "pre", iid: "k" }), line({ kind: "heading", text: "S", sid: "s" })];
    const { resume } = linesToResume(lines, untitled);
    expect(resume.sections[0].title).toBe("");
    expect(resumeToLines(resume).filter((l) => l.kind === "heading").map((l) => l.text)).toEqual(["S"]);
  });
});

describe("nextKind", () => {
  it("follows the Enter table", () => {
    expect(nextKind("name")).toBe("contact");
    expect(nextKind("contact")).toBe("text");
    expect(nextKind("heading")).toBe("entry");
    expect(nextKind("entry")).toBe("role");
    expect(nextKind("role")).toBe("bullet");
    expect(nextKind("bullet")).toBe("bullet");
    expect(nextKind("text")).toBe("text");
  });
});
