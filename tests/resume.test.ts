import { describe, expect, it } from "vitest";
import { docEquals, setParagraphText, flattenDoc } from "@/lib/doc/model";
import {
  bulletTextMap,
  countChangedBullets,
  emptyResume,
  isEmptyResume,
  normalizeResume,
  reconcileIds,
  RESUME_VERSION,
  resumeDoc,
  withDoc,
} from "@/lib/resume";
import type { Resume } from "@/lib/types";

const b = (id: string, text: string) => ({ id, text });

function master(): Resume {
  return {
    version: 2,
    header: { name: "Ada Lovelace", contact: "ada@example.com" },
    facts: ["Tutored 30 students in calculus"],
    sections: [
      {
        id: "s-exp",
        title: "Experience",
        items: [
          {
            id: "i-acme",
            title: "Acme Corp",
            subtitle: "Software Engineering Intern",
            location: "Boston, MA",
            dates: "Jun 2025 - Aug 2025",
            bullets: [
              b("b1", "Built a React dashboard used by 40 analysts to track shipments"),
              b("b2", "Cut API latency by 30% by adding Redis caching to the orders service"),
              b("b3", "Wrote integration tests in Jest for the billing pipeline"),
            ],
          },
          {
            id: "i-lab",
            title: "University Robotics Lab",
            subtitle: "Research Assistant",
            location: "",
            dates: "2024 - Present",
            bullets: [b("b4", "Programmed ROS nodes for a warehouse robot path planner")],
          },
        ],
      },
      {
        id: "s-skills",
        title: "Skills",
        items: [{ id: "i-lang", title: "Languages", subtitle: "Python, TypeScript, SQL", location: "", dates: "", bullets: [] }],
      },
    ],
  };
}

/** Same content as a fresh parse would return it: every id is new. */
function reparsed(r: Resume): Resume {
  let n = 0;
  const id = () => `new${n++}`;
  return {
    version: 2,
    header: { ...r.header },
    sections: r.sections.map((s) => ({
      id: id(),
      title: s.title,
      items: s.items.map((it) => ({ ...it, id: id(), bullets: it.bullets.map((x) => ({ id: id(), text: x.text })) })),
    })),
  };
}

const allIds = (r: Resume) =>
  r.sections.flatMap((s) => [s.id, ...s.items.flatMap((it) => [it.id, ...it.bullets.map((x) => x.id)])]);

describe("normalizeResume", () => {
  const v1 = {
    header: { name: "Ada", contact: "ada@example.com" },
    sections: [
      {
        title: "Experience",
        items: [
          { title: "Software Intern", subtitle: "Acme Corp", location: "Boston", dates: "2025", bullets: ["Did a thing"] },
          { title: "Park Cleanup", subtitle: "Food Bank", location: "", dates: "", bullets: ["Helped"] },
        ],
      },
      { title: "Skills", items: [{ title: "Languages", subtitle: "Python, SQL", bullets: [] }] },
    ],
  };

  it("swaps v1 title/subtitle only for entries with dates or location", () => {
    const r = normalizeResume(v1);
    expect(r.version).toBe(RESUME_VERSION);
    const [acme, volunteer] = r.sections[0].items;
    expect(acme.title).toBe("Acme Corp");
    expect(acme.subtitle).toBe("Software Intern");
    expect(acme.location).toBe("Boston");
    expect(volunteer.title).toBe("Park Cleanup");
    expect(volunteer.subtitle).toBe("Food Bank");
  });

  it("keeps inline skills lines as one line (title is the whole line in version 4)", () => {
    const skills = normalizeResume(v1).sections[1].items[0];
    expect(skills).toMatchObject({ title: "Languages: Python, SQL", subtitle: "", dates: "", location: "", bullets: [] });
  });

  it("gives every section, item and bullet an id and converts string bullets", () => {
    const r = normalizeResume(v1);
    for (const id of allIds(r)) expect(id).toMatch(/\S/);
    expect(r.sections[0].items[0].bullets[0].text).toBe("Did a thing");
  });

  it("is idempotent: normalizing a normalized resume changes nothing", () => {
    const once = normalizeResume(v1);
    expect(normalizeResume(once)).toEqual(once);
    const twice = normalizeResume(master());
    expect(normalizeResume(twice)).toEqual(twice);
  });

  it("keeps string facts and drops junk ones", () => {
    const r = normalizeResume({ ...master(), facts: ["Speaks Spanish", 42, null, "Eagle Scout"] });
    expect(r.facts).toEqual(["Speaks Spanish", "Eagle Scout"]);
    expect(normalizeResume({ sections: [] }).facts).toBeUndefined();
  });

  it("is version 4 with a document and derived sections", () => {
    const r = normalizeResume(v1);
    expect(r.version).toBe(4);
    expect(r.doc).toBeDefined();
    expect(r.sections.map((s) => s.title)).toEqual(["EXPERIENCE", "SKILLS"]);
  });

  it("tolerates garbage", () => {
    expect(() => normalizeResume(null)).not.toThrow();
    expect(normalizeResume(undefined).sections).toEqual([]);
  });
});

