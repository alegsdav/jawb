import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applySaveAsMaster, baseFromBaseline, baselineAfterMasterSave, carryDrafts, freezesSnapshot, isApplied, jobPatch, mergeAnalyses,
  mergeBaselines, mergeTailored, planSaveAsMaster, planTailoredRefresh, rebaseJob, removeIds, saveTailoredDocument,
  statusConflictOutcome, tailoredFromRow, writeJobIfUnchanged,
} from "@/lib/jobSync";
import { cloneForJob, makeBaseline, planPull } from "@/lib/tailor";
import { bulletTextMap } from "@/lib/resume";
import type { Analysis, Item, Job, Resume } from "@/lib/types";

// ---------- fixtures ----------

const item = (id: string, title: string, bullets: [string, string][], extra: Partial<Item> = {}): Item => ({
  id, title, subtitle: "", location: "", dates: "", bullets: bullets.map(([bid, text]) => ({ id: bid, text })), ...extra,
});

const master1 = (): Resume => ({
  version: 2,
  header: { name: "Ann Lee", contact: "ann@x.com" },
  sections: [
    {
      id: "exp",
      title: "Experience",
      items: [
        item("acme", "Acme", [["a1", "Built a dashboard"], ["a2", "Wrote tests"], ["a3", "Fixed bugs"]], { subtitle: "Intern", dates: "2025" }),
        item("beta", "Beta", [["b1", "Ran a study"]]),
      ],
    },
    { id: "edu", title: "Education", items: [item("uni", "State U", [["g1", "GPA 3.9"]])] },
  ],
  facts: ["Speaks Spanish"],
});

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const edit = <T,>(x: T, fn: (d: T) => void): T => {
  const d = clone(x);
  fn(d);
  return d;
};
const texts = (r: Resume) => Object.fromEntries(bulletTextMap(r));
const order = (r: Resume, itemId: string) => r.sections.flatMap((s) => s.items).find((it) => it.id === itemId)!.bullets.map((b) => b.id);

const analysis = (over: Partial<Analysis> = {}): Analysis => ({
  fit: "possible",
  verdict: "OK",
  keywords: { matched: [], missing: [] },
  strengths: [],
  gaps: [],
  bullets: [{ bullet_id: "a1", rating: "weak", note: "vague", rewrite: "Built a [N]-user dashboard", original: "Built a dashboard" }],
  questions: [
    { id: "q1", question: "How many users?", why: "", bullet_id: "a1", placeholder: "[N]" },
    { id: "q2", question: "Did you use SQL?", why: "" },
  ],
  answers: {},
  dismissed: [],
  analyzed_at: "2026-11-01T10:00:00.000Z",
  ...over,
});

const job = (over: Partial<Job> = {}): Job => ({
  id: "j1", company: "Acme", title: "Data Intern", location: "Boston", url: "", description: "desc", status: "to_apply",
  date_applied: null, follow_up_date: null, notes: "", analysis: analysis(), cover_letter: "", deadline: null,
  submitted_resume: null, submitted_at: null, submitted_tailored: null, reached_interview: false,
  created_at: "2026-11-01T00:00:00Z", updated_at: "t1", ...over,
});

// ---------- mergeAnalyses ----------

