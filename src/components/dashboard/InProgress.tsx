"use client";

import Link from "next/link";
import type { Job } from "@/lib/types";
import { shortDate } from "@/lib/dates";
import { inProgress, jobProgress, sortInProgress } from "@/lib/progress";
import { fitOf } from "@/lib/fit";
import { PencilIcon, ChevronRightIcon } from "@/components/icons";
import { FitBadge } from "@/components/StatusSelect";
import { CompanyMark, Panel, PanelHeader, TINT } from "./ui";
import { deadlineUrgency } from "../DeadlineField";

/** How far the tailoring has come: a bar and "3/5 reviewed", or a short note when there's nothing to count yet. */
function ProgressBar({ job }: { job: Job }) {
  const p = jobProgress(job);
  if (p.kind === "not-analyzed") return <span className="text-xs text-muted">Not analyzed yet</span>;
  if (p.kind === "unknown") return <span className="text-xs text-muted">{p.total} to review</span>;
  return (
    <div className="flex w-full items-center gap-2.5">
      <div
        className="h-2 w-full min-w-16 rounded-full bg-surface-2 overflow-hidden"
        role="progressbar"
        aria-label="Suggestions reviewed"
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.reviewed}
      >
        <div className={`h-full rounded-full ${p.pct === 100 ? "bg-[var(--dot-green)]" : "bg-[var(--dot-blue)]"}`} style={{ width: `${p.pct}%` }} />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted">{p.reviewed}/{p.total} reviewed</span>
    </div>
  );
}

/**
 * Jobs not yet submitted, in deadline order, with how far the tailoring has come.
 * The whole row opens the job.
 */
export function InProgress({ jobs, today, loading }: { jobs: Job[]; today: string; loading: boolean }) {
  const list = sortInProgress(inProgress(jobs), "deadline");
  return (
    <Panel flush as="section" aria-labelledby="in-progress-heading" className="overflow-hidden">
      <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3">
        <PanelHeader icon={<PencilIcon />} tint="blue" title="In progress" id="in-progress-heading" count={list.length} />
      </div>
      {loading ? null : !list.length ? (
        <div className="flex flex-col items-center border-t border-border px-6 py-10 text-center">
          <span aria-hidden className={`mb-3 inline-grid h-10 w-10 place-items-center rounded-xl ${TINT.blue} [&_svg]:h-5 [&_svg]:w-5`}>
            <PencilIcon />
          </span>
          <p className="text-[14px] font-medium">Nothing in progress</p>
          <p className="mt-1 max-w-sm text-[13px] text-muted">Add a job to start tailoring your resume for it.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {list.map((j) => {
            const urgency = deadlineUrgency(j.deadline, j.status, today);
            const fit = fitOf(j.analysis);
            return (
              <li key={j.id}>
                <Link
                  href={`/jobs/${j.id}`}
                  className="group flex flex-wrap items-center gap-x-3 gap-y-2 px-4 sm:flex-nowrap sm:gap-4 sm:px-5 py-3 transition-colors hover:bg-surface-2/40 motion-reduce:transition-none"
                >
                  <CompanyMark name={j.company} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      {/* The title gives way first: the fit badge keeps its width. */}
                      <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{j.title || "Untitled role"}</span>
                      {fit && <FitBadge fit={fit} />}
                    </div>
                    <div className="truncate text-[13px] text-muted">
                      {j.company || "—"}
                      {j.deadline && (
                        <span className={urgency ? (urgency === "overdue" ? "text-bad" : "text-ok font-medium") : ""}>
                          {" · "}Deadline {shortDate(j.deadline)}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Phones: its own line under the role. Desktop: a fixed column on the right. */}
                  <div className="order-last w-full pl-12 sm:order-none sm:w-40 sm:shrink-0 sm:pl-0">
                    <ProgressBar job={j} />
                  </div>
                  <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted/60 transition-colors group-hover:text-fg motion-reduce:transition-none" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
