import { describe, expect, it } from "vitest";
import { outlineFromDoc, outlineGroups, isHeading, headingPredicate, splitLine } from "@/lib/doc/outline";
import { flattenDoc, paragraph } from "@/lib/doc/model";
import type { DocBlock, DocJSON, DocMark, FlatParagraph } from "@/lib/doc/types";

const p = (id: string, text: string, opts: { bold?: boolean; border?: boolean } = {}): DocBlock => {
  const marks: DocMark[] | undefined = opts.bold ? [{ type: "bold" }] : undefined;
  const node = paragraph(text, { marks, attrs: { id, ...(opts.border ? { borderBottom: true } : {}) } });
  return node;
};
/** A paragraph set in a font size in points (the body is 11pt, unmarked), with optional bold, italic, rule, centring. */
const sized = (
  id: string,
  text: string,
  pt: number,
  opts: { bold?: boolean; italic?: boolean; border?: boolean; center?: boolean } = {},
): DocBlock => {
  const marks: DocMark[] = [{ type: "textStyle", attrs: { fontSize: `${pt}pt` } }];
  if (opts.bold) marks.push({ type: "bold" });
  if (opts.italic) marks.push({ type: "italic" });
  const attrs = { id, ...(opts.border ? { borderBottom: true } : {}), ...(opts.center ? { textAlign: "center" as const } : {}) };
  return paragraph(text, { marks, attrs });
};
/** Consecutive bullets as one list. */
const bullets = (...items: [string, string][]): DocBlock => ({
  type: "bulletList",
  content: items.map(([id, text]) => ({ type: "listItem", content: [paragraph(text, { attrs: { id } })] })),
});
const doc = (...content: DocBlock[]): DocJSON => ({ type: "doc", content });

/** A Harvard-style resume: name, contact, EDUCATION (border), EXPERIENCE with two entries, an inline Skills line. */
function harvard(): DocJSON {
  return doc(
    p("h-name", "Ada Lovelace", { bold: true }),
    p("h-contact", "ada@example.com"),
    p("h-edu", "EDUCATION", { border: true }),
    p("harvard", "Harvard University\tCambridge, MA"),
    p("ba", "B.A. in Economics\tMay 2025"),
    bullets(["thesis", "Wrote a thesis on auctions"]),
    p("gap1", ""),
    p("h-exp", "EXPERIENCE", { border: true }),
    p("acme", "Acme Corp\tBoston, MA"),
    p("acme-role", "Software Intern\tJun 2024 - Aug 2024"),
    bullets(["acme-b1", "Built a dashboard"], ["acme-b2", "Cut latency by 30%"]),
    p("second", "Second Corp\tNew York, NY"),
    p("second-role", "Analyst\t2023"),
    bullets(["second-b1", "Modeled prices"]),
    p("h-skills", "SKILLS", { border: true }),
    p("skills", "Languages: Python, SQL"),
  );
}

