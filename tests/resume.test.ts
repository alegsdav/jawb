import { describe, expect, it } from "vitest";
import { bulletTextMap, countChangedBullets, normalizeResume, reconcileIds, RESUME_VERSION } from "@/lib/resume";
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
          { title: "Volunteer", subtitle: "Food Bank", location: "", dates: "", bullets: ["Helped"] },
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
    expect(volunteer.title).toBe("Volunteer");
    expect(volunteer.subtitle).toBe("Food Bank");
  });

  it("leaves inline skills lines untouched", () => {
    const skills = normalizeResume(v1).sections[1].items[0];
    expect(skills).toMatchObject({ title: "Languages", subtitle: "Python, SQL", dates: "", location: "", bullets: [] });
  });

  it("gives every section, item and bullet an id and converts string bullets", () => {
    const r = normalizeResume(v1);
    for (const id of allIds(r)) expect(id).toMatch(/\S/);
    expect(r.sections[0].items[0].bullets[0].text).toBe("Did a thing");
  });

  it("is idempotent on v2 content", () => {
    const once = normalizeResume(v1);
    expect(normalizeResume(once)).toEqual(once);
    expect(normalizeResume(master())).toEqual(master());
  });

  it("keeps string facts and drops junk ones", () => {
    const r = normalizeResume({ ...master(), facts: ["Speaks Spanish", 42, null, "Eagle Scout"] });
    expect(r.facts).toEqual(["Speaks Spanish", "Eagle Scout"]);
    expect(normalizeResume({ sections: [] }).facts).toBeUndefined();
  });

  it("tolerates garbage", () => {
    expect(() => normalizeResume(null)).not.toThrow();
    expect(normalizeResume(undefined).sections).toEqual([]);
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
