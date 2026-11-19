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
