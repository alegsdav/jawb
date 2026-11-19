import { describe, expect, it } from "vitest";
import { flattenDoc } from "@/lib/doc/model";
import { isValidDoc } from "@/lib/doc/extensions";
import type { DocJSON } from "@/lib/doc/types";
import { harvardFromParsed } from "@/lib/import/textToHarvard";
import { HARVARD_PAGE } from "@/lib/template";

const docOf = (raw: unknown): DocJSON => harvardFromParsed(raw).doc ?? { type: "doc", content: [] };

const texts = (raw: unknown) => flattenDoc(docOf(raw)).map((p) => p.text);

const full = {
  header: { name: "  Ada Lovelace ", contact: "London • ada@example.com" },
  sections: [
    {
      title: "education",
      items: [{ title: "King's College", subtitle: "B.S. in Mathematics", location: "London, UK", dates: "May 2027", bullets: ["GPA: 3.8"] }],
    },
    {
      title: "Experience",
      items: [
        { title: "Acme", subtitle: "Engineer", location: "Boston, MA", dates: "Jun 2025 – Aug 2025", bullets: ["• Built a dashboard", "- Cut costs by 10%"] },
        { title: "Globex", subtitle: "Analyst", location: "", dates: "", bullets: ["Wrote reports"] },
      ],
    },
    { title: "Skills", items: [{ title: "Languages", subtitle: "Python, SQL", location: "", dates: "", bullets: [] }] },
  ],
};

describe("harvardFromParsed", () => {
  it("builds a valid version 4 resume on the Harvard page setup", () => {
    const r = harvardFromParsed(full);
    expect(r.version).toBe(4);
    expect(r.page).toEqual(HARVARD_PAGE);
    expect(isValidDoc(r.doc)).toBe(true);
  });

  it("lays out the name and contact centered, in Times New Roman, the name bold at 16pt", () => {
    const [name, contact] = flattenDoc(docOf(full));
    expect(name.text).toBe("Ada Lovelace");
    expect(name.node.attrs.textAlign).toBe("center");
    expect(name.node.content?.[0]).toMatchObject({
      marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontFamily: "Times New Roman", fontSize: "16pt" } }],
    });
    expect(contact.text).toBe("London • ada@example.com");
    expect(contact.node.attrs.textAlign).toBe("center");
  });

  it("makes each section a bordered capitalised heading", () => {
    const headings = flattenDoc(docOf(full)).filter((p) => p.node.attrs.borderBottom);
    expect(headings.map((p) => p.text)).toEqual(["EDUCATION", "EXPERIENCE", "SKILLS"]);
  });

  it("puts the organization and location on one line with a tab, and the role and dates on the next", () => {
    const t = texts(full);
    expect(t).toContain("King's College\tLondon, UK");
    expect(t).toContain("B.S. in Mathematics\tMay 2027");
    expect(t).toContain("Acme\tBoston, MA");
    expect(t).toContain("Engineer\tJun 2025 – Aug 2025");
  });

  it("omits the role line when there is no role and no dates", () => {
    const t = texts({ sections: [{ title: "Experience", items: [{ title: "Globex", location: "NYC", bullets: ["x"] }] }] });
    expect(t).toEqual(["EXPERIENCE", "Globex\tNYC", "x"]);
  });

  it("makes bullets a bulletList, without a leading glyph the model kept", () => {
    const paras = flattenDoc(docOf(full));
    const bullets = paras.filter((p) => p.listType === "bulletList");
    expect(bullets.map((p) => p.text)).toEqual(["GPA: 3.8", "Built a dashboard", "Cut costs by 10%", "Wrote reports"]);
    expect(bullets.every((p) => p.bullet && p.depth === 1)).toBe(true);
  });

  it("lays out a single labelled line as a label line, not an entry", () => {
    const paras = flattenDoc(docOf(full));
    const skill = paras.find((p) => p.text === "Languages: Python, SQL");
    expect(skill?.listType).toBeNull();
    expect(skill?.node.content?.[0]).toMatchObject({ marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontFamily: "Times New Roman", fontSize: "11pt" } }] });
  });

  it("spaces the entries after the first in a section", () => {
    const paras = flattenDoc(docOf(full));
    const acme = paras.find((p) => p.text.startsWith("Acme"));
    const globex = paras.find((p) => p.text.startsWith("Globex"));
    const first = paras.find((p) => p.text.startsWith("Acme"));
    expect(first?.node.attrs.spaceBefore ?? 0).toBe(0);
    expect(acme).toBeDefined();
    expect(globex?.node.attrs.spaceBefore).toBe(4);
  });

  it("drops empty sections, items, bullets and blank fields", () => {
    const t = texts({
      header: { name: "", contact: "   " },
      sections: [
        { title: "Empty", items: [{ title: "", subtitle: "", location: "", dates: "", bullets: ["", "   "] }] },
        { title: "Projects", items: [{ title: "Tool", bullets: ["", "Shipped it"] }, null, "junk"] },
      ],
    });
    expect(t).toEqual(["PROJECTS", "Tool\t", "Shipped it"]);
  });

  it("ignores non-string fields and caps the lengths", () => {
    const long = "x".repeat(1000);
    const r = harvardFromParsed({
      header: { name: 42, contact: long },
      sections: [{ title: long, items: [{ title: long, bullets: [{ text: "no" }, long] }] }],
    });
    const paras = flattenDoc(r.doc as DocJSON);
    expect(paras.some((p) => p.text.includes("x".repeat(401)))).toBe(false);
    expect(paras.find((p) => p.node.attrs.borderBottom)?.text.length).toBe(80);
    expect(paras.find((p) => p.listType === "bulletList")?.text.length).toBe(400);
  });

  it("gives an empty document for input that is not a resume", () => {
    for (const raw of [null, undefined, "text", [], { sections: "no" }]) {
      const r = harvardFromParsed(raw);
      expect(r.sections).toEqual([]);
      expect(flattenDoc(docOf(raw)).every((p) => !p.text.trim())).toBe(true);
    }
  });
});

