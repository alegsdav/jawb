import { describe, expect, it } from "vitest";
import type { DocLine } from "@/lib/docLineTypes";
import {
  joinInlineText,
  lineEffectiveStyle,
  linesToResume,
  nextKind,
  partField,
  resetLineStyle,
  resumeToLines,
  splitInlineText,
  toggleLineStyle,
} from "@/lib/docLines";
import type { Resume } from "@/lib/types";

const resume: Resume = {
  version: 2,
  header: {
    name: "Ada Lovelace",
    contact: "London • ada@example.com",
    styles: { name: { bold: true, italic: true }, contact: { bold: true } },
  },
  sections: [
    {
      id: "edu",
      title: "EDUCATION",
      items: [{ id: "e1", title: "University of Cambridge", subtitle: "BA Mathematics", location: "", dates: "1835 – 1837", bullets: [] }],
    },
    {
      id: "exp",
      title: "EXPERIENCE",
      style: { italic: true },
      items: [
        {
          id: "x1",
          title: "Analytical Engine Co.",
          subtitle: "Engineer",
          location: "London",
          dates: "1843 – 1845",
          bullets: [{ id: "b1", text: "Wrote the first program" }, { id: "b2", text: "" }],
          styles: { title: { bold: false }, dates: { italic: true } },
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
        { id: "k1", title: "Languages", subtitle: "Python", location: "", dates: "", bullets: [], styles: { subtitle: { italic: true } } },
        { id: "k2", title: "Dean's List", subtitle: "", location: "", dates: "", bullets: [] },
      ],
    },
  ],
};

const line = (l: Partial<DocLine> & Pick<DocLine, "kind" | "text">): DocLine => l as DocLine;

/** A minimal header so tests can focus on the lines under test. */
const head = [line({ kind: "name", text: "Ada" }), line({ kind: "contact", text: "" })];

describe("resumeToLines", () => {
  it("emits the header, sections, entries, roles, bullets and inline lines in order", () => {
    expect(resumeToLines(resume)).toStrictEqual<DocLine[]>([
      { kind: "name", text: "Ada Lovelace", style: { bold: true, italic: true } },
      { kind: "contact", text: "London • ada@example.com", style: { bold: true } },
      { kind: "heading", text: "EDUCATION", sid: "edu" },
      { kind: "entry", text: "University of Cambridge", right: "", sid: "edu", iid: "e1" },
      { kind: "role", text: "BA Mathematics", right: "1835 – 1837", sid: "edu", iid: "e1" },
      { kind: "heading", text: "EXPERIENCE", sid: "exp", style: { italic: true } },
      { kind: "entry", text: "Analytical Engine Co.", right: "London", sid: "exp", iid: "x1", style: { bold: false } },
      { kind: "role", text: "Engineer", right: "1843 – 1845", sid: "exp", iid: "x1", style2: { italic: true } },
      { kind: "bullet", text: "Wrote the first program", sid: "exp", iid: "x1", bid: "b1" },
      { kind: "bullet", text: "", sid: "exp", iid: "x1", bid: "b2" },
      { kind: "entry", text: "Freelance Translator", right: "Remote", sid: "exp", iid: "x2" },
      { kind: "bullet", text: "Translated papers", sid: "exp", iid: "x2", bid: "b3" },
      { kind: "heading", text: "SKILLS", sid: "skills" },
      { kind: "text", text: "Languages: Python", sid: "skills", iid: "k1", style2: { italic: true } },
      { kind: "text", text: "Dean's List", sid: "skills", iid: "k2" },
    ]);
  });

  it("always emits the header lines and an empty heading", () => {
    expect(resumeToLines({ header: { name: "", contact: "" }, sections: [{ id: "s", title: "", items: [] }] })).toStrictEqual([
      { kind: "name", text: "" },
      { kind: "contact", text: "" },
      { kind: "heading", text: "", sid: "s" },
    ]);
  });
});

describe("linesToResume", () => {
  it("round-trips a resume", () => {
    const { resume: back } = linesToResume(resumeToLines(resume), resume);
    expect(back).toEqual(resume);
  });

  it("returns one id entry per line, matching the original ids on a round trip", () => {
    const lines = resumeToLines(resume);
    const { ids } = linesToResume(lines, resume);
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
    const { resume: r, ids } = linesToResume(lines, resume);
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
    const { resume: r, ids } = linesToResume(lines, resume);
    expect(ids[3].iid).toBe("i");
    expect(ids[4].iid).toBeTruthy();
    expect(ids[4].iid).not.toBe("i");
    expect(r.sections[0].items.map((it) => it.id)).toEqual(["i", ids[4].iid]);
  });

  it("makes a bullet right after a heading an untitled item", () => {
    const lines = [...head, line({ kind: "heading", text: "S", sid: "s" }), line({ kind: "bullet", text: "Did it", sid: "s", iid: "i", bid: "b" })];
    const { resume: r } = linesToResume(lines, resume);
    expect(r.sections[0].items).toEqual([
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
    const { resume: r, ids } = linesToResume(lines, resume);
    const items = r.sections[0].items;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: "k", title: "Languages", subtitle: "Python", location: "", dates: "", bullets: [] });
    expect(items[1].title).toBe("");
    expect(items[1].bullets).toEqual([{ id: "b", text: "Oops" }]);
    expect(ids[4].iid).toBe(items[1].id);
  });

  it("makes a role line with no preceding entry an item with an empty title", () => {
    const lines = [...head, line({ kind: "heading", text: "S", sid: "s" }), line({ kind: "role", text: "Engineer", right: "2020", sid: "s", iid: "i" })];
    const { resume: r } = linesToResume(lines, resume);
    expect(r.sections[0].items).toEqual([
      { id: "i", title: "", subtitle: "Engineer", location: "", dates: "2020", bullets: [] },
    ]);
  });

  it("puts lines before any heading into an implicit section with an empty title", () => {
    const lines = [...head, line({ kind: "text", text: "Languages: Python", sid: "s", iid: "k" })];
    const { resume: r, ids } = linesToResume(lines, resume);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0].title).toBe("");
    expect(r.sections[0].items).toEqual([{ id: "k", title: "Languages", subtitle: "Python", location: "", dates: "", bullets: [] }]);
    expect(ids[2]).toEqual({ sid: r.sections[0].id, iid: "k" });
  });

  it("treats a second name line as a text line", () => {
    const lines = [
      line({ kind: "name", text: "Ada" }),
      line({ kind: "contact", text: "" }),
      line({ kind: "heading", text: "S", sid: "s" }),
      line({ kind: "name", text: "Foo: bar", sid: "s", iid: "n" }),
    ];
    const { resume: r, ids } = linesToResume(lines, resume);
    expect(r.header.name).toBe("Ada");
    expect(r.sections[0].items).toEqual([{ id: "n", title: "Foo", subtitle: "bar", location: "", dates: "", bullets: [] }]);
    expect(ids[3]).toEqual({ sid: "s", iid: "n" });
  });

  it("fixes up an entry title that became inline so it keeps its bold", () => {
    const lines = [...head, line({ kind: "heading", text: "S", sid: "s" }), line({ kind: "entry", text: "Google", right: "", sid: "s", iid: "g" }), line({ kind: "heading", text: "T", sid: "t" })];
    const { resume: r } = linesToResume(lines, resume);
    expect(r.sections[0].items).toEqual([
      { id: "g", title: "Google", subtitle: "", location: "", dates: "", bullets: [], styles: { title: { bold: true, italic: false } } },
    ]);
  });

  it("keeps the other keys of prev", () => {
    const prev: Resume = { ...resume, baseline: { b1: "old" }, facts: ["f"] };
    const { resume: r } = linesToResume(resumeToLines(resume), prev);
    expect(r.baseline).toEqual({ b1: "old" });
    expect(r.facts).toEqual(["f"]);
    expect(r.version).toBe(2);
  });
});

