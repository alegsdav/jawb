import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applySaveAsMaster, baseFromBaseline, baselineAfterMasterSave, carryDrafts, freezesSnapshot, isApplied, jobPatch, mergeAnalyses,
  mergeBaselines, mergeTailored, planSaveAsMaster, planTailoredRefresh, rebaseJob, removeIds, saveTailoredDocument,
  statusConflictOutcome, tailoredFromRow, writeJobIfUnchanged,
} from "@/lib/jobSync";
import { buildDoc, flattenDoc, insertParagraphsAfter, paragraph, paragraphText, removeParagraphs, setParagraphText, type FlatEntry } from "@/lib/doc/model";
import { resumeDoc, withDoc } from "@/lib/resume";
import { cloneForJob } from "@/lib/tailor";
import type { DocParagraph } from "@/lib/doc/types";
import type { Analysis, Job, Resume } from "@/lib/types";

// ---------- fixtures: a master resume as a document ----------

/** A plain paragraph (a line, or a heading when its text is all caps). */
const L = (id: string, text: string): FlatEntry => ({ node: paragraph(text, { attrs: { id } }), listType: null, depth: 0, bullet: false });
/** A bullet: the first line of a list item. */
const B = (id: string, text: string): FlatEntry => ({ node: paragraph(text, { attrs: { id } }), listType: "bulletList", depth: 1, bullet: true });

/** Name, contact, Experience (Acme: a1-a3, Beta: b1), Education (State U: g1). */
const master1Entries = (): FlatEntry[] => [
  L("ann", "Ann Lee"),
  L("contact", "ann@x.com"),
  L("h-exp", "EXPERIENCE"),
  L("acme", "Acme\tNew York"),
  L("acme-sub", "Intern\t2025"),
  B("a1", "Built a dashboard"),
  B("a2", "Wrote tests"),
  B("a3", "Fixed bugs"),
  L("beta", "Beta\tBoston"),
  B("b1", "Ran a study"),
  L("h-edu", "EDUCATION"),
  L("uni", "State U"),
  B("g1", "GPA 3.9"),
];

const resumeOf = (entries: FlatEntry[]): Resume => withDoc({ header: { name: "", contact: "" }, sections: [] }, buildDoc(entries));
const master1 = (): Resume => resumeOf(master1Entries());

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const lines = (r: Resume) => flattenDoc(resumeDoc(r)).map((p) => p.text);
const ids = (r: Resume) => flattenDoc(resumeDoc(r)).map((p) => p.id);
const textOf = (r: Resume, id: string) => flattenDoc(resumeDoc(r)).find((p) => p.id === id)?.text;
const withText = (r: Resume, id: string, text: string): Resume => withDoc(r, setParagraphText(resumeDoc(r), id, text));
const withoutIds = (r: Resume, drop: string[]): Resume => withDoc(r, removeParagraphs(resumeDoc(r), drop));
const insertAfter = (r: Resume, afterId: string, entries: FlatEntry[]): Resume => withDoc(r, insertParagraphsAfter(resumeDoc(r), afterId, entries));
/** Paragraph `id` replaced by `fn(node)` (same list placement). */
const mapPara = (r: Resume, id: string, fn: (node: DocParagraph) => DocParagraph): Resume =>
  withDoc(r, buildDoc(flattenDoc(resumeDoc(r)).map((p) => (p.id === id ? { ...p, node: fn(p.node) } : p))));

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

  it("edits to different paragraphs on two devices both survive", () => {
    const base = copy0();
    const phone = withText(base, "a1", "Phone edit A");
    const laptop = withText(base, "a2", "Laptop edit B");
    const { merged, conflicts } = mergeTailored(base, laptop, phone);
    expect(conflicts).toEqual([]);
    expect(textOf(merged, "a1")).toBe("Phone edit A");
    expect(textOf(merged, "a2")).toBe("Laptop edit B");
  });

  it("the same paragraph changed differently is a conflict (merged holds this tab's version)", () => {
    const base = copy0();
    const phone = withText(base, "a1", "Phone");
    const laptop = withText(base, "a1", "Laptop");
    const { merged, conflicts } = mergeTailored(base, laptop, phone);
    expect(conflicts).toEqual([{ where: 'Line "Laptop"', local: "Laptop", server: "Phone" }]);
    expect(textOf(merged, "a1")).toBe("Laptop");
  });

  it("merges the baseline key by key (a pull on the other device keeps its baseline)", () => {
    const base = copy0();
    const server = { ...base, baseline: { ...base.baseline, a3: "Fixed 40 bugs" } };
    const local = withText(base, "a1", "Mine");
    const { merged, conflicts } = mergeTailored(base, local, server);
    expect(conflicts).toEqual([]);
    expect(merged.baseline?.a3).toBe("Fixed 40 bugs");
    expect(textOf(merged, "a1")).toBe("Mine");
  });

  it("mergeBaselines handles additions, deletions and missing sides", () => {
    expect(mergeBaselines({ x: "1" }, { x: "1", y: "2" }, { x: "3" })).toEqual({ x: "3", y: "2" });
    expect(mergeBaselines({ x: "1", z: "9" }, { x: "1" }, { x: "1", z: "9" })).toEqual({ x: "1" });
    expect(mergeBaselines(undefined, undefined, undefined)).toBeUndefined();
  });

  it("tailoredFromRow keeps the baseline that normalizeResume drops", () => {
    const copy = copy0();
    const stored = clone(copy);
    const read = tailoredFromRow(stored);
    expect(read.baseline).toEqual(copy.baseline);
    expect(lines(read)).toEqual(lines(copy));
  });
});