describe("mergeAnalyses", () => {
  it("keeps an answer saved on the other device when this tab didn't touch answers (the stale-laptop bug)", () => {
    const base = analysis();
    const local = { ...base, dismissed: ["a1"] }; // stale laptop rejected a suggestion
    const server = { ...base, answers: { q1: "300" } }; // phone saved an answer
    const m = mergeAnalyses(base, local, server)!;
    expect(m.answers).toEqual({ q1: "300" });
    expect(m.dismissed).toEqual(["a1"]);
  });

  it("merges answers by question id: each side's own changes survive", () => {
    const base = analysis({ answers: { q1: "100" } });
    const local = { ...base, answers: { q1: "100", q2: "Yes, in class" } };
    const server = { ...base, answers: { q1: "300" } };
    expect(mergeAnalyses(base, local, server)!.answers).toEqual({ q1: "300", q2: "Yes, in class" });
  });

  it("an answer cleared on one side stays cleared unless the other side edited it", () => {
    const base = analysis({ answers: { q1: "100", q2: "No" } });
    const local = { ...base, answers: { q2: "No" } }; // cleared q1
    const server = { ...base, answers: { q1: "100", q2: "Yes" } }; // edited q2
    expect(mergeAnalyses(base, local, server)!.answers).toEqual({ q2: "Yes" });
    const server2 = { ...base, answers: { q1: "250", q2: "No" } }; // edited the one we cleared
    expect(mergeAnalyses(base, local, server2)!.answers).toEqual({ q1: "250", q2: "No" });
  });

  it("both changed the same answer differently: this tab's wins", () => {
    const base = analysis({ answers: { q1: "100" } });
    expect(mergeAnalyses(base, { ...base, answers: { q1: "mine" } }, { ...base, answers: { q1: "theirs" } })!.answers).toEqual({ q1: "mine" });
  });

  it("dismissed is a union within the same run", () => {
    const base = analysis({ dismissed: [] });
    const m = mergeAnalyses(base, { ...base, dismissed: ["a1"] }, { ...base, dismissed: ["a9"] })!;
    expect(m.dismissed!.sort()).toEqual(["a1", "a9"]);
  });

  it("a newer run on the server supplies questions and bullets; this tab's new answers map by question text", () => {
    const base = analysis();
    const local = { ...base, answers: { q2: "Yes, SQL in a class project" }, dismissed: ["a1"] };
    const server = analysis({
      analyzed_at: "2026-11-02T10:00:00.000Z",
      verdict: "Better now",
      bullets: [{ bullet_id: "a2", rating: "ok", note: "n", rewrite: "Wrote [N] tests", original: "Wrote tests" }],
      questions: [
        { id: "q9", question: "Did you use  sql?", why: "" },
        { id: "q10", question: "How many tests?", why: "", bullet_id: "a2", placeholder: "[N]" },
      ],
      dismissed: [],
    });
    const m = mergeAnalyses(base, local, server)!;
    expect(m.verdict).toBe("Better now");
    expect(m.bullets.map((b) => b.bullet_id)).toEqual(["a2"]);
    expect(m.questions.map((q) => q.id)).toEqual(["q9", "q10"]);
    expect(m.answers).toEqual({ q9: "Yes, SQL in a class project" });
    expect(m.dismissed).toEqual([]); // the old rejections were for the old suggestions
  });

  it("keeps an answered question the newer run no longer asks", () => {
    const base = analysis();
    const local = { ...base, answers: { q1: "300" } };
    const server = analysis({ analyzed_at: "2026-11-02T10:00:00.000Z", questions: [{ id: "q1", question: "Something new?", why: "" }] });
    const m = mergeAnalyses(base, local, server)!;
    expect(m.questions.map((q) => q.question)).toEqual(["Something new?", "How many users?"]);
    const kept = m.questions.find((q) => q.question === "How many users?")!;
    expect(kept.id).not.toBe("q1");
    expect(m.answers).toEqual({ [kept.id]: "300" });
  });

  it("a newer run here (this tab re-analyzed) wins over the server's older run, keeping the server's answers", () => {
    const base = analysis();
    const server = { ...base, answers: { q2: "Yes" } };
    const local = analysis({ analyzed_at: "2026-11-03T00:00:00.000Z", verdict: "fresh", questions: [{ id: "n1", question: "Did you use SQL?", why: "" }] });
    const m = mergeAnalyses(base, local, server)!;
    expect(m.verdict).toBe("fresh");
    expect(m.answers).toEqual({ n1: "Yes" });
  });

  it("returns the server's analysis untouched when this tab changed nothing", () => {
    const base = analysis();
    const server = { ...base, answers: { q1: "5" }, dismissed: ["a1"] };
    expect(mergeAnalyses(base, base, server)).toEqual(server);
  });

  it("handles missing sides", () => {
    const a = analysis();
    expect(mergeAnalyses(null, null, a)).toBe(a);
    expect(mergeAnalyses(null, a, null)).toBe(a);
    expect(mergeAnalyses(null, a, { ...a, answers: { q1: "1" } })!.answers).toEqual({ q1: "1" });
  });
});

