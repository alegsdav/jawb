"use client";

import type { Job } from "@/lib/types";
import { Toggle } from "../DocToolbar";
import { formatSubmitted } from "../SubmittedView";

/**
 * After applying: "You applied on Nov 13. Edits here don't change what you sent." with View what you
 * sent, follow-up, status and "Keep editing (for a re-apply)". Once the job moves back out of a sent
 * status, a one-line "Applied Nov 13 · View what you sent". Nothing when it was never submitted.
 */
export function AppliedNotice({
  job, applied, followUp, statusSelect, reapply, onReapply, onViewSubmitted,
}: {
  job: Job;
  applied: boolean;
  followUp: React.ReactNode;
  statusSelect: React.ReactNode;
  reapply: boolean;
  onReapply: (v: boolean) => void;
  onViewSubmitted: () => void;
}) {
  return (
    <>
      {applied && job.submitted_at ? (
        <section
          aria-label="Application sent"
          className="rounded-lg border border-good/40 bg-good-bg px-3 py-2.5 text-sm space-y-2"
        >
          <p>
            <span className="text-good" aria-hidden>✓ </span>
            <strong>You applied on {formatSubmitted(job.submitted_at)}.</strong> Edits here don&apos;t change what you sent.
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {job.submitted_resume && (
              <button type="button" className="btn btn-sm btn-primary min-h-10 sm:min-h-0" onClick={onViewSubmitted}>
                View what you sent
              </button>
            )}
            {followUp}
            <label className="text-xs text-muted flex items-center gap-1.5">
              Status {statusSelect}
            </label>
            <span className="sm:ml-auto">
              <Toggle on={reapply} onChange={onReapply} label="Keep editing (for a re-apply)" />
            </span>
          </div>
        </section>
      ) : (
        job.submitted_at && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm sm:rounded-lg sm:border sm:border-border sm:bg-surface sm:px-3 sm:py-1.5">
            <span>
              <span className="text-good">✓</span> Applied {formatSubmitted(job.submitted_at)}
            </span>
            {job.submitted_resume && (
              <>
                <span className="text-muted" aria-hidden>·</span>
                <button type="button" className="text-accent underline underline-offset-2 sm:py-1" onClick={onViewSubmitted}>
                  View what you sent
                </button>
              </>
            )}
          </div>
        )
      )}
    </>
  );
}