describe("planTailoredRefresh", () => {
  const base = { content: cloneForJob(master1()), updatedAt: "t1" };
  const theirs = withText(base.content, "a1", "Theirs");

  it("does nothing when the server didn't change", () => {
    expect(planTailoredRefresh(base, base.content, { content: clone(base.content), updatedAt: "t1" })).toEqual({ kind: "none" });
  });
  it("shows theirs when nothing is unsaved here", () => {
    expect(planTailoredRefresh(base, base.content, { content: theirs, updatedAt: "t2" })).toEqual({ kind: "replace", content: theirs });
  });
  it("merges unsaved edits here with theirs", () => {
    const mine = withText(base.content, "a2", "Mine");
    const p = planTailoredRefresh(base, mine, { content: theirs, updatedAt: "t2" });
    expect(p.kind).toBe("merge");
    expect([textOf((p as { content: Resume }).content, "a1"), textOf((p as { content: Resume }).content, "a2")]).toEqual(["Theirs", "Mine"]);
  });
  it("reports a conflict when both changed the same paragraph", () => {
    const mine = withText(base.content, "a1", "Mine");
    expect(planTailoredRefresh(base, mine, { content: theirs, updatedAt: "t2" }).kind).toBe("conflict");
  });
});

// ---------- save as master ----------