describe("carryDrafts", () => {
  it("untouched boxes show the new answers; typed, unsaved text stays", () => {
    const prev = analysis({ answers: { q1: "100" } });
    const next = analysis({ answers: { q1: "300", q2: "Yes" } });
    expect(carryDrafts(prev, next, { q1: "100", q2: "" }).drafts).toEqual({ q1: "300", q2: "Yes" });
    expect(carryDrafts(prev, next, { q1: "150 (typing)" }).drafts).toEqual({ q1: "150 (typing)", q2: "Yes" });
  });

  it("maps a draft to the new run's question by text, and keeps a question that disappeared", () => {
    const prev = analysis();
    const next = analysis({ analyzed_at: "2026-11-05T00:00:00Z", questions: [{ id: "z2", question: "did you use sql?", why: "" }] });
    const r = carryDrafts(prev, next, { q1: "40 users", q2: "Yes" });
    expect(r.drafts.z2).toBe("Yes");
    const kept = r.analysis!.questions.find((q) => q.question === "How many users?")!;
    expect(r.drafts[kept.id]).toBe("40 users");
  });
});

// ---------- job row ----------

describe("rebaseJob / jobPatch", () => {
  it("re-applies only the fields this tab changed on top of the server row", () => {
    const base = job();
    const local = { ...base, notes: "Referral: Sam", deadline: "2026-12-01" };
    const server = { ...base, follow_up_date: "2026-11-20", cover_letter: "Dear team", updated_at: "t2" };
    const r = rebaseJob(local, base, server);
    expect(r).toMatchObject({ notes: "Referral: Sam", deadline: "2026-12-01", follow_up_date: "2026-11-20", cover_letter: "Dear team", updated_at: "t2" });
    expect(jobPatch(server, r)).toEqual({ notes: "Referral: Sam", deadline: "2026-12-01" });
  });

  it("a stale tab with no edits takes everything from the server (status, snapshot, analysis)", () => {
    const base = job();
    const server = job({
      status: "applied", submitted_at: "2026-11-10T12:00:00Z", submitted_resume: master1(), date_applied: "2026-11-10",
      analysis: { ...analysis(), answers: { q1: "300" } }, updated_at: "t9",
    });
    const r = rebaseJob(base, base, server);
    expect(r).toEqual(server);
    expect(jobPatch(server, r)).toEqual({});
  });

  it("this tab's field edit beats the server's for the same field (last edit here is re-applied)", () => {
    const base = job({ notes: "a" });
    expect(rebaseJob({ ...base, notes: "mine" }, base, { ...base, notes: "theirs" }).notes).toBe("mine");
  });

  it("merges the analysis instead of replacing it", () => {
    const base = job();
    const local = { ...base, analysis: { ...base.analysis!, dismissed: ["a1"] } };
    const server = { ...base, analysis: { ...base.analysis!, answers: { q1: "300" } } };
    const r = rebaseJob(local, base, server);
    expect(r.analysis).toMatchObject({ answers: { q1: "300" }, dismissed: ["a1"] });
    expect(Object.keys(jobPatch(server, r))).toEqual(["analysis"]);
  });

  it("jobPatch ignores an analysis that is equal but a different object", () => {
    const base = job();
    expect(jobPatch(base, { ...base, analysis: clone(base.analysis) })).toEqual({});
  });
});

