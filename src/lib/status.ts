import type { Job, JobStatus, Resume } from "./types";
import { applyDates } from "./dates";
import { countPlaceholders } from "./facts";
import { INTERVIEW_STATUSES, shouldOfferUnsubmit, shouldSnapshot, snapshotPatch, unsubmitPatch } from "./outcomes";

export const UNSUBMIT_QUESTION = "Clear the submitted copy and applied date?";

/** The question asked before a copy with `n` [placeholders] is frozen as "what you sent". */
export const placeholderQuestion = (n: number) =>
  `This tailored copy still has ${n} [bracketed] placeholder${n === 1 ? "" : "s"}. ` +
  `${n === 1 ? "It" : "They"}'ll be frozen into the version you sent. Mark it anyway?`;

/** Every visible text field of a resume (what an employer sees; never facts or baseline). */
export function visibleTexts(r: Resume): string[] {
  return [
    r.header.name,
    r.header.contact,
    ...r.sections.flatMap((s) => [
      s.title,
      ...s.items.flatMap((it) => [it.title, it.subtitle, it.location, it.dates, ...it.bullets.map((b) => b.text)]),
    ]),
  ];
}

/**
 * @deprecated Use applyStatusChange (it also freezes the snapshot and sets `reached_interview`).
 * Dates and unsubmit fields for a status change, without the snapshot.
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

export type StatusChangeInput = {
  job: Pick<Job, "status" | "submitted_at" | "date_applied" | "reached_interview">;
  next: JobStatus;
  /** What would be sent if this freezes a snapshot: the on-screen tailored copy, else the saved copy, else the master. */
  sentResume: Resume | null;
  master: Resume | null;
  /** Ask the user; return false to cancel. Used for the placeholder warning and the unsubmit question. */
  confirm: (message: string) => boolean | Promise<boolean>;
  /** For tests: the moment of the change (applied date = its local day). */
  now?: Date;
};

/**
 * The ONE way any page changes a job's status. Returns the full patch to write, or null if the user
 * cancelled.
 *
 * - Into a sent status (Applied/Interview/Offer/Rejected) with no snapshot yet (`submitted_at` empty):
 *   if the copy to freeze (`sentResume`, else `master`) has [placeholders], asks
 *   placeholderQuestion(n) first and returns null on no. Then adds snapshotPatch(sentResume ?? master,
 *   master) (facts and baseline stripped) when there is a copy, and today's applied date plus a
 *   follow-up when `date_applied` is empty.
 * - Back to To apply/Skipped after a submission: asks UNSUBMIT_QUESTION; yes adds unsubmitPatch(),
 *   no changes only the status.
 * - Into Interview or Offer: `reached_interview: true`. It's never set back to false.
 */
export async function applyStatusChange(input: StatusChangeInput): Promise<Partial<Job> | null> {
  const { job, next, sentResume, master, confirm, now = new Date() } = input;
  const patch: Partial<Job> = { status: next };

  if (shouldSnapshot(next, job.submitted_at)) {
    const sent = sentResume ?? master;
    if (sent) {
      const n = countPlaceholders(visibleTexts(sent));
      if (n > 0 && !(await confirm(placeholderQuestion(n)))) return null;
      Object.assign(patch, snapshotPatch(sent, master));
    }
    if (!job.date_applied) Object.assign(patch, applyDates(now));
  } else if (shouldOfferUnsubmit(next, job.submitted_at)) {
    if (await confirm(UNSUBMIT_QUESTION)) Object.assign(patch, unsubmitPatch());
  }

  if (INTERVIEW_STATUSES.has(next)) patch.reached_interview = true;
  return patch;
}
