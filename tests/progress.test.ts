import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Analysis, Job } from "@/lib/types";
import { inProgress, jobProgress, progressFields, sortInProgress } from "@/lib/progress";
import { JOB_FIELDS, diffFields } from "@/lib/tailor";
import { OPTIONAL_JOB_COLUMNS } from "@/lib/db";

const analysis = (rewrites: string[]): Analysis => ({
  fit: "possible", verdict: "", keywords: { matched: [], missing: [] }, strengths: [], gaps: [], questions: [],
  bullets: rewrites.map((rewrite, i) => ({ bullet_id: `b${i}`, rating: rewrite ? "weak" : "strong", note: "", rewrite })),
});

type P = Pick<Job, "id" | "status" | "submitted_at" | "deadline" | "updated_at" | "analysis" | "suggestions_total" | "suggestions_pending">;
const job = (id: string, over: Partial<P> = {}): P => ({
  id, status: "to_apply", submitted_at: null, deadline: null, updated_at: "2026-11-01", analysis: null,
  suggestions_total: null, suggestions_pending: null, ...over,
});

describe("progress", () => {
  it("total = rewrites in the latest analysis; pending as the page counts it (capped)", () => {
    expect(progressFields(null, 3)).toEqual({ suggestions_total: null, suggestions_pending: null });
    expect(progressFields(analysis(["a", "", "b", " "]), 1)).toEqual({ suggestions_total: 2, suggestions_pending: 1 });
    expect(progressFields(analysis(["a"]), 5)).toEqual({ suggestions_total: 1, suggestions_pending: 1 });
  });

  it("reviewed = total - pending; not analyzed and not-yet-stored are told apart", () => {
    expect(jobProgress(job("a"))).toEqual({ kind: "not-analyzed" });
    expect(jobProgress(job("a", { analysis: analysis(["x", "y"]) }))).toEqual({ kind: "unknown", total: 2 });
    expect(jobProgress(job("a", { analysis: analysis(["x", "y", "z", "w"]), suggestions_total: 4, suggestions_pending: 1 }))).toEqual({
      kind: "known", total: 4, reviewed: 3, pct: 75,
    });
    expect(jobProgress(job("a", { analysis: analysis([]), suggestions_total: 0, suggestions_pending: 0 }))).toMatchObject({ pct: 100 });
  });

  it("in progress = still To apply and not submitted", () => {
    const list = [job("a"), job("b", { status: "skipped" }), job("c", { status: "applied" }), job("d", { submitted_at: "2026-11-01" })];
    expect(inProgress(list).map((j) => j.id)).toEqual(["a"]);
  });

  it("sorts by deadline (none last), closest to completion (not analyzed last), or recently updated", () => {
    const a = analysis(["x", "y"]);
    const list = [
      job("none", { updated_at: "2026-11-05" }),
      job("late", { deadline: "2026-12-20", analysis: a, suggestions_total: 2, suggestions_pending: 0, updated_at: "2026-11-01" }),
      job("soon", { deadline: "2026-11-20", analysis: a, suggestions_total: 2, suggestions_pending: 2, updated_at: "2026-11-02" }),
      job("half", { analysis: a, suggestions_total: 2, suggestions_pending: 1, updated_at: "2026-11-03" }),
      job("unknown", { analysis: a, updated_at: "2026-11-04" }),
    ];
    expect(sortInProgress(list, "deadline").map((j) => j.id)).toEqual(["soon", "late", "none", "unknown", "half"]);
    expect(sortInProgress(list, "completion").map((j) => j.id)).toEqual(["late", "half", "soon", "unknown", "none"]);
    expect(sortInProgress(list, "updated").map((j) => j.id)).toEqual(["none", "unknown", "half", "soon", "late"]);
  });

  it("saved with the job's other fields (conditional writes; dropped without migration 0006)", () => {
    expect(JOB_FIELDS).toEqual(expect.arrayContaining(["suggestions_total", "suggestions_pending"]));
    expect(OPTIONAL_JOB_COLUMNS).toEqual(expect.arrayContaining(["suggestions_total", "suggestions_pending"]));
    const base = { suggestions_total: null, suggestions_pending: null } as unknown as Job;
    expect(diffFields(base, { ...base, suggestions_total: 3, suggestions_pending: 2 }, JOB_FIELDS)).toEqual({ suggestions_total: 3, suggestions_pending: 2 });
    const sql = readFileSync("supabase/migrations/0006_progress.sql", "utf8");
    expect(sql).toMatch(/add column if not exists suggestions_total int/);
    expect(sql).toMatch(/add column if not exists suggestions_pending int/);
  });
});