/** A version 3 resume with explicit formatting, as the editor stored it. */
function v3(): Record<string, unknown> {
  return {
    version: 3,
    header: {
      name: "Ada",
      contact: "ada@example.com",
      marks: { name: [{ from: 0, to: 3, bold: true, size: 16 }] },
      para: { name: { align: "center" } },
    },
    sections: [
      {
        id: "s1",
        title: "Experience",
        para: { rule: true, caps: true, spaceBefore: 6 },
        items: [
          {
            id: "i1",
            title: "Acme",
            subtitle: "",
            location: "Boston",
            dates: "2025",
            bullets: [
              { id: "b1", text: "Built a dashboard" },
              { id: "b2", text: "Cut latency" },
            ],
            para: { entry: { spaceBefore: 3 } },
          },
        ],
      },
    ],
  };
}

describe("normalizeResume: version 3 to version 4", () => {
  it("normalizing the same v3 resume twice gives equal documents", () => {
    const a = normalizeResume(v3());
    const b = normalizeResume(v3());
    expect(docEquals(a.doc!, b.doc!)).toBe(true);
    expect(docEquals(normalizeResume(a).doc!, a.doc!)).toBe(true);
  });

  it("keeps legacy bullet ids as paragraph ids and as derived bullet ids", () => {
    const r = normalizeResume(v3());
    const ids = flattenDoc(r.doc!).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["s1", "i1", "b1", "b2"]));
    expect(r.sections[0].id).toBe("s1");
    expect(r.sections[0].items[0].id).toBe("i1");
    expect(r.sections[0].items[0].bullets.map((b) => b.id)).toEqual(["b1", "b2"]);
    expect(r.sections[0].items[0].bullets[0].text).toBe("Built a dashboard");
  });

  it("converts explicit formatting to document marks, attributes and text", () => {
    const d = normalizeResume(v3()).doc!;
    const [name] = flattenDoc(d);
    expect(name.id).toBe("hdr-name");
    expect(name.node.attrs).toMatchObject({ textAlign: "center" });
    expect(name.node.content).toEqual([{ type: "text", text: "Ada", marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontSize: "16pt" } }] }]);
    const heading = flattenDoc(d).find((p) => p.id === "s1")!;
    expect(heading.text).toBe("EXPERIENCE");
    expect(heading.node.attrs).toMatchObject({ borderBottom: true, spaceBefore: 6 });
  });

  it("reads a version 4 document as the source of truth: edits show up in the derived sections", () => {
    const r = normalizeResume(v3());
    const edited = withDoc(r, setParagraphText(r.doc!, "b1", "Built a React dashboard"));
    expect(edited.sections[0].items[0].bullets.map((b) => [b.id, b.text])).toEqual([
      ["b1", "Built a React dashboard"],
      ["b2", "Cut latency"],
    ]);
    const again = normalizeResume(JSON.parse(JSON.stringify(edited)));
    expect(again).toEqual(edited);
    expect(docEquals(resumeDoc(again), edited.doc!)).toBe(true);
  });

  it("keeps facts, baseline and page, and drops page setups with bad margins", () => {
    const withMeta = normalizeResume({ ...v3(), facts: ["Speaks Spanish"], baseline: { b1: "old", n: 3 }, page: { marginTop: 1, marginBottom: 1, marginLeft: 0.75, marginRight: 0.75 } });
    expect(withMeta.facts).toEqual(["Speaks Spanish"]);
    expect(withMeta.baseline).toEqual({ b1: "old" });
    expect(withMeta.page).toEqual({ marginTop: 1, marginBottom: 1, marginLeft: 0.75, marginRight: 0.75 });
    expect(normalizeResume({ ...v3(), page: { marginTop: 9, marginBottom: 1, marginLeft: 1, marginRight: 1 } }).page).toBeUndefined();
  });
});