/** The header lines of one item (between its section heading and its bullet "b"), for each combination of parts. */
const headerOf = (x: Partial<Item>) =>
  texts({
    sections: [{ title: "Sec", items: [{ title: "", subtitle: "", location: "", dates: "", bullets: ["b"], ...x }] }],
  }).slice(1, -1);

type Item = { title: string; subtitle: string; location: string; dates: string };

describe("item header lines", () => {
  // Title (T), subtitle/role (S), location (L), dates (D). A line is never only a right-aligned part.
  it.each<[string, Partial<Item>, string[]]>([
    ["nothing", {}, []],
    ["title only", { title: "T" }, ["T\t"]],
    ["role only", { subtitle: "S" }, ["S\t"]],
    ["location only", { location: "L" }, ["L\t"]],
    ["dates only", { dates: "D" }, ["D\t"]],
    ["title and role", { title: "T", subtitle: "S" }, ["T\t", "S\t"]],
    ["title and location", { title: "T", location: "L" }, ["T\tL"]],
    ["title and dates", { title: "T", dates: "D" }, ["T\tD"]],
    ["role and location", { subtitle: "S", location: "L" }, ["L\t", "S\t"]],
    ["role and dates", { subtitle: "S", dates: "D" }, ["S\tD"]],
    ["location and dates", { location: "L", dates: "D" }, ["L\t", "D\t"]],
    ["title, role, location", { title: "T", subtitle: "S", location: "L" }, ["T\tL", "S\t"]],
    ["title, role, dates", { title: "T", subtitle: "S", dates: "D" }, ["T\t", "S\tD"]],
    ["title, location, dates", { title: "T", location: "L", dates: "D" }, ["T\tL", "D\t"]],
    ["role, location, dates", { subtitle: "S", location: "L", dates: "D" }, ["L\t", "S\tD"]],
    ["all four", { title: "T", subtitle: "S", location: "L", dates: "D" }, ["T\tL", "S\tD"]],
  ])("lays out %s", (_name, parts, expected) => {
    expect(headerOf(parts)).toEqual(expected);
  });

  it("puts a project's title and dates on one line, with the dates at the right margin", () => {
    expect(headerOf({ title: "CardSniffer", dates: "Aug. 2026 - Present" })).toEqual(["CardSniffer\tAug. 2026 - Present"]);
    const [line] = flattenDoc(docOf({ sections: [{ title: "Projects", items: [{ title: "CardSniffer", dates: "Aug. 2026", bullets: ["x"] }] }] })).slice(1);
    expect(line.node.content?.map((n) => n.type)).toEqual(["text", "tab", "text"]);
  });

  it("never emits a line that is only a right-aligned part or an empty line", () => {
    const parts: (keyof Item)[] = ["title", "subtitle", "location", "dates"];
    for (let mask = 1; mask < 16; mask++) {
      const x: Partial<Item> = {};
      parts.forEach((k, i) => {
        if (mask & (1 << i)) x[k] = k.toUpperCase();
      });
      for (const line of headerOf(x)) {
        expect(line.trim()).not.toBe("");
        expect(line.startsWith("\t")).toBe(false);
      }
    }
  });

  it("adds the space above only to an item's first line", () => {
    const paras = flattenDoc(docOf({
      sections: [{ title: "Exp", items: [{ title: "A", subtitle: "S", bullets: ["x"] }, { title: "B", subtitle: "R", bullets: ["y"] }] }],
    }));
    expect(paras.find((p) => p.text === "B\t")?.node.attrs.spaceBefore).toBe(4);
    expect(paras.find((p) => p.text === "R\t")?.node.attrs.spaceBefore ?? 0).toBe(0);
  });
});

