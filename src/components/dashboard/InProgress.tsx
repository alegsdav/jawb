"use client";

import Link from "next/link";
import { useState } from "react";
import type { Job } from "@/lib/types";
import { fitOf } from "@/lib/fit";
import { shortDate } from "@/lib/dates";
import { inProgress, jobProgress, sortInProgress, type ProgressSort } from "@/lib/progress";
import { plural } from "@/lib/facts";
import { FitBadge } from "../StatusSelect";
import { deadlineUrgency } from "../DeadlineField";
import { CompanyMark } from "../CompanyMark";

const SORTS: { value: ProgressSort; label: string }[] = [
  { value: "deadline", label: "Deadline" },
  { value: "completion", label: "Closest to completion" },
  { value: "updated", label: "Recently updated" },
];

function ProgressBar({ job }: { job: Job }) {
  const p = jobProgress(job);
  if (p.kind === "not-analyzed") return <span className="text-xs text-muted">Not analyzed yet</span>;
  if (p.kind === "unknown") return <span className="text-xs text-muted">Analyzed · {plural(p.total, "suggestion")} to review</span>;
  return (
    <div className="space-y-1">
      <div
        className="h-2 w-full rounded-full bg-accent-soft overflow-hidden"
        role="progressbar"
        aria-label="Suggestions reviewed"
        aria-valuemin={0}
        aria-valuemax={p.total}
        aria-valuenow={p.reviewed}
      >
        <div className={`h-full rounded-full ${p.pct === 100 ? "bg-good" : "bg-accent"}`} style={{ width: `${p.pct}%` }} />
      </div>
      <p className="text-xs text-muted">
        {p.total ? `${p.reviewed} of ${plural(p.total, "suggestion")} reviewed` : "No suggested rewrites"}
      </p>
    </div>
  );
}

/** Jobs not yet submitted, with how far the tailoring has come and a way back in. */
export function InProgress({ jobs, today, loading }: { jobs: Job[]; today: string; loading: boolean }) {
  const [sort, setSort] = useState<ProgressSort>("deadline");
  const list = sortInProgress(inProgress(jobs), sort);
  return (
    <section className="rise card p-4 sm:p-5 space-y-3" aria-labelledby="in-progress-heading" style={{ ["--i" as string]: 2 }}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="in-progress-heading" className="text-lg font-bold tracking-tight">In progress</h2>
        <span className="chip bg-accent-soft border-transparent font-semibold text-accent">{list.length}</span>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          Sort
          <select className="input py-1 text-xs min-h-10 sm:min-h-0" value={sort} onChange={(e) => setSort(e.target.value as ProgressSort)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>
      {loading ? (
        <p role="status" className="text-sm text-muted">Loading…</p>
      ) : !list.length ? (
        <p className="text-sm text-muted">Nothing in progress. Add a job to start tailoring your resume for it.</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.map((j) => {
            const fit = fitOf(j.analysis);
            const urgency = deadlineUrgency(j.deadline, j.status, today);
            return (
              <li key={j.id} className="py-3.5 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-center">
                <div className="min-w-0 flex items-center gap-3">
                  <CompanyMark name={j.company} className="h-11 w-11" />
                  <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <Link href={`/jobs/${j.id}`} className="font-semibold truncate hover:text-accent">{j.title || "Untitled role"}</Link>
                    {fit && <FitBadge fit={fit} />}
                  </div>
                  <p className="text-sm text-muted truncate">
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
                <Link href={`/jobs/${j.id}`} className="btn btn-sm min-h-10 sm:min-h-0 justify-self-start sm:justify-self-end">
                  Continue<span className="sr-only">: {j.title || "Untitled role"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
