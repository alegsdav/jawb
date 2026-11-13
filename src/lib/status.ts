import type { Job, JobStatus, Resume } from "./types";
import { applyDates } from "./dates";
import { countPlaceholders, plural } from "./facts";
import { INTERVIEW_STATUSES, shouldOfferUnsubmit, shouldSnapshot, snapshotPatch, unsubmitPatch } from "./outcomes";

export const UNSUBMIT_QUESTION = "Clear the submitted copy and applied date?";

/** The question asked before a copy with `n` [placeholders] is frozen as "what you sent". */
export const placeholderQuestion = (n: number) =>
  `This tailored copy still has ${plural(n, "[bracketed] placeholder")}. ` +
  `${n === 1 ? "It" : "They"}'ll be frozen into the version you sent. Mark it anyway?`;

/**
 * Every visible text field of a resume (what an employer sees; never facts or baseline). The one
 * helper for this: pdfDownload's `resumeTexts` is the same function.
 */
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

// ---------- duplicate jobs ----------

/**
 * A job link reduced to what identifies the posting: no query string or #hash, no trailing slash,
 * lowercase scheme and host ("https://Boards.greenhouse.io/acme/jobs/1/?src=x" ->
 * "https://boards.greenhouse.io/acme/jobs/1"). "" for anything that isn't an http(s) link.
 */
export function normalizeJobUrl(url: string | null | undefined): string {
  const raw = (url ?? "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return "";
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return "";
  }
}

const normName = (t: string | null | undefined) => (t ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * An existing job that looks like the one being added: the same link (normalizeJobUrl) or the same
 * company and title (case/space-insensitive; both must be known). Null when there's none.
 */
export function findDuplicateJob<T extends Pick<Job, "url" | "company" | "title">>(
  jobs: readonly T[],
  candidate: Partial<Pick<Job, "url" | "company" | "title">>,
): T | null {
  const url = normalizeJobUrl(candidate.url);
  const company = normName(candidate.company);
  const title = normName(candidate.title);
  return (
    jobs.find(
      (j) =>
        (!!url && normalizeJobUrl(j.url) === url) ||
        (!!company && !!title && normName(j.company) === company && normName(j.title) === title),
    ) ?? null
  );
}