describe("status conflicts", () => {
  it("knows which patches freeze a snapshot", () => {
    expect(freezesSnapshot({ status: "applied", submitted_at: "x", submitted_resume: master1() })).toBe(true);
    expect(freezesSnapshot({ status: "rejected" })).toBe(false);
    expect(freezesSnapshot({ status: "to_apply", submitted_at: null, submitted_resume: null })).toBe(false);
  });

  it("never overwrites another device's snapshot", () => {
    const p = { status: "applied" as const, submitted_at: "x", submitted_resume: master1() };
    expect(statusConflictOutcome(p, { submitted_at: "2026-11-10T00:00:00Z" })).toBe("already-applied");
    expect(statusConflictOutcome(p, { submitted_at: null })).toBe("retry");
    expect(statusConflictOutcome({ status: "rejected" }, { submitted_at: "y" })).toBe("retry");
    expect(statusConflictOutcome(p, null)).toBe("gone");
  });

  it("the quiet applied view is on only while the job is in a sent status with a snapshot", () => {
    expect(isApplied({ submitted_at: "x", status: "applied" })).toBe(true);
    expect(isApplied({ submitted_at: "x", status: "rejected" })).toBe(true);
    expect(isApplied({ submitted_at: "x", status: "to_apply" })).toBe(false);
    expect(isApplied({ submitted_at: null, status: "applied" })).toBe(false);
  });
});

// ---------- tailored copy ----------

describe("mergeTailored", () => {
  const copy0 = () => cloneForJob(master1());

  it("edits to different bullets on two devices both survive", () => {
    const base = copy0();
    const phone = edit(base, (d) => (d.sections[0].items[0].bullets[0].text = "Phone edit A"));
    const laptop = edit(base, (d) => (d.sections[0].items[0].bullets[1].text = "Laptop edit B"));
    const { merged, conflicts } = mergeTailored(base, laptop, phone);
    expect(conflicts).toEqual([]);
    expect(texts(merged)).toMatchObject({ a1: "Phone edit A", a2: "Laptop edit B" });
    expect(merged.baseline).toEqual(base.baseline);
  });

  it("the same bullet changed differently is a conflict (merged holds this tab's version)", () => {
    const base = copy0();
    const phone = edit(base, (d) => (d.sections[0].items[0].bullets[0].text = "Phone"));
    const laptop = edit(base, (d) => (d.sections[0].items[0].bullets[0].text = "Laptop"));
    const { merged, conflicts } = mergeTailored(base, laptop, phone);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ local: "Laptop", server: "Phone" });
    expect(texts(merged).a1).toBe("Laptop");
  });

  it("merges the baseline key by key (a pull on the other device keeps its baseline)", () => {
    const base = copy0();
    const server = edit(base, (d) => {
      d.sections[0].items[0].bullets[2].text = "Fixed 12 bugs";
      d.baseline!.a3 = "Fixed 12 bugs";
    });
    const local = edit(base, (d) => (d.sections[0].items[0].bullets[0].text = "Mine"));
    const { merged, conflicts } = mergeTailored(base, local, server);
    expect(conflicts).toEqual([]);
    expect(merged.baseline!.a3).toBe("Fixed 12 bugs");
    expect(texts(merged)).toMatchObject({ a1: "Mine", a3: "Fixed 12 bugs" });
  });

  it("mergeBaselines handles additions, deletions and missing sides", () => {
    expect(mergeBaselines({ x: "1" }, { x: "1", y: "2" }, { x: "3" })).toEqual({ x: "3", y: "2" });
    expect(mergeBaselines({ x: "1", z: "9" }, { x: "1" }, { x: "1", z: "9" })).toEqual({ x: "1" });
    expect(mergeBaselines(undefined, undefined, undefined)).toBeUndefined();
  });

  it("tailoredFromRow keeps the baseline that normalizeResume drops", () => {
    const c = copy0();
    expect(tailoredFromRow(JSON.parse(JSON.stringify(c))).baseline).toEqual(c.baseline);
  });
});

