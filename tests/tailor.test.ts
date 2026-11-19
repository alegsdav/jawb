import { describe, expect, it } from "vitest";
import {
  addAllFromMaster, addFromMaster, applyPull, cloneForJob, compareMap, diffFields, dismissAdditions, ensureBaseline, JOB_FIELDS,
  makeBaseline, omitKeys, planPull, readBaseline, replaceBullet, resolveRemoval, stripBaseline,
} from "@/lib/tailor";
import { buildDoc, findParagraph, flattenDoc, paragraph, type FlatEntry } from "@/lib/doc/model";
import { resumeDoc, emptyResume, withDoc } from "@/lib/resume";
import type { DocMark } from "@/lib/doc/types";
import type { Job, Resume } from "@/lib/types";

// A resume document from paragraph entries: `heading` (section heading), `entry` (an entry line with a tab),
// `bullet` (a bullet), `line` (a plain line). Ids are the paragraph ids.
type Opts = { marks?: DocMark[] };
const heading = (id: string, text: string): FlatEntry => ({
  node: paragraph(text, { attrs: { id, borderBottom: true } }), listType: null, depth: 0, bullet: false,
});
const entry = (id: string, text: string): FlatEntry => ({ node: paragraph(text, { attrs: { id } }), listType: null, depth: 0, bullet: false });
const bullet = (id: string, text: string, opts: Opts = {}): FlatEntry => ({
  node: paragraph(text, { attrs: { id }, marks: opts.marks }), listType: "bulletList", depth: 1, bullet: true,
});
const resume = (...lines: FlatEntry[]): Resume => withDoc(emptyResume(), buildDoc(lines));

/** The standard master: a section with one entry and three bullets. */
const master0 = () => resume(heading("s", "EXPERIENCE"), entry("i", "Co\tBoston"), bullet("a", "A1"), bullet("b", "B1"), bullet("c", "C1"));
const texts = (r: Resume) => Object.fromEntries(flattenDoc(resumeDoc(r)).map((p) => [p.id, p.text]));

describe("baseline", () => {
  it("cloneForJob drops facts, keeps the paragraph ids and records the master's text", () => {
    const master = { ...master0(), facts: ["secret"] };
    const copy = cloneForJob(master);
    expect(copy.facts).toBeUndefined();
    expect(flattenDoc(resumeDoc(copy)).map((p) => p.id)).toEqual(["s", "i", "a", "b", "c"]);
    expect(copy.baseline).toEqual({ s: "EXPERIENCE", i: "Co\tBoston", a: "A1", b: "B1", c: "C1" });
    expect(stripBaseline(copy)).not.toHaveProperty("baseline");
  });

  it("readBaseline keeps only string values and drops the legacy header keys", () => {
    expect(readBaseline({ baseline: { a: "x", b: 3 } })).toEqual({ a: "x" });
    expect(readBaseline({ baseline: { "header.name": "Ann", a: "x" } })).toEqual({ a: "x" });
    expect(readBaseline({ baseline: ["x"] })).toBeUndefined();
    expect(readBaseline(null)).toBeUndefined();
  });

  it("ensureBaseline only adds one when missing", () => {
    const master = master0();
    const old = resume(heading("s", "EXPERIENCE"), bullet("a", "mine"));
    const r = ensureBaseline(old, master);
    expect(r.added).toBe(true);
    expect(r.resume.baseline).toEqual(makeBaseline(master));
    expect(ensureBaseline(r.resume, master0()).added).toBe(false);
  });

  it("compareMap is the baseline when present, else the master's paragraph text", () => {
    const master = master0();
    expect(compareMap({ a: "A1" }, master)).toEqual(new Map([["a", "A1"]]));
    expect(compareMap(undefined, master)?.get("b")).toBe("B1");
    expect(compareMap(undefined, null)).toBeNull();
  });
});