describe("outlineFromDoc: Harvard-style resume", () => {
  const out = outlineFromDoc(harvard());

  it("reads the name and contact lines", () => {
    expect(out.header).toEqual({ name: "Ada Lovelace", contact: "ada@example.com" });
  });

  it("makes a section per heading, with the heading paragraph's id", () => {
    expect(out.sections.map((s) => [s.id, s.title])).toEqual([
      ["h-edu", "EDUCATION"],
      ["h-exp", "EXPERIENCE"],
      ["h-skills", "SKILLS"],
    ]);
  });

  it("splits entry lines at the tab and reads the second line as subtitle and dates", () => {
    const [edu] = out.sections;
    expect(edu.items).toHaveLength(1);
    expect(edu.items[0]).toEqual({
      id: "harvard",
      title: "Harvard University",
      subtitle: "B.A. in Economics",
      location: "Cambridge, MA",
      dates: "May 2025",
      bullets: [{ id: "thesis", text: "Wrote a thesis on auctions" }],
    });
  });

  it("makes one item per entry, with bullets keyed by their paragraph ids", () => {
    const exp = out.sections[1];
    expect(exp.items.map((it) => it.id)).toEqual(["acme", "second"]);
    expect(exp.items[0]).toMatchObject({ title: "Acme Corp", location: "Boston, MA", subtitle: "Software Intern", dates: "Jun 2024 - Aug 2024" });
    expect(exp.items[0].bullets).toEqual([
      { id: "acme-b1", text: "Built a dashboard" },
      { id: "acme-b2", text: "Cut latency by 30%" },
    ]);
    expect(exp.items[1].bullets).toEqual([{ id: "second-b1", text: "Modeled prices" }]);
  });

  it("keeps an inline line as one item with the whole text as title", () => {
    const skills = out.sections[2];
    expect(skills.items).toEqual([
      { id: "skills", title: "Languages: Python, SQL", subtitle: "", location: "", dates: "", bullets: [] },
    ]);
  });

  it("uses only plain text (no marks or para keys)", () => {
    expect(JSON.stringify(out)).not.toMatch(/"(marks|para)"/);
  });
});

describe("outlineGroups", () => {
  const groups = outlineGroups(harvard());

  it("has the header and every section and item key", () => {
    expect([...groups.keys()].sort()).toEqual(["acme", "h-edu", "h-exp", "h-skills", "harvard", "second", "skills", "header"].sort());
  });

  it("puts the name and contact under header", () => {
    expect(groups.get("header")).toEqual(["h-name", "h-contact"]);
  });

  it("gives an item its first paragraph, second line, bullets and the empty paragraphs after it", () => {
    expect(groups.get("harvard")).toEqual(["harvard", "ba", "thesis", "gap1"]);
    expect(groups.get("acme")).toEqual(["acme", "acme-role", "acme-b1", "acme-b2"]);
  });

  it("gives a section its heading and every paragraph up to the next heading", () => {
    expect(groups.get("h-edu")).toEqual(["h-edu", "harvard", "ba", "thesis", "gap1"]);
    expect(groups.get("h-exp")).toEqual(["h-exp", "acme", "acme-role", "acme-b1", "acme-b2", "second", "second-role", "second-b1"]);
    expect(groups.get("h-skills")).toEqual(["h-skills", "skills"]);
  });

  it("covers every paragraph exactly once per level", () => {
    const all = flattenDoc(harvard()).map((x) => x.id).filter((id) => !id.startsWith("h-name") && !id.startsWith("h-contact"));
    const sectionIds = ["h-edu", "h-exp", "h-skills"];
    const covered = sectionIds.flatMap((s) => groups.get(s)!);
    expect(covered.sort()).toEqual([...all].sort());
    expect(new Set(covered).size).toBe(covered.length);
  });
});

