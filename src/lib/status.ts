import type { Job, JobStatus } from "./types";
import { applyDates } from "./dates";
import { shouldOfferUnsubmit, shouldSnapshot, unsubmitPatch } from "./outcomes";

export const UNSUBMIT_QUESTION = "Clear the submitted copy and applied date?";

/**
 * Fields to write when a job's status changes (the resume snapshot itself is added by the caller,
 * since it needs the tailored copy):
 * - first move into a sent status (Applied/Interview/Offer/Rejected): today's applied date and a
 *   follow-up, unless an applied date is already set;
 * - back to an unsent status (To apply/Skipped) after a submission: asks `confirmUnsubmit` and, on
 *   yes, clears the submitted copy, applied date and follow-up so the next Applied starts fresh.
 */
export function statusChangePatch(
  job: Pick<Job, "date_applied" | "submitted_at">,
  status: JobStatus,
  confirmUnsubmit: () => boolean,
  now = new Date(),
): Partial<Job> {
  if (shouldOfferUnsubmit(status, job.submitted_at)) {
    return confirmUnsubmit() ? { status, ...unsubmitPatch() } : { status };
  }
  if (shouldSnapshot(status, job.submitted_at) && !job.date_applied) return { status, ...applyDates(now) };
  return { status };
}