describe("planTailoredRefresh", () => {
  const base = { content: cloneForJob(master1()), updatedAt: "t1" };
  const theirs = edit(base.content, (d) => (d.sections[0].items[0].bullets[0].text = "Theirs"));

  it("does nothing when the server didn't change", () => {
    expect(planTailoredRefresh(base, base.content, { content: clone(base.content), updatedAt: "t1" })).toEqual({ kind: "none" });
  });
  it("shows theirs when nothing is unsaved here", () => {
    expect(planTailoredRefresh(base, base.content, { content: theirs, updatedAt: "t2" })).toEqual({ kind: "replace", content: theirs });
  });
  it("merges unsaved edits here with theirs", () => {
    const mine = edit(base.content, (d) => (d.sections[0].items[0].bullets[1].text = "Mine"));
    const p = planTailoredRefresh(base, mine, { content: theirs, updatedAt: "t2" });
    expect(p.kind).toBe("merge");
    expect(texts((p as { content: Resume }).content)).toMatchObject({ a1: "Theirs", a2: "Mine" });
  });
  it("reports a conflict when both changed the same bullet", () => {
    const mine = edit(base.content, (d) => (d.sections[0].items[0].bullets[0].text = "Mine"));
    expect(planTailoredRefresh(base, mine, { content: theirs, updatedAt: "t2" }).kind).toBe("conflict");
  });
});

// ---------- save as master ----------

describe("planSaveAsMaster", () => {
  it("applies the copy's rewording and keeps a bullet added to the master later", () => {
    const m1 = master1();
    const copy = edit(cloneForJob(m1), (d) => (d.sections[0].items[0].bullets[0].text = "Built a Tableau dashboard for 40 users"));
    const m2 = edit(m1, (d) => d.sections[0].items[0].bullets.push({ id: "a4", text: "Mentored 2 interns" }));
    const plan = planSaveAsMaster(copy, m2);
    expect(texts(plan.merged)).toEqual({ ...texts(m2), a1: "Built a Tableau dashboard for 40 users" });
    expect(order(plan.merged, "acme")).toEqual(["a1", "a2", "a3", "a4"]);
    expect(plan.merged.facts).toEqual(["Speaks Spanish"]);
    expect(plan.merged.baseline).toBeUndefined();
    expect(plan).toMatchObject({ edited: 1, added: 0, kept: 1, removals: [], conflicts: [] });
  });

  it("keeps master rewordings the copy didn't touch", () => {
    const m1 = master1();
    const copy = edit(cloneForJob(m1), (d) => (d.sections[0].items[0].bullets[0].text = "Copy A"));
    const m2 = edit(m1, (d) => (d.sections[0].items[0].bullets[1].text = "Wrote 120 unit tests"));
    expect(texts(planSaveAsMaster(copy, m2).merged)).toMatchObject({ a1: "Copy A", a2: "Wrote 120 unit tests" });
  });

  it("inserts bullets and entries added in the copy next to their neighbours", () => {
    const m1 = master1();
    const copy = edit(cloneForJob(m1), (d) => {
      d.sections[0].items[0].bullets.splice(1, 0, { id: "n1", text: "New after a1" });
      d.sections[0].items.splice(1, 0, item("gamma", "Gamma", [["c1", "Gamma bullet"]]));
    });
    const m2 = edit(m1, (d) => d.sections[0].items[0].bullets.unshift({ id: "a0", text: "Master-first bullet" }));
    const plan = planSaveAsMaster(copy, m2);
    expect(order(plan.merged, "acme")).toEqual(["a0", "a1", "n1", "a2", "a3"]);
    expect(plan.merged.sections[0].items.map((it) => it.id)).toEqual(["acme", "gamma", "beta"]);
    expect(plan.added).toBe(2);
  });

  it("never deletes master content: copy deletions are offered (unticked) as removals", () => {
    const m1 = master1();
    const copy = edit(cloneForJob(m1), (d) => {
      d.sections[0].items[0].bullets.splice(2, 1); // a3 trimmed for this job
      d.sections[0].items.splice(1, 1); // Beta trimmed for this job
    });
    const plan = planSaveAsMaster(copy, m1);
    expect(texts(plan.merged)).toEqual(texts(m1));
    expect(plan.removals.map((r) => `${r.kind}:${r.id}`)).toEqual(["bullet:a3", "item:beta"]);
    expect(texts(applySaveAsMaster(copy, m1, new Set()))).toEqual(texts(m1));
    const removed = applySaveAsMaster(copy, m1, new Set(["a3"]));
    expect(order(removed, "acme")).toEqual(["a1", "a2"]);
    expect(removed.sections[0].items.map((it) => it.id)).toEqual(["acme", "beta"]);
    // A ticked id that isn't a removal candidate is ignored.
    expect(texts(applySaveAsMaster(copy, m1, new Set(["g1"])))).toEqual(texts(m1));
  });

  it("returns the same master object when the copy adds nothing (so updateMaster skips the write)", () => {
    const m1 = master1();
    expect(applySaveAsMaster(cloneForJob(m1), m1, new Set())).toBe(m1);
  });

  it("does not resurrect master content deleted after the copy was made, unless the copy edited it", () => {
    const m1 = master1();
    const copy = cloneForJob(m1);
    const m2 = edit(m1, (d) => d.sections[0].items.splice(1, 1)); // Beta removed from master later
    expect(planSaveAsMaster(copy, m2).merged.sections[0].items.map((it) => it.id)).toEqual(["acme"]);
    const edited = edit(copy, (d) => (d.sections[0].items[1].bullets[0].text = "Ran a 30-person study"));
    expect(planSaveAsMaster(edited, m2).merged.sections[0].items.map((it) => it.id)).toEqual(["acme", "beta"]);
  });

  it("header, section and entry edits apply; entry details the baseline doesn't track take the copy's value", () => {
    const m1 = master1();
    const copy = edit(cloneForJob(m1), (d) => {
      d.header.contact = "ann@new.com";
      d.sections[1].title = "EDUCATION";
      d.sections[0].items[0].subtitle = "Data Intern";
    });
    const m2 = edit(m1, (d) => (d.header.name = "Ann B. Lee"));
    const merged = planSaveAsMaster(copy, m2).merged;
    expect(merged.header).toEqual({ name: "Ann B. Lee", contact: "ann@new.com" });
    expect(merged.sections[1].title).toBe("EDUCATION");
    expect(merged.sections[0].items[0].subtitle).toBe("Data Intern");
  });

  it("both changed the same bullet: the copy's wording wins and the conflict is reported", () => {
    const m1 = master1();
    const copy = edit(cloneForJob(m1), (d) => (d.sections[0].items[0].bullets[0].text = "Copy"));
    const m2 = edit(m1, (d) => (d.sections[0].items[0].bullets[0].text = "Master"));
    const plan = planSaveAsMaster(copy, m2);
    expect(texts(plan.merged).a1).toBe("Copy");
    expect(plan.conflicts).toHaveLength(1);
  });

  it("baseFromBaseline rebuilds the master as the copy saw it", () => {
    const m1 = master1();
    const copy = edit(cloneForJob(m1), (d) => {
      d.sections[0].items[0].bullets[0].text = "Edited";
      d.sections[0].items[0].bullets.push({ id: "new", text: "Added here" });
    });
    const b = baseFromBaseline(copy, m1);
    expect(texts(b)).toEqual({ a1: "Built a dashboard", a2: "Wrote tests", a3: "Fixed bugs", b1: "Ran a study", g1: "GPA 3.9" });
  });

  it("removeIds drops sections, entries and bullets by id", () => {
    const r = removeIds(master1(), new Set(["edu", "beta", "a2"]));
    expect(r.sections.map((s) => s.id)).toEqual(["exp"]);
    expect(order(r, "acme")).toEqual(["a1", "a3"]);
  });
});