describe("planSaveAsMaster", () => {
  const m1 = master1();
  const copy0 = () => cloneForJob(m1);

  it("applies the copy's rewording and keeps a bullet added to the master later", () => {
    const copy = withText(copy0(), "a1", "Built a Tableau dashboard for 40 users");
    const m2 = insertAfter(m1, "a3", [B("a4", "Mentored 2 interns")]);
    const plan = planSaveAsMaster(copy, m2);
    expect(textOf(plan.merged, "a1")).toBe("Built a Tableau dashboard for 40 users");
    expect(textOf(plan.merged, "a4")).toBe("Mentored 2 interns");
    expect(plan).toMatchObject({ edited: 1, added: 0, kept: 1, removals: [], conflicts: [] });
  });

  it("keeps master rewordings the copy didn't touch", () => {
    const copy = withText(copy0(), "a1", "Copy A");
    const m2 = withText(m1, "a2", "Wrote 120 unit tests");
    const merged = planSaveAsMaster(copy, m2).merged;
    expect([textOf(merged, "a1"), textOf(merged, "a2")]).toEqual(["Copy A", "Wrote 120 unit tests"]);
  });

  it("places lines added in the copy and in the master next to their neighbours", () => {
    const copy = insertAfter(insertAfter(copy0(), "a1", [B("cN", "Copy-only bullet")]), "b1", [L("gam", "Gamma\tDenver"), B("gB", "Gamma bullet")]);
    const m2 = insertAfter(m1, "acme-sub", [B("a0", "Master-first bullet")]);
    const plan = planSaveAsMaster(copy, m2);
    expect(ids(plan.merged)).toEqual([
      "ann", "contact", "h-exp", "acme", "acme-sub", "a0", "a1", "cN", "a2", "a3", "beta", "b1", "gam", "gB", "h-edu", "uni", "g1",
    ]);
    expect(plan).toMatchObject({ added: 3, edited: 0, removals: [] });
  });

  it("never deletes master content: lines the copy deleted are offered as removals, unticked", () => {
    const copy = withoutIds(copy0(), ["a3", "beta", "b1"]);
    const plan = planSaveAsMaster(copy, m1);
    expect(plan.removals).toEqual([
      { kind: "bullet", id: "a3", ids: ["a3"], label: "Fixed bugs", where: "EXPERIENCE" },
      { kind: "item", id: "beta", ids: ["beta", "b1"], label: "Beta — Boston", where: "EXPERIENCE" },
    ]);
    expect(lines(plan.merged)).toEqual(lines(m1));
  });

  it("removes the offered lines only when they are ticked", () => {
    const copy = withoutIds(copy0(), ["a3", "beta", "b1"]);
    expect(lines(applySaveAsMaster(copy, m1, new Set()))).toEqual(lines(m1));
    expect(ids(applySaveAsMaster(copy, m1, new Set(["a3"])))).toEqual(ids(m1).filter((id) => id !== "a3"));
    expect(ids(applySaveAsMaster(copy, m1, new Set(["beta"])))).toEqual(ids(m1).filter((id) => id !== "beta" && id !== "b1"));
  });

  it("carries a formatting-only change in the copy (its text is unchanged)", () => {
    const copy = mapPara(copy0(), "a2", (n) => paragraph(paragraphText(n), { attrs: { id: "a2" }, marks: [{ type: "bold" }] }));
    const plan = planSaveAsMaster(copy, m1);
    expect(plan.edited).toBe(1);
    expect(flattenDoc(resumeDoc(plan.merged)).find((p) => p.id === "a2")!.node.content?.[0]).toMatchObject({ marks: [{ type: "bold" }] });
  });

  it("returns the same master object when the copy adds nothing (so updateMaster skips the write)", () => {
    expect(applySaveAsMaster(copy0(), m1, new Set())).toBe(m1);
  });

  it("does not resurrect master content deleted after the copy was made, unless the copy edited it", () => {
    const copy = copy0();
    const m2 = withoutIds(m1, ["beta", "b1"]);
    expect(ids(planSaveAsMaster(copy, m2).merged)).not.toContain("beta");
    const plan = planSaveAsMaster(withText(copy, "b1", "Ran a 30-person study"), m2);
    expect(textOf(plan.merged, "b1")).toBe("Ran a 30-person study");
    expect(plan.conflicts).toHaveLength(1);
  });

  it("the copy's details the master doesn't change apply, and master edits elsewhere are kept", () => {
    const copy = withText(copy0(), "acme-sub", "Intern\t2024");
    const m2 = withText(m1, "ann", "Ann B. Lee");
    const plan = planSaveAsMaster(copy, m2);
    expect(textOf(plan.merged, "acme-sub")).toBe("Intern\t2024");
    expect(textOf(plan.merged, "ann")).toBe("Ann B. Lee");
  });

  it("both changed the same paragraph: the copy's wording wins and the conflict is reported", () => {
    const copy = withText(copy0(), "a1", "Copy");
    const m2 = withText(m1, "a1", "Master");
    const plan = planSaveAsMaster(copy, m2);
    expect(textOf(plan.merged, "a1")).toBe("Copy");
    expect(plan.conflicts).toEqual([{ where: 'Line "Copy"', local: "Copy", server: "Master" }]);
  });
});

describe("baseFromBaseline and removeIds", () => {
  it("baseFromBaseline rebuilds the master as the copy saw it, with the baseline's wording", () => {
    const m1 = master1();
    const copy = withText(cloneForJob(m1), "a1", "Edited in copy");
    const m2 = withText(m1, "a1", "Master moved on");
    expect(lines(baseFromBaseline(cloneForJob(m1), m1))).toEqual(lines(m1));
    expect(textOf(baseFromBaseline(copy, m2), "a1")).toBe("Built a dashboard");
  });

  it("removeIds drops paragraphs by id, leaving lists that still have items", () => {
    const r = removeIds(master1(), new Set(["beta", "b1", "a2"]));
    expect(ids(r)).toEqual(["ann", "contact", "h-exp", "acme", "acme-sub", "a1", "a3", "h-edu", "uni", "g1"]);
  });
});