describe("outlineFromDoc: other shapes", () => {
  it("accepts a bold known heading that is not in capitals", () => {
    const out = outlineFromDoc(doc(p("n", "Ada"), p("pr", "Projects", { bold: true }), p("x", "Chess engine\t2023"), bullets(["x1", "Wrote it in Rust"])));
    expect(out.sections.map((s) => s.title)).toEqual(["Projects"]);
    expect(out.sections[0].items[0]).toMatchObject({ id: "x", title: "Chess engine", dates: "" , location: "2023" });
  });

  it("does not take a bold but unknown line as a heading", () => {
    const out = outlineFromDoc(doc(p("n", "Ada"), p("c1", "x@y"), p("c2", "London"), p("c3", "555"), p("u", "Random Bold Line", { bold: true }), p("v", "text")));
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].title).toBe("");
    // A plain line after a tab-less first line is its subtitle, as for any entry without a tab.
    expect(out.sections[0].items).toHaveLength(1);
    expect(out.sections[0].items[0]).toMatchObject({ title: "Random Bold Line", subtitle: "text" });
  });

  it("keeps the text before the first heading as an untitled section", () => {
    const out = outlineFromDoc(
      doc(
        p("n", "Ada Lovelace"),
        p("c1", "ada@example.com"),
        p("c2", "London"),
        p("c3", "Phone 555"),
        p("extra", "Summary line that is not a heading"),
        p("edu", "EDUCATION", { border: true }),
        p("uni", "Uni\tCity"),
      ),
    );
    expect(out.header).toEqual({ name: "Ada Lovelace", contact: "ada@example.com | London | Phone 555" });
    expect(out.sections.map((s) => [s.id, s.title])).toEqual([
      ["extra", ""],
      ["edu", "EDUCATION"],
    ]);
    expect(out.sections[0].items[0].title).toBe("Summary line that is not a heading");
  });

  it("gives an empty name when the first line is a bullet", () => {
    const out = outlineFromDoc(doc(bullets(["b1", "Led a team"]), p("t", "Plain line")));
    expect(out.header).toEqual({ name: "", contact: "" });
    expect(out.sections[0].id).toBe("b1");
    expect(out.sections[0].items[0]).toMatchObject({ id: "b1", title: "", bullets: [{ id: "b1", text: "Led a team" }] });
    expect(out.sections[0].items[1]).toMatchObject({ id: "t", title: "Plain line" });
  });

  it("reads a document with no headings as the header plus one untitled section", () => {
    const out = outlineFromDoc(doc(p("n", "Ada"), p("c", "ada@x"), p("c2", "London"), p("c3", "555"), p("a", "Did a thing"), bullets(["ab", "Detail"])));
    expect(out.header.name).toBe("Ada");
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0]).toMatchObject({ id: "a", title: "" });
    expect(out.sections[0].items[0]).toMatchObject({ id: "a", title: "Did a thing", bullets: [{ id: "ab", text: "Detail" }] });
  });

  it("is empty for an empty document", () => {
    expect(outlineFromDoc(doc(p("e", "")))).toEqual({ header: { name: "", contact: "" }, sections: [] });
  });

  it("ignores empty paragraphs for structure", () => {
    const out = outlineFromDoc(doc(p("e0", ""), p("n", "Ada"), p("e1", "   "), p("h", "SKILLS", { border: true }), p("e2", "")));
    expect(out.header.name).toBe("Ada");
    expect(out.sections.map((s) => s.id)).toEqual(["h"]);
  });
});

/** A resume whose headings are 12pt bold with a rule, with one finished entry (Acme) and the given blocks after it. */
function styledResume(...rest: DocBlock[]): DocJSON {
  return doc(
    p("n", "Ada Lovelace"),
    p("c", "ada@example.com"),
    sized("edu", "EDUCATION", 12, { bold: true, border: true }),
    p("uni", "Uni\tCambridge"),
    sized("exp", "EXPERIENCE", 12, { bold: true, border: true }),
    p("acme", "Acme Corp\tBoston, MA"),
    p("acme-role", "Engineer\t2020"),
    bullets(["acme-b1", "Built a dashboard"]),
    ...rest,
  );
}

