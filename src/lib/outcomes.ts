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

/** Fields to store on a job when it's marked Applied: a frozen copy of exactly what was sent. */
export function snapshotPatch(resume: Resume, master: Resume | null) {
  const { facts: _facts, ...sent } = resume; // facts are never sent to employers
  void _facts;
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
const REACHED_INTERVIEW = new Set(["interview", "offer"]);

/** Interview rate for tailored vs untailored applications (only jobs with a submitted snapshot count). */
export function tailoringStats(jobs: Pick<Job, "status" | "submitted_at" | "submitted_tailored">[]) {
  const out: { tailored: Counts; untailored: Counts } = {
    tailored: { applied: 0, interviews: 0 },
    untailored: { applied: 0, interviews: 0 },
  };
  for (const j of jobs) {
    if (!j.submitted_at || !SUBMITTED_STATUSES.has(j.status)) continue;
    const bucket = j.submitted_tailored ? out.tailored : out.untailored;
    bucket.applied++;
    if (REACHED_INTERVIEW.has(j.status)) bucket.interviews++;
  }
  return out;
}