describe("baselineAfterMasterSave", () => {
  const m1 = master1();

  it("nothing reads as changed afterwards, but master-only additions are still left out of the baseline", () => {
    const copy = withText(cloneForJob(m1), "a1", "Copy A");
    const m2 = insertAfter(m1, "a3", [B("a4", "Mentored 2 interns")]);
    const newMaster = applySaveAsMaster(copy, m2, new Set());
    const baseline = baselineAfterMasterSave(copy, newMaster);
    for (const p of flattenDoc(resumeDoc(copy))) if (p.id in baseline) expect(baseline[p.id]).toBe(p.text);
    expect(baseline).not.toHaveProperty("a4");
  });

  it("a master rewording this copy never touched keeps the old wording in the baseline (so Pull offers it)", () => {
    const copy = cloneForJob(m1);
    const m2 = withText(m1, "a2", "Wrote 120 unit tests");
    expect(baselineAfterMasterSave(copy, applySaveAsMaster(copy, m2, new Set()))["a2"]).toBe("Wrote tests");
  });

  it("a line the copy kept and the master removed keeps its old entry, so it is still listed", () => {
    const copy = cloneForJob(m1);
    const m2 = withoutIds(m1, ["a2"]);
    const baseline = baselineAfterMasterSave(copy, applySaveAsMaster(copy, m2, new Set()));
    expect(baseline["a2"]).toBe("Wrote tests");
  });

  it("content deleted in the copy and kept on the master stays in the baseline (not re-offered)", () => {
    const copy = withoutIds(cloneForJob(m1), ["a3"]);
    const newMaster = applySaveAsMaster(copy, m1, new Set());
    expect(baselineAfterMasterSave(copy, newMaster)).toHaveProperty("a3");
  });
});

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
    const out = await saveTailoredDocument(db.client, "r1", withText(base, "a1", "Mine"), { content: base, updatedAt: "t1" });
    expect(out).toMatchObject({ kind: "saved", merged: false });
    expect(textOf(tailoredFromRow(db.row.content), "a1")).toBe("Mine");
  });

  it("a stale tab merges with the other device's save instead of overwriting it", async () => {
    const base = cloneForJob(master1());
    const db = fakeDb("resumes", { id: "r1", content: clone(base), updated_at: "t1" });
    db.other({ content: withText(base, "a1", "Phone A") });
    const laptop = withText(base, "a2", "Laptop B");
    const out = await saveTailoredDocument(db.client, "r1", laptop, { content: base, updatedAt: "t1" });
    expect(out).toMatchObject({ kind: "saved", merged: true });
    expect([textOf(tailoredFromRow(db.row.content), "a1"), textOf(tailoredFromRow(db.row.content), "a2")]).toEqual(["Phone A", "Laptop B"]);
  });

  it("stops without writing on a same-paragraph conflict", async () => {
    const base = cloneForJob(master1());
    const db = fakeDb("resumes", { id: "r1", content: clone(base), updated_at: "t1" });
    const phone = withText(base, "a1", "Phone");
    db.other({ content: phone });
    const out = await saveTailoredDocument(db.client, "r1", withText(base, "a1", "Laptop"), { content: base, updatedAt: "t1" });
    expect(out.kind).toBe("conflict");
    expect(db.row.content).toEqual(phone);
    expect(db.calls.map((c) => c.op)).toEqual(["update", "select"]);
  });

  it("retries when another save lands between the re-read and the merged write", async () => {
    const base = cloneForJob(master1());
    const db = fakeDb("resumes", { id: "r1", content: clone(base), updated_at: "t1" });
    db.other({ content: withText(base, "a1", "Phone A") });
    db.hooks.push(
      () => {},
      () => db.other({ content: withText(tailoredFromRow(db.row.content), "g1", "GPA 4.0") }),
    );
    const laptop = withText(base, "a2", "Laptop B");
    const out = await saveTailoredDocument(db.client, "r1", laptop, { content: base, updatedAt: "t1" });
    expect(out.kind).toBe("saved");
    const stored = tailoredFromRow(db.row.content);
    expect([textOf(stored, "a1"), textOf(stored, "a2"), textOf(stored, "g1")]).toEqual(["Phone A", "Laptop B", "GPA 4.0"]);
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
