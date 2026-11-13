import type { Job, Resume } from "./types";
import { resumeToPlainText } from "./resume";

/** True when the tailored resume's content differs from the master (ignores master-only facts). */
export function isTailored(resume: Resume, master: Resume | null): boolean {
  if (!master) return false;
  return resumeToPlainText(resume) !== resumeToPlainText(master);
}

/** Statuses that imply the application was sent. The first move into one of these freezes a snapshot. */
export const SUBMITTED_STATUSES = new Set(["applied", "interview", "offer", "rejected"]);

export const shouldSnapshot = (status: string, submittedAt: string | null | undefined) =>
  SUBMITTED_STATUSES.has(status) && !submittedAt;

/**
 * Fields to store on a job when it's marked Applied: a frozen copy of exactly what was sent. Master-only
 * `facts` (never sent to employers) and a tailored copy's `baseline` (bookkeeping) are stripped.
 */
export function snapshotPatch(resume: Resume, master: Resume | null) {
  const { facts: _facts, baseline: _baseline, ...sent } = resume;
  void _facts;
  void _baseline;
  return {
    submitted_resume: sent as Resume,
    submitted_at: new Date().toISOString(),
    submitted_tailored: isTailored(resume, master),
  };
}

/** Undo a submission (e.g. status set back to To apply after a mis-tap): forget the snapshot and dates. */
export function unsubmitPatch() {
  return { submitted_resume: null, submitted_at: null, submitted_tailored: null, date_applied: null, follow_up_date: null };
}

/** True when moving to this status should offer to clear an existing submission. */
export const shouldOfferUnsubmit = (status: string, submittedAt: string | null | undefined) =>
  !SUBMITTED_STATUSES.has(status) && !!submittedAt;

type Counts = { applied: number; interviews: number };
/** Statuses that mean the application reached the interview stage. */
export const INTERVIEW_STATUSES = new Set(["interview", "offer"]);

/**
 * Whether a job counts as "got an interview": it reached Interview or Offer at any point
 * (`reached_interview`, migration 0003, stays true after a later Rejected), or is in one of those
 * statuses now (so stats still work without migration 0003).
 */
export const reachedInterview = (j: Pick<Job, "status"> & Partial<Pick<Job, "reached_interview">>) =>
  !!j.reached_interview || INTERVIEW_STATUSES.has(j.status);

export type StatsJob = Pick<Job, "status" | "submitted_at" | "submitted_tailored"> & Partial<Pick<Job, "reached_interview">>;

/** Interview rate for tailored vs untailored applications (only jobs with a submitted snapshot count). */
export function tailoringStats(jobs: StatsJob[]) {
  const out: { tailored: Counts; untailored: Counts } = {
    tailored: { applied: 0, interviews: 0 },
    untailored: { applied: 0, interviews: 0 },
  };
  for (const j of jobs) {
    if (!j.submitted_at || !SUBMITTED_STATUSES.has(j.status)) continue;
    const bucket = j.submitted_tailored ? out.tailored : out.untailored;
    bucket.applied++;
    if (reachedInterview(j)) bucket.interviews++;
  }
  return out;
}