describe("splitInlineText / joinInlineText", () => {
  it("splits at the first colon-space and does not trim", () => {
    expect(splitInlineText("Languages: Python, SQL")).toEqual({ title: "Languages", subtitle: "Python, SQL" });
    expect(splitInlineText(": x")).toEqual({ title: "", subtitle: "x" });
    expect(splitInlineText("Dean's List")).toEqual({ title: "Dean's List", subtitle: "" });
    expect(splitInlineText("A: b: c")).toEqual({ title: "A", subtitle: "b: c" });
  });

  it("joins with a colon-space only when there is a subtitle", () => {
    expect(joinInlineText("Languages", "Python, SQL")).toBe("Languages: Python, SQL");
    expect(joinInlineText("Dean's List", "")).toBe("Dean's List");
  });
});

describe("nextKind", () => {
  it("follows the Enter table", () => {
    expect(nextKind("name")).toBe("contact");
    expect(nextKind("contact")).toBe("heading");
    expect(nextKind("heading")).toBe("entry");
    expect(nextKind("entry")).toBe("role");
    expect(nextKind("role")).toBe("bullet");
    expect(nextKind("bullet")).toBe("bullet");
    expect(nextKind("text")).toBe("text");
  });
});

describe("partField", () => {
  it("maps each kind and part to its style field", () => {
    expect(partField("name", 1)).toBe("name");
    expect(partField("name", 2)).toBeNull();
    expect(partField("contact", 1)).toBe("contact");
    expect(partField("contact", 2)).toBeNull();
    expect(partField("heading", 1)).toBe("sectionTitle");
    expect(partField("heading", 2)).toBeNull();
    expect(partField("entry", 1)).toBe("title");
    expect(partField("entry", 2)).toBe("location");
    expect(partField("role", 1)).toBe("subtitle");
    expect(partField("role", 2)).toBe("dates");
    expect(partField("text", 1)).toBe("title");
    expect(partField("text", 2)).toBe("subtitle");
    expect(partField("bullet", 1)).toBeNull();
    expect(partField("bullet", 2)).toBeNull();
  });
});