describe("pull master changes", () => {
  const masterV1 = master0();
  // The copy: the same paragraphs, bullet b reworded here.
  const copy = replaceBullet(cloneForJob(masterV1), "b", "B mine");

  it("nothing to pull while the master is unchanged", () => {
    expect(planPull(copy, masterV1)).toEqual({ bullets: 0, skipped: 0, total: 0, additions: [], removals: [] });
  });

  it("takes new master wording for untouched lines, never for edited ones", () => {
    const masterV2 = resume(heading("s", "EXPERIENCE"), entry("i", "Co\tBoston"), bullet("a", "A2"), bullet("b", "B2"), bullet("c", "C1"), bullet("d", "D new"));
    expect(planPull(copy, masterV2)).toMatchObject({ bullets: 1, skipped: 1, total: 1 });
    expect(planPull(copy, masterV2).additions).toEqual([
      { kind: "bullet", id: "d", label: "D new", where: "Co", ids: ["d"] },
    ]);
    const r = applyPull(copy, masterV2);
    expect(texts(r.resume)).toMatchObject({ a: "A2", b: "B mine", c: "C1" });
    expect(texts(r.resume)).not.toHaveProperty("d"); // new master lines aren't added by Pull
    // The baseline moves to the master, except the new line "d" that isn't added yet (still offered).
    const { d: _d, ...rest } = makeBaseline(masterV2);
    void _d;
    expect(r.resume.baseline).toEqual(rest);
    expect(r).toMatchObject({ bullets: 1, skipped: 1, total: 1 });
    // Once pulled, the same change isn't offered again; the addition still is.
    expect(planPull(r.resume, masterV2).total).toBe(0);
    expect(planPull(r.resume, masterV2).additions.map((a) => a.id)).toEqual(["d"]);
  });

  it("a pulled line takes the master's marks with its wording", () => {
    const master = resume(heading("s", "EXPERIENCE"), bullet("a", "A2", { marks: [{ type: "bold" }] }), bullet("b", "B1"), bullet("c", "C1"));
    const r = applyPull(cloneForJob(masterV1), master).resume;
    expect(findParagraph(resumeDoc(r), "a")?.node.content).toEqual([{ type: "text", text: "A2", marks: [{ type: "bold" }] }]);
  });

  it("does nothing for copies without a baseline", () => {
    expect(planPull(resume(bullet("a", "A1")), resume(bullet("a", "A2"))).total).toBe(0);
  });
});