describe("heading style from the document", () => {
  it("keeps a bold entry title in entry style as an entry, not a heading, even when it is a known heading name", () => {
    const out = outlineFromDoc(
      styledResume(
        sized("vol", "Volunteer", 10, { bold: true }),
        sized("vol-role", "Coordinator", 11, { italic: true }),
        bullets(["vol-b1", "Ran a food drive"]),
      ),
    );
    expect(out.sections.map((s) => s.id)).toEqual(["edu", "exp"]);
    expect(out.sections[1].items.map((it) => it.id)).toEqual(["acme", "vol"]);
    expect(out.sections[1].items[1]).toMatchObject({
      title: "Volunteer",
      subtitle: "Coordinator",
      bullets: [{ id: "vol-b1", text: "Ran a food drive" }],
    });
  });

  it("reads a line set like the headings as a heading", () => {
    const out = outlineFromDoc(
      styledResume(sized("vol", "Volunteer", 12, { bold: true, border: true }), p("vol-role", "Coordinator\t2021 - 2023")),
    );
    expect(out.sections.map((s) => [s.id, s.title])).toEqual([
      ["edu", "EDUCATION"],
      ["exp", "EXPERIENCE"],
      ["vol", "Volunteer"],
    ]);
  });

  it("uses the capitals style of ALL CAPS headings and keeps a bold caps entry as an entry", () => {
    const out = outlineFromDoc(
      doc(
        p("n", "Ada Lovelace"),
        p("c", "ada@example.com"),
        sized("edu", "EDUCATION", 12, { bold: true }),
        p("uni", "Uni\tCambridge"),
        sized("exp", "EXPERIENCE", 12, { bold: true }),
        sized("acme", "ACME CORP", 10, { bold: true }),
        bullets(["acme-b1", "Built a dashboard"]),
      ),
    );
    expect(out.sections.map((s) => s.id)).toEqual(["edu", "exp"]);
    expect(out.sections[1].items[0]).toMatchObject({ id: "acme", title: "ACME CORP", bullets: [{ id: "acme-b1", text: "Built a dashboard" }] });
  });

  it("keeps a plain known heading next to styled headings", () => {
    const out = outlineFromDoc(styledResume(p("sk", "Skills"), p("sk-line", "Python, SQL")));
    expect(out.sections.map((s) => s.id)).toEqual(["edu", "exp", "sk"]);
  });

  it("never reads a line with a tab as a heading, even in heading style", () => {
    const heading = headingPredicate(styledResume());
    const all = flattenDoc(styledResume());
    expect(heading(all.find((x) => x.id === "edu")!)).toBe(true);
    expect(heading(flattenDoc(doc(sized("t", "EXPERIENCE\tBoston", 12, { bold: true, border: true })))[0])).toBe(false);
  });

  it("keeps the older rules when the document shows no heading style", () => {
    const out = outlineFromDoc(
      doc(
        p("n", "Ada Lovelace"),
        p("c", "ada@example.com"),
        p("w", "WORK HISTORY"),
        p("acme", "Acme Corp\tBoston"),
        bullets(["acme-b1", "Built a dashboard"]),
      ),
    );
    expect(out.sections.map((s) => [s.id, s.title])).toEqual([["w", "WORK HISTORY"]]);
  });
});

describe("heading rules", () => {
  const para = (text: string, extra: { bold?: boolean; border?: boolean; list?: boolean } = {}): FlatParagraph => {
    const d = doc(extra.list ? bullets(["x", text]) : p("x", text, { bold: extra.bold, border: extra.border }));
    return flattenDoc(d)[0];
  };

  it("needs a border, all capitals (3+ letters), a bold known heading or a short known heading", () => {
    expect(isHeading(para("EXPERIENCE"))).toBe(true);
    expect(isHeading(para("Experience", { border: true }))).toBe(true);
    expect(isHeading(para("Experience", { bold: true }))).toBe(true);
    expect(isHeading(para("Experience"))).toBe(true);
    expect(isHeading(para("Work Experience:"))).toBe(true);
    expect(isHeading(para("Harvard University"))).toBe(false);
    expect(isHeading(para("AI"))).toBe(false);
  });

  it("rejects list items, tabs, long lines and sentences", () => {
    expect(isHeading(para("EXPERIENCE", { list: true }))).toBe(false);
    expect(isHeading(para("EDUCATION\tBOSTON"))).toBe(false);
    expect(isHeading(para("A".repeat(41)))).toBe(false);
    expect(isHeading(para("EXPERIENCE."))).toBe(false);
    expect(isHeading(para("Skills", { border: true, list: true }))).toBe(false);
  });

  it("splits a line at its first tab", () => {
    expect(splitLine("Acme\tBoston\tExtra")).toEqual({ left: "Acme", right: "Boston\tExtra", tabbed: true });
    expect(splitLine("  Just text ")).toEqual({ left: "Just text", right: "", tabbed: false });
  });
});