describe("baselineAfterMasterSave", () => {
  it("nothing reads as changed afterwards, but master-only additions are still offered", () => {
    const m1 = master1();
    const copy = edit(cloneForJob(m1), (d) => (d.sections[0].items[0].bullets[0].text = "Copy A"));
    const m2 = edit(m1, (d) => d.sections[0].items[0].bullets.push({ id: "a4", text: "Mentored 2 interns" }));
    const newMaster = applySaveAsMaster(copy, m2, new Set());
    const after = { ...copy, baseline: baselineAfterMasterSave(copy, newMaster) };
    expect(after.baseline!.a1).toBe("Copy A");
    const plan = planPull(after, newMaster);
    expect(plan.additions.map((a) => a.id)).toEqual(["a4"]);
    expect(plan.total).toBe(0);
  });

  it("a master rewording this copy never touched is still offered by Pull", () => {
    const m1 = master1();
    const copy = cloneForJob(m1);
    const m2 = edit(m1, (d) => (d.sections[0].items[0].bullets[1].text = "Wrote 120 unit tests"));
    const newMaster = applySaveAsMaster(copy, m2, new Set());
    const after = { ...copy, baseline: baselineAfterMasterSave(copy, newMaster) };
    expect(planPull(after, newMaster).bullets).toBe(1);
  });

  it("content deleted here and kept on the master stays deleted here (not re-offered)", () => {
    const m1 = master1();
    const copy = edit(cloneForJob(m1), (d) => d.sections[0].items[0].bullets.splice(2, 1));
    const newMaster = applySaveAsMaster(copy, m1, new Set());
    const after = { ...copy, baseline: baselineAfterMasterSave(copy, newMaster) };
    expect(planPull(after, newMaster).additions).toEqual([]);
    expect(after.baseline).toEqual(makeBaseline(newMaster));
  });
});