describe("additions from the master", () => {
  const masterV1 = master0();
  const copy = cloneForJob(masterV1);

  it("a new bullet goes after its neighbour, with its formatting", () => {
    const master = resume(
      heading("s", "EXPERIENCE"), entry("i", "Co\tBoston"), bullet("a", "A1"), bullet("b", "B1"), bullet("c", "C1"),
      bullet("d", "D new", { marks: [{ type: "bold" }] }),
    );
    const r = addFromMaster(copy, master, { id: "d" });
    expect(flattenDoc(resumeDoc(r)).map((p) => p.id)).toEqual(["s", "i", "a", "b", "c", "d"]);
    const d = findParagraph(resumeDoc(r), "d");
    expect(d?.listType).toBe("bulletList");
    expect(d?.node.content).toEqual([{ type: "text", text: "D new", marks: [{ type: "bold" }] }]);
    expect(r.baseline?.d).toBe("D new");
    expect(r.sections[0].items[0].bullets.map((b) => b.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("a new entry goes into its section, after the entry before it in the master", () => {
    const master = resume(
      heading("s", "EXPERIENCE"), entry("i", "Co\tBoston"), bullet("a", "A1"), bullet("b", "B1"), bullet("c", "C1"),
      entry("j", "Other\tRome"), bullet("k", "K1"),
    );
    const plan = planPull(copy, master);
    expect(plan.additions).toEqual([{ kind: "item", id: "j", label: "Other", where: "EXPERIENCE", ids: ["j", "k"] }]);
    const r = addFromMaster(copy, master, plan.additions[0]);
    expect(r.sections[0].items.map((it) => it.id)).toEqual(["i", "j"]);
    expect(r.sections[0].items[1].bullets.map((b) => b.id)).toEqual(["k"]);
  });

  it("a new section goes after the section before it, with all its lines", () => {
    const master = resume(
      heading("s", "EXPERIENCE"), entry("i", "Co\tBoston"), bullet("a", "A1"), bullet("b", "B1"), bullet("c", "C1"),
      heading("p", "PROJECTS"), entry("q", "Robot\tSpring"), bullet("r", "R1"),
    );
    const plan = planPull(copy, master);
    expect(plan.additions).toEqual([{ kind: "section", id: "p", label: "PROJECTS", where: "", ids: ["p", "q", "r"] }]);
    const r = addFromMaster(copy, master, plan.additions[0]);
    expect(r.sections.map((s) => s.id)).toEqual(["s", "p"]);
    expect(r.sections[1].items[0].bullets.map((b) => b.id)).toEqual(["r"]);
  });

  it("addAllFromMaster takes every addition; dismissAdditions stops offering them", () => {
    const master = resume(
      heading("s", "EXPERIENCE"), entry("i", "Co\tBoston"), bullet("a", "A1"), bullet("b", "B1"), bullet("c", "C1"),
      heading("p", "PROJECTS"), bullet("r", "R1"),
    );
    expect(planPull(addAllFromMaster(copy, master), master).additions).toEqual([]);
    const left = dismissAdditions(copy, master, planPull(copy, master).additions);
    expect(planPull(left, master).additions).toEqual([]);
    expect(texts(left)).not.toHaveProperty("p");
  });
});

describe("removals from the master", () => {
  const copy = cloneForJob(master0());
  const masterV3 = resume(heading("s", "EXPERIENCE"), entry("i", "Co\tBoston"), bullet("a", "A1"), bullet("b", "B1"));

  it("a bullet the master removed is offered, with its paragraph", () => {
    expect(planPull(copy, masterV3).removals).toEqual([{ kind: "bullet", id: "c", label: "C1", where: "Co", ids: ["c"] }]);
  });

  it("remove deletes it from the copy and stops listing it", () => {
    const [removal] = planPull(copy, masterV3).removals;
    const r = resolveRemoval(copy, removal, "remove");
    expect(texts(r)).not.toHaveProperty("c");
    expect(planPull(r, masterV3).removals).toEqual([]);
  });

  it("keep keeps it in the copy and stops listing it", () => {
    const [removal] = planPull(copy, masterV3).removals;
    const r = resolveRemoval(copy, removal, "keep");
    expect(texts(r)).toMatchObject({ c: "C1" });
    expect(planPull(r, masterV3).removals).toEqual([]);
  });

  it("a removed line the copy edited is not offered", () => {
    const edited = replaceBullet(copy, "c", "C mine");
    expect(planPull(edited, masterV3).removals).toEqual([]);
  });
});

describe("replaceBullet", () => {
  it("replaces the text, keeps the paragraph and its formatting", () => {
    const master = resume(heading("s", "EXPERIENCE"), bullet("a", "A1", { marks: [{ type: "bold" }] }));
    const out = replaceBullet(master, "a", "Totally new");
    expect(findParagraph(resumeDoc(out), "a")).toMatchObject({
      listType: "bulletList",
      node: { attrs: { id: "a" }, content: [{ type: "text", text: "Totally new", marks: [{ type: "bold" }] }] },
    });
    expect(out.sections[0].items[0].bullets).toEqual([{ id: "a", text: "Totally new" }]);
  });

  it("an unknown id leaves the text alone", () => {
    const master = master0();
    expect(texts(replaceBullet(master, "zz", "x"))).toEqual(texts(master));
  });
});

describe("job autosave diff", () => {
  const base = {
    id: "j", company: "Acme", title: "Intern", location: "", url: "", description: "", status: "to_apply", date_applied: null,
    follow_up_date: null, notes: "", analysis: null, cover_letter: "", deadline: null, submitted_resume: null, submitted_at: null,
    submitted_tailored: null, created_at: "", updated_at: "",
  } as Job;

  it("sends only changed fields", () => {
    expect(diffFields(base, { ...base }, JOB_FIELDS)).toEqual({});
    expect(diffFields(base, { ...base, notes: "hi", status: "applied" }, JOB_FIELDS)).toEqual({ notes: "hi", status: "applied" });
  });

  it("ignores analysis and treats undefined like null (rows without migration 0002)", () => {
    const old = { ...base } as Partial<Job>;
    delete old.deadline;
    expect(diffFields(old as Job, { ...base, analysis: normalizeLike() }, JOB_FIELDS)).toEqual({});
  });

  it("compares snapshots by value", () => {
    const snap = resume(bullet("a", "A"));
    expect(diffFields({ ...base, submitted_resume: snap }, { ...base, submitted_resume: structuredClone(snap) }, JOB_FIELDS)).toEqual({});
    expect(diffFields(base, { ...base, submitted_resume: snap }, JOB_FIELDS)).toEqual({ submitted_resume: snap });
  });

  it("omitKeys strips migration columns", () => {
    expect(omitKeys({ notes: "x", deadline: "2026-01-01", submitted_at: null }, ["deadline", "submitted_at"])).toEqual({ notes: "x" });
  });
});

function normalizeLike() {
  return { fit: "possible", verdict: "", keywords: { matched: [], missing: [] }, strengths: [], gaps: [], bullets: [], questions: [] } as Job["analysis"];
}