describe("emptyResume and isEmptyResume", () => {
  it("starts as version 4 with a blank document", () => {
    const r = emptyResume();
    expect(r.version).toBe(RESUME_VERSION);
    expect(r.sections).toEqual([]);
    expect(isEmptyResume(r)).toBe(true);
  });

  it("is not empty once the document has text", () => {
    const r = emptyResume();
    expect(isEmptyResume(withDoc(r, setParagraphText(r.doc!, flattenDoc(r.doc!)[0].id, "Ada")))).toBe(false);
  });
});

describe("reconcileIds", () => {
  it("keeps every id when the re-import is identical", () => {
    const prev = master();
    const out = reconcileIds(prev, reparsed(prev));
    expect(allIds(out)).toEqual(allIds(prev));
  });

  it("keeps a bullet's id when its wording was edited", () => {
    const prev = master();
    const next = reparsed(prev);
    next.sections[0].items[0].bullets[1].text = "Cut API latency by 35% by adding Redis caching to the order service";
    const out = reconcileIds(prev, next);
    expect(out.sections[0].items[0].bullets[1]).toEqual({
      id: "b2",
      text: "Cut API latency by 35% by adding Redis caching to the order service",
    });
  });

  it("keeps ids when bullets are reordered", () => {
    const prev = master();
    const next = reparsed(prev);
    next.sections[0].items[0].bullets.reverse();
    const out = reconcileIds(prev, next);
    expect(out.sections[0].items[0].bullets.map((x) => x.id)).toEqual(["b3", "b2", "b1"]);
  });

  it("gives a brand-new bullet a new id and uses each old id once", () => {
    const prev = master();
    const next = reparsed(prev);
    const acme = next.sections[0].items[0];
    acme.bullets.push({ id: "fresh", text: "Presented a design review to the VP of engineering" });
    // A near-duplicate of b1 can't claim b1 a second time.
    acme.bullets.push({ id: "dupe", text: "Built a React dashboard used by 40 analysts to track shipments" });
    const out = reconcileIds(prev, next);
    const ids = out.sections[0].items[0].bullets.map((x) => x.id);
    expect(ids.slice(0, 3)).toEqual(["b1", "b2", "b3"]);
    expect(ids[3]).toBe("fresh");
    expect(ids[4]).toBe("dupe");
    expect(new Set(allIds(out)).size).toBe(allIds(out).length);
  });

  it("does not match unrelated bullets", () => {
    const prev = master();
    const next = reparsed(prev);
    next.sections[0].items[0].bullets[2].text = "Organized a 200-person hackathon with three sponsors";
    const out = reconcileIds(prev, next);
    expect(out.sections[0].items[0].bullets[2].id).not.toBe("b3");
  });

  it("matches sections case-insensitively and survives a renamed section heading", () => {
    const prev = master();
    const next = reparsed(prev);
    next.sections[0].title = "Work Experience";
    next.sections[1].title = "SKILLS";
    const out = reconcileIds(prev, next);
    expect(out.sections.map((s) => s.id)).toEqual(["s-exp", "s-skills"]);
    expect(out.sections[0].title).toBe("Work Experience");
    expect(out.sections[0].items.map((it) => it.id)).toEqual(["i-acme", "i-lab"]);
    expect(out.sections[0].items[0].bullets.map((x) => x.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("matches items by title alone when the subtitle changed", () => {
    const prev = master();
    const next = reparsed(prev);
    next.sections[0].items[0].subtitle = "Software Engineer Intern II";
    const out = reconcileIds(prev, next);
    expect(out.sections[0].items[0].id).toBe("i-acme");
    expect(out.sections[0].items[0].subtitle).toBe("Software Engineer Intern II");
  });

  it("gives new sections and items new ids", () => {
    const prev = master();
    const next = reparsed(prev);
    next.sections.push({
      id: "new-s",
      title: "Projects",
      items: [{ id: "new-i", title: "Chess engine", subtitle: "", location: "", dates: "2023", bullets: [{ id: "new-b", text: "Wrote it in Rust" }] }],
    });
    const out = reconcileIds(prev, next);
    expect(out.sections[2].id).toBe("new-s");
    expect(out.sections[2].items[0].id).toBe("new-i");
    expect(out.sections[2].items[0].bullets[0].id).toBe("new-b");
  });

  it("re-ids a new node that collides with a carried-over id", () => {
    const prev = master();
    const next = reparsed(prev);
    next.sections[0].items[1].bullets.push({ id: "b1", text: "Completely unrelated new bullet about gardening" });
    const out = reconcileIds(prev, next);
    const ids = allIds(out);
    expect(new Set(ids).size).toBe(ids.length);
    expect(out.sections[0].items[0].bullets[0].id).toBe("b1");
  });

  it("keeps the previous version's legacy facts JSON as stored (facts live in their own table now)", () => {
    const prev = master();
    const next = reparsed(prev);
    expect(reconcileIds(prev, next).facts).toEqual(["Tutored 30 students in calculus"]);
    next.facts = ["Fluent in Mandarin"];
    expect(reconcileIds(prev, next).facts).toEqual(["Tutored 30 students in calculus"]);
    expect(reconcileIds({ ...prev, facts: undefined }, next)).not.toHaveProperty("facts");
  });

  it("keeps the version and the new header", () => {
    const prev = master();
    const next = reparsed(prev);
    next.header.contact = "ada@new.example.com";
    const out = reconcileIds(prev, next);
    expect(out.version).toBe(2);
    expect(out.header.contact).toBe("ada@new.example.com");
  });

  it("does not mutate its inputs", () => {
    const prev = master();
    const next = reparsed(prev);
    const before = JSON.stringify(next);
    reconcileIds(prev, next);
    expect(JSON.stringify(next)).toBe(before);
    expect(prev).toEqual(master());
  });
});

describe("change counting with bulletTextMap", () => {
  it("counts edited and added bullets against the master", () => {
    const m = master();
    const tailored: Resume = JSON.parse(JSON.stringify(m));
    expect(countChangedBullets(tailored, bulletTextMap(m))).toBe(0);
    tailored.sections[0].items[0].bullets[0].text = "Built a React + D3 dashboard for 40 analysts";
    tailored.sections[0].items[1].bullets.push({ id: "added", text: "New bullet" });
    expect(countChangedBullets(tailored, bulletTextMap(m))).toBe(2);
  });

  it("stays meaningful after the master is re-imported and reconciled", () => {
    const prev = master();
    const tailored: Resume = JSON.parse(JSON.stringify(prev));
    tailored.sections[0].items[0].bullets[0].text = "Shipped a React dashboard for 40 analysts tracking shipments";
    const reimported = reconcileIds(prev, reparsed(prev));
    // Only the bullet the user actually tailored differs; without reconciling, all four would.
    expect(countChangedBullets(tailored, bulletTextMap(reimported))).toBe(1);
    expect(countChangedBullets(tailored, bulletTextMap(reparsed(prev)))).toBe(4);
  });
});