// ---------- database helpers with a fake PostgREST ----------

type Filters = { eq: Record<string, unknown>; is: Record<string, unknown> };

function fakeDb(table: "resumes" | "jobs", row: Record<string, unknown>) {
  let n = 0;
  const hooks: (() => void)[] = [];
  const calls: { op: string; values?: Record<string, unknown>; f: Filters }[] = [];
  /** Errors the next updates fail with (e.g. a missing column). */
  const failNext: { code: string; message: string }[] = [];
  const handle = (op: string, values: Record<string, unknown> | undefined, f: Filters) => {
    calls.push({ op, values, f });
    if (op === "select") return { data: { ...row }, error: null };
    if (failNext.length) return { data: null, error: failNext.shift() };
    hooks.shift()?.();
    const ok =
      Object.entries(f.eq).every(([k, v]) => row[k] === v) && Object.entries(f.is).every(([k, v]) => (v === null ? row[k] == null : row[k] === v));
    if (!ok) return { data: [], error: null };
    Object.assign(row, values);
    row.updated_at = `saved-${++n}`;
    return { data: [{ updated_at: row.updated_at }], error: null };
  };
  const client = {
    from(t: string) {
      expect(t).toBe(table);
      let op = "select";
      let values: Record<string, unknown> | undefined;
      const f: Filters = { eq: {}, is: {} };
      const b = {
        select: () => b,
        update: (v: Record<string, unknown>) => ((op = "update"), (values = v), b),
        eq: (k: string, v: unknown) => ((f.eq[k] = v), b),
        is: (k: string, v: unknown) => ((f.is[k] = v), b),
        maybeSingle: () => b,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(handle(op, values, f)).then(res, rej),
      };
      return b;
    },
  } as unknown as SupabaseClient;
  const other = (patch: Record<string, unknown>) => {
    Object.assign(row, patch);
    row.updated_at = `other-${++n}`;
  };
  return { client, row, calls, hooks, other, failNext };
}

