"use client";

import type { Job } from "@/lib/types";
import { tailoringStats } from "@/lib/outcomes";

type Counts = { applied: number; interviews: number };
const rate = (c: Counts) => `${c.interviews}/${c.applied}${c.applied ? ` (${Math.round((c.interviews / c.applied) * 100)}%)` : ""}`;

/** Small "does tailoring help?" card. Renders nothing until at least one application has a saved snapshot. */
export function OutcomeStats({ jobs }: { jobs: Pick<Job, "status" | "submitted_at" | "submitted_tailored">[] }) {
  if (!jobs.some((j) => j.submitted_at)) return null;
  const s = tailoringStats(jobs);
  return (
    <div className="card px-3 py-2.5 text-sm space-y-0.5">
      <p className="flex flex-wrap gap-x-2">
        <strong>Interview rate</strong>
        <span className="text-muted">·</span>
        <span>Tailored {rate(s.tailored)}</span>
        <span className="text-muted">·</span>
        <span>Not tailored {rate(s.untailored)}</span>
      </p>
      <p className="text-xs text-muted">
        Counts jobs marked Applied here (a copy of the resume you sent is saved then). Tailored = it differed from your
        master; reaching Interview or Offer counts as a yes.
      </p>
    </div>
  );
}
