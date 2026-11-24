"use client";

import { tailoringStats, type StatsJob } from "@/lib/outcomes";

type Counts = { applied: number; interviews: number };

/** Below this many applications in a bucket a percentage is noise, so only counts are shown. */
export const MIN_TO_COMPARE = 5;

/** How the numbers are counted, shown behind "How is this counted?". */
const HOW_COUNTED = `Counts every job you've marked Applied or later (a copy of the resume you sent is saved then). Tailored = that copy differed from your master resume. A job that reached Interview or Offer at any point counts as a yes, even if it later ended in Rejected. Percentages appear once a group has ${MIN_TO_COMPARE} applications.`;

/** One bucket as a tile: the interview rate as a big number once it can be compared, else the raw count. */
function Tile({ label, c }: { label: string; c: Counts }) {
  const comparable = c.applied >= MIN_TO_COMPARE;
  return (
    <div className="rounded-xl bg-surface-2/60 p-3">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
        {comparable ? `${Math.round((c.interviews / c.applied) * 100)}%` : `${c.interviews}/${c.applied}`}
      </p>
      <p className="text-[12px] text-muted">
        {comparable ? `${c.interviews} of ${c.applied} applied` : "interviews / applied"}
      </p>
    </div>
  );
}

/**
 * "Does tailoring help?": the tailored vs untailored interview rates as two tiles, with the rule for counting
 * behind a disclosure. Renders nothing until at least one application has a saved snapshot.
 */
export function TailoringOutcomes({ jobs }: { jobs: StatsJob[] }) {
  if (!jobs.some((j) => j.submitted_at)) return null;
  const s = tailoringStats(jobs);
  const tooFew = s.tailored.applied < MIN_TO_COMPARE || s.untailored.applied < MIN_TO_COMPARE;
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] font-medium">Does tailoring help?</p>
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Tailored" c={s.tailored} />
        <Tile label="Not tailored" c={s.untailored} />
      </div>
      {tooFew && <p className="text-xs text-muted">Too few to compare yet.</p>}
      <details className="group text-xs text-muted">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 hover:text-fg [&::-webkit-details-marker]:hidden">
          How is this counted?
          <span aria-hidden className="transition-transform group-open:rotate-180 motion-reduce:transition-none">▾</span>
        </summary>
        <p className="mt-1.5 leading-relaxed">{HOW_COUNTED}</p>
      </details>
    </div>
  );
}