describe("saveTailoredDocument", () => {
  it("writes conditionally on updated_at", async () => {
    const base = cloneForJob(master1());
    const db = fakeDb("resumes", { id: "r1", content: clone(base), updated_at: "t1" });
    const mine = edit(base, (d) => (d.sections[0].items[0].bullets[0].text = "Mine"));
    const out = await saveTailoredDocument(db.client, "r1", mine, { content: base, updatedAt: "t1" });
    expect(out).toMatchObject({ kind: "saved", merged: false, updatedAt: "saved-1" });
    expect(db.calls[0].f.eq).toEqual({ id: "r1", updated_at: "t1" });
  });

  it("a stale tab merges with the other device's save instead of overwriting it", async () => {
    const base = cloneForJob(master1());
    const db = fakeDb("resumes", { id: "r1", content: clone(base), updated_at: "t1" });
    db.other({ content: edit(base, (d) => (d.sections[0].items[0].bullets[0].text = "Phone A")) });
    const laptop = edit(base, (d) => (d.sections[0].items[0].bullets[1].text = "Laptop B"));
    const out = await saveTailoredDocument(db.client, "r1", laptop, { content: base, updatedAt: "t1" });
    expect(out.kind).toBe("saved");
    expect((out as { merged: boolean }).merged).toBe(true);
    expect(texts(tailoredFromRow(db.row.content))).toMatchObject({ a1: "Phone A", a2: "Laptop B" });
    expect(tailoredFromRow(db.row.content).baseline).toEqual(base.baseline);
  });

  it("stops without writing on a same-bullet conflict", async () => {
    const base = cloneForJob(master1());
    const db = fakeDb("resumes", { id: "r1", content: clone(base), updated_at: "t1" });
    db.other({ content: edit(base, (d) => (d.sections[0].items[0].bullets[0].text = "Phone")) });
    const out = await saveTailoredDocument(db.client, "r1", edit(base, (d) => (d.sections[0].items[0].bullets[0].text = "Laptop")), {
      content: base,
      updatedAt: "t1",
    });
    expect(out.kind).toBe("conflict");
    expect(texts(tailoredFromRow(db.row.content)).a1).toBe("Phone");
  });

  it("retries when another save lands between the re-read and the merged write", async () => {
    const base = cloneForJob(master1());
    const db = fakeDb("resumes", { id: "r1", content: clone(base), updated_at: "t1" });
    db.other({ content: edit(base, (d) => (d.sections[0].items[0].bullets[0].text = "Phone A")) });
    db.hooks.push(() => {}, () => db.other({ content: edit(tailoredFromRow(db.row.content), (d) => (d.sections[1].items[0].bullets[0].text = "GPA 4.0")) }));
    const laptop = edit(base, (d) => (d.sections[0].items[0].bullets[1].text = "Laptop B"));
    const out = await saveTailoredDocument(db.client, "r1", laptop, { content: base, updatedAt: "t1" });
    expect(out.kind).toBe("saved");
    expect(texts(tailoredFromRow(db.row.content))).toMatchObject({ a1: "Phone A", a2: "Laptop B", g1: "GPA 4.0" });
  });
});

describe("writeJobIfUnchanged", () => {
  it("writes when updated_at matches and reports stale otherwise", async () => {
    const db = fakeDb("jobs", { id: "j1", notes: "", submitted_at: null, updated_at: "t1" });
    const missing = new Set<string>();
    expect(await writeJobIfUnchanged(db.client, "j1", { notes: "hi" }, "t1", missing)).toMatchObject({ kind: "saved", updatedAt: "saved-1" });
    expect(await writeJobIfUnchanged(db.client, "j1", { notes: "stale" }, "t1", missing)).toMatchObject({ kind: "stale" });
    expect(db.row.notes).toBe("hi");
  });

  it("a snapshot write matches 0 rows when another device already froze one", async () => {
    const db = fakeDb("jobs", { id: "j1", status: "to_apply", submitted_at: null, updated_at: "t1" });
    const missing = new Set<string>();
    db.other({ status: "applied", submitted_at: "2026-11-10T00:00:00Z" });
    const patch = { status: "applied" as const, submitted_at: "2026-11-12T00:00:00Z", submitted_resume: master1() };
    const ver = db.row.updated_at as string;
    expect(await writeJobIfUnchanged(db.client, "j1", patch, ver, missing, { requireNoSnapshot: true })).toMatchObject({ kind: "stale" });
    expect(db.row.submitted_at).toBe("2026-11-10T00:00:00Z");
    expect(db.calls.at(-1)!.f.is).toEqual({ submitted_at: null });
  });

  it("drops optional columns the database doesn't have and still saves the rest", async () => {
    const db = fakeDb("jobs", { id: "j1", notes: "", updated_at: "t1" });
    db.failNext.push({ code: "PGRST204", message: "Could not find the 'deadline' column of 'jobs' in the schema cache" });
    const missing = new Set<string>();
    const out = await writeJobIfUnchanged(db.client, "j1", { notes: "x", deadline: "2026-12-01" }, "t1", missing);
    expect(out).toMatchObject({ kind: "saved", droppedColumns: true, written: { notes: "x" } });
    expect([...missing]).toEqual(["deadline"]);
    expect(db.row.notes).toBe("x");
  });
});
