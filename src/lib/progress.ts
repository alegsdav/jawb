import type { Analysis, Job } from "./types";

/**
 * Tailoring progress for one job (migration 0006). total = suggested rewrites in the latest analysis;
 * reviewed = total minus the ones still pending (accepted, edited past, or rejected).
 */

/** Suggested rewrites in an analysis (bullets rated strong have none). */
export const countRewrites = (a: Analysis) => a.bullets.filter((b) => b.rewrite.trim()).length;

/**
 * The values the job page stores: null/null before any analysis; otherwise the rewrite count and how
 * many are still pending (never more than the total).
 */
export function progressFields(analysis: Analysis | null, pendingCount: number): Pick<Job, "suggestions_total" | "suggestions_pending"> {
  if (!analysis) return { suggestions_total: null, suggestions_pending: null };
  const total = countRewrites(analysis);
  return { suggestions_total: total, suggestions_pending: Math.min(total, Math.max(0, pendingCount)) };
}

export type Progress =
  | { kind: "not-analyzed" }
  /** Analyzed, but the page hasn't stored progress yet (or migration 0006 isn't run). */
  | { kind: "unknown"; total: number }
  | { kind: "known"; total: number; reviewed: number; pct: number };

/** What the dashboard shows for a job. */
export function jobProgress(j: Pick<Job, "analysis" | "suggestions_total" | "suggestions_pending">): Progress {
  if (!j.analysis) return { kind: "not-analyzed" };
  const total = j.suggestions_total;
  const pending = j.suggestions_pending;
  if (typeof total !== "number" || typeof pending !== "number") {
    const bullets = Array.isArray(j.analysis.bullets) ? j.analysis.bullets : [];
    return { kind: "unknown", total: bullets.filter((b) => typeof b?.rewrite === "string" && b.rewrite.trim()).length };
  }
  const reviewed = Math.max(0, total - Math.min(pending, total));
  return { kind: "known", total, reviewed, pct: total ? Math.round((reviewed / total) * 100) : 100 };
}

/** Jobs not yet submitted: still To apply (Skipped and anything sent are out). */
export const inProgress = <T extends Pick<Job, "status" | "submitted_at">>(jobs: T[]) =>
  jobs.filter((j) => j.status === "to_apply" && !j.submitted_at);

export type ProgressSort = "deadline" | "completion" | "updated";

/**
 * Sort the In progress list. deadline: soonest first, none last; completion: closest to done first
 * (not analyzed last); updated: most recently updated first. Ties: most recently updated first.
 */
export function sortInProgress<T extends Pick<Job, "deadline" | "updated_at" | "analysis" | "suggestions_total" | "suggestions_pending">>(
  jobs: T[],
  by: ProgressSort,
): T[] {
  const recent = (a: T, b: T) => b.updated_at.localeCompare(a.updated_at);
  const score = (j: T) => {
    const p = jobProgress(j);
    return p.kind === "known" ? p.pct : p.kind === "unknown" ? -1 : -2;
  };
  return [...jobs].sort((a, b) => {
    if (by === "deadline") {
      if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
      if (!!a.deadline !== !!b.deadline) return a.deadline ? -1 : 1;
      return recent(a, b);
    }
    if (by === "completion") return score(b) - score(a) || recent(a, b);
    return recent(a, b);
  });
}
