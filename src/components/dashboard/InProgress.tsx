"use client";

import Link from "next/link";
import type { Job } from "@/lib/types";
import { shortDate } from "@/lib/dates";
import { inProgress, jobProgress, sortInProgress } from "@/lib/progress";
import { deadlineUrgency } from "../DeadlineField";
import { CompanyMark } from "../CompanyMark";

function ProgressBar({ job }: { job: Job }) {
  const p = jobProgress(job);
  if (p.kind === "not-analyzed") return <span className="text-xs text-muted">Not analyzed yet</span>;
  if (p.kind === "unknown") return <span className="text-xs text-muted">{p.total} to review</span>;
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-1.5 w-full rounded-full bg-surface-2 overflow-hidden"
        role="progressbar"
        aria-label="Suggestions reviewed"
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.reviewed}
      >
        <div className={`h-full rounded-full ${p.pct === 100 ? "bg-[var(--dot-green)]" : "bg-[var(--dot-blue)]"}`} style={{ width: `${p.pct}%` }} />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted">{p.reviewed}/{p.total}</span>
    </div>
  );
}

/** Jobs not yet submitted, in deadline order, with how far the tailoring has come. The whole row opens the job. */
export function InProgress({ jobs, today, loading }: { jobs: Job[]; today: string; loading: boolean }) {
  const list = sortInProgress(inProgress(jobs), "deadline");
  return (
    <section className="space-y-2" aria-labelledby="in-progress-heading">
      <div className="flex items-center gap-2">
        <h2 id="in-progress-heading" className="text-[15px] font-semibold">In progress</h2>
        <span className="text-xs font-medium text-muted">{list.length}</span>
      </div>
      {loading ? null : !list.length ? (
        <p className="text-[13px] text-muted">Nothing in progress. Add a job to start tailoring your resume for it.</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((j) => {
            const urgency = deadlineUrgency(j.deadline, j.status, today);
            return (
              <li key={j.id}>
                <Link
                  href={`/jobs/${j.id}`}
                  className="grid gap-2 py-2.5 hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center sm:gap-4 rounded-md"
                >
                  <div className="min-w-0 flex items-center gap-3">
                    <CompanyMark name={j.company} className="h-8 w-8 text-xs" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{j.title || "Untitled role"}</div>
                      <p className="text-[13px] text-muted truncate">
                        {j.company || "—"}
                        {j.deadline && (
                          <span className={urgency ? (urgency === "overdue" ? "text-bad" : "text-ok font-medium") : ""}>
                            {" · "}Deadline {shortDate(j.deadline)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <ProgressBar job={j} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
