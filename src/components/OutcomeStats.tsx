"use client";

import { tailoringStats, type StatsJob } from "@/lib/outcomes";

type Counts = { applied: number; interviews: number };

/** Below this many applications in a bucket a percentage is noise, so only counts are shown. */
export const MIN_TO_COMPARE = 5;

function Bucket({ label, c }: { label: string; c: Counts }) {
  if (c.applied >= MIN_TO_COMPARE) {
    return (
      <span>
        {label} <strong>{Math.round((c.interviews / c.applied) * 100)}%</strong>{" "}
        <span className="text-muted">({c.interviews}/{c.applied})</span>
      </span>
    );
  }
  return (
    <span>
      {label} {c.interviews}/{c.applied}
    </span>
  );
}

/** Small "does tailoring help?" card. Renders nothing until at least one application has a saved snapshot. */
export function OutcomeStats({ jobs }: { jobs: StatsJob[] }) {
  if (!jobs.some((j) => j.submitted_at)) return null;
  const s = tailoringStats(jobs);
  const tooFew = s.tailored.applied < MIN_TO_COMPARE || s.untailored.applied < MIN_TO_COMPARE;
  return (
    <details className="card px-3 py-2 text-sm group">
      <summary className="flex flex-wrap items-baseline gap-x-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <span className="font-medium">Interviews</span>
        <span className="text-muted">·</span>
        <Bucket label="Tailored" c={s.tailored} />
        <span className="text-muted">·</span>
        <Bucket label="Not tailored" c={s.untailored} />
        {tooFew && <span className="text-xs text-muted">(too few to compare yet)</span>}
        <span className="ml-auto text-xs text-muted group-open:hidden" aria-hidden>ⓘ</span>
      </summary>
      <p className="mt-1 text-xs text-muted">
        Counts every job you&apos;ve marked Applied or later (a copy of the resume you sent is saved then). Tailored = that
        copy differed from your master resume. A job that reached Interview or Offer at any point counts as a yes, even if
        it later ended in Rejected. Percentages appear once a group has {MIN_TO_COMPARE} applications.
      </p>
    </details>
  );
}
