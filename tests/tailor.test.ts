import { describe, expect, it } from "vitest";
import {
  applyPull, cloneForJob, compareMap, diffFields, ensureBaseline, HEADER_CONTACT, HEADER_NAME, JOB_FIELDS, makeBaseline, omitKeys,
  planPull, readBaseline, stripBaseline,
} from "@/lib/tailor";
import { bulletTextMap, countChangedBullets } from "@/lib/resume";
import type { Job, Resume } from "@/lib/types";

const doc = (texts: Record<string, string>, header = { name: "Ann", contact: "ann@x.com" }): Resume => ({
  version: 2,
  header,
  sections: [
    {
      id: "s",
      title: "Experience",
      items: [{ id: "i", title: "Co", subtitle: "", location: "", dates: "", bullets: Object.entries(texts).map(([id, text]) => ({ id, text })) }],
    },
  ],
});

describe("baseline", () => {
  it("cloneForJob drops facts and records the master's wording", () => {
    const master = { ...doc({ a: "A1", b: "B1" }), facts: ["secret"] };
    const copy = cloneForJob(master);
    expect(copy.facts).toBeUndefined();
    expect(copy.baseline).toEqual({
      a: "A1", b: "B1", [HEADER_NAME]: "Ann", [HEADER_CONTACT]: "ann@x.com", "section:s": "Experience", "item:i": "Co",
    });
    expect(stripBaseline(copy)).not.toHaveProperty("baseline");
  });

  it("readBaseline keeps only string values", () => {
    expect(readBaseline({ baseline: { a: "x", b: 3 } })).toEqual({ a: "x" });
    expect(readBaseline({ baseline: ["x"] })).toBeUndefined();
    expect(readBaseline(null)).toBeUndefined();
  });

  it("ensureBaseline only adds one when missing", () => {
    const master = doc({ a: "A1" });
    const old = doc({ a: "mine" });
    const r = ensureBaseline(old, master);
    expect(r.added).toBe(true);
    expect(r.resume.baseline).toEqual(makeBaseline(master));
    expect(ensureBaseline(r.resume, doc({ a: "A2" })).added).toBe(false);
  });

  it("change markers compare against the baseline when present", () => {
    const copy = { ...doc({ a: "A1", b: "edited", c: "new" }), baseline: { a: "A1", b: "B1" } };
    const master = doc({ a: "A2", b: "B2" });
    expect(countChangedBullets(copy, compareMap(copy.baseline, master)!)).toBe(2); // b edited, c added
    expect(countChangedBullets(copy, compareMap(undefined, master)!)).toBe(3);
    expect(compareMap(undefined, null)).toBeNull();
  });
});

describe("pull master changes", () => {
  const masterV1 = doc({ a: "A1", b: "B1", c: "C1" });
  const copy = { ...cloneForJob(masterV1), sections: doc({ a: "A1", b: "B mine", c: "C1", x: "only here" }).sections };

  it("nothing to pull while the master is unchanged", () => {
    expect(planPull(copy, masterV1)).toEqual({
      header: false, headerKept: false, bullets: 0, skipped: 0, total: 0, additions: [], removals: [],
    });
  });

  it("takes new master wording for untouched bullets, never for edited ones, and syncs the header", () => {
    const masterV2 = doc({ a: "A2", b: "B2", c: "C1", d: "D new" }, { name: "Ann Lee", contact: "ann@x.com" });
    expect(planPull(copy, masterV2)).toMatchObject({ header: true, headerKept: false, bullets: 1, skipped: 1, total: 2 });
    expect(planPull(copy, masterV2).additions).toEqual([{ kind: "bullet", id: "d", itemId: "i", text: "D new", where: "Co" }]);
    const r = applyPull(copy, masterV2);
    const texts = bulletTextMap(r.resume);
    expect(texts.get("a")).toBe("A2");
    expect(texts.get("b")).toBe("B mine");
    expect(texts.get("c")).toBe("C1");
    expect(texts.get("x")).toBe("only here");
    expect(texts.has("d")).toBe(false); // new master bullets aren't added
    expect(r.resume.header.name).toBe("Ann Lee");
    // The baseline moves to the master, except the new bullet "d" that wasn't added yet (still offered).
    const { d: _d, ...rest } = makeBaseline(masterV2);
    void _d;
    expect(r.resume.baseline).toEqual(rest);
    expect(r).toMatchObject({ header: true, bullets: 1, skipped: 1 });
    // Once pulled, the same change isn't offered again; the addition still is.
    expect(planPull(r.resume, masterV2).total).toBe(0);
    expect(planPull(r.resume, masterV2).additions.map((a) => a.id)).toEqual(["d"]);
  });

  it("a header edited only in the copy is not an update", () => {
    const mine = { ...copy, header: { name: "Ann (for Acme)", contact: "ann@x.com" } };
    expect(planPull(mine, masterV1).header).toBe(false);
  });

  it("does nothing for copies without a baseline", () => {
    expect(planPull(doc({ a: "A1" }), doc({ a: "A2" })).total).toBe(0);
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
    const snap = doc({ a: "A" });
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