type Link = { text: string; href: string };

/** Every link in the document, in order: its visible text and its address. */
function linksOf(raw: unknown): Link[] {
  const out: Link[] = [];
  for (const p of flattenDoc(docOf(raw))) {
    for (const n of p.node.content ?? []) {
      if (n.type !== "text") continue;
      for (const m of n.marks ?? []) if (m.type === "link") out.push({ text: n.text, href: m.attrs.href });
    }
  }
  return out;
}

describe("links in the Harvard output", () => {
  it("shows a 'Label (address)' pair as the label, linked to the address", () => {
    const raw = { header: { name: "Ada", contact: "Boston • LinkedIn (https://www.linkedin.com/in/x) • GitHub (https://github.com/x)" } };
    expect(texts(raw)[1]).toBe("Boston • LinkedIn • GitHub");
    expect(linksOf(raw)).toEqual([
      { text: "LinkedIn", href: "https://www.linkedin.com/in/x" },
      { text: "GitHub", href: "https://github.com/x" },
    ]);
  });

  it("links a bare http(s) or www. address, without the punctuation after it", () => {
    const raw = { sections: [{ title: "Projects", items: [{ title: "Tool", bullets: ["See https://example.com/a. Also www.example.org/x"] }] }] };
    expect(texts(raw)).toContain("See https://example.com/a. Also www.example.org/x");
    expect(linksOf(raw)).toEqual([
      { text: "https://example.com/a", href: "https://example.com/a" },
      { text: "www.example.org/x", href: "https://www.example.org/x" },
    ]);
  });

  it("links an email with mailto:", () => {
    expect(linksOf({ header: { name: "Ada", contact: "ada@example.com" } })).toEqual([{ text: "ada@example.com", href: "mailto:ada@example.com" }]);
  });

  it("links a label before a host with a path, as the model may keep it", () => {
    expect(linksOf({ header: { name: "Ada", contact: "LinkedIn (linkedin.com/in/x)" } })).toEqual([
      { text: "LinkedIn", href: "https://linkedin.com/in/x" },
    ]);
  });

  it("leaves text that is not an address alone", () => {
    const raw = { sections: [{ title: "Skills", items: [{ title: "Stack", subtitle: "Python (3.11), Vue.js (v3)", bullets: ["Used javascript:alert(1) and data:x"] }] }] };
    expect(linksOf(raw)).toEqual([]);
    expect(texts(raw)).toContain("Python (3.11), Vue.js (v3)\t");
  });
});