describe("lineEffectiveStyle", () => {
  it("shows the defaults for each line kind", () => {
    expect(lineEffectiveStyle(line({ kind: "entry", text: "Acme", right: "" }), 1)).toEqual({ bold: true, italic: false });
    expect(lineEffectiveStyle(line({ kind: "role", text: "Engineer", right: "" }), 1)).toEqual({ bold: false, italic: true });
    expect(lineEffectiveStyle(line({ kind: "text", text: "Languages: Python" }), 1)).toEqual({ bold: true, italic: false });
    expect(lineEffectiveStyle(line({ kind: "text", text: "Dean's List" }), 1)).toEqual({ bold: false, italic: false });
    expect(lineEffectiveStyle(line({ kind: "bullet", text: "x", bid: "b" }), 1)).toBeNull();
  });
});

describe("toggleLineStyle / resetLineStyle", () => {
  const entry = line({ kind: "entry", text: "Acme", right: "" });

  it("returns to no style key after toggling bold twice", () => {
    const once = toggleLineStyle(entry, 1, "bold");
    expect(once.style).toEqual({ bold: false, italic: false });
    const twice = toggleLineStyle(once, 1, "bold");
    expect(twice).not.toHaveProperty("style");
  });

  it("returns the same object for a bullet", () => {
    const bullet = line({ kind: "bullet", text: "x", bid: "b" });
    expect(toggleLineStyle(bullet, 1, "bold")).toBe(bullet);
    expect(resetLineStyle(bullet, 2)).toBe(bullet);
  });

  it("writes part 2 to style2 and resets it", () => {
    const toggled = toggleLineStyle(entry, 2, "italic");
    expect(toggled.style2).toEqual({ bold: false, italic: true });
    expect(toggled).not.toHaveProperty("style");
    expect(resetLineStyle(toggled, 2)).not.toHaveProperty("style2");
  });

  it("does not mutate the input line", () => {
    toggleLineStyle(entry, 1, "bold");
    expect(entry).not.toHaveProperty("style");
  });
});
