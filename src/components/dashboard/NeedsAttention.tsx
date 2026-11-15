"use client";

import Link from "next/link";
import type { Job } from "@/lib/types";
import { daysUntil, shortDate } from "@/lib/dates";

/**
 * The strip at the top of the dashboard: follow-ups that are due (with Followed up) and deadlines in
 * the next 7 days. Nothing when there's nothing to do.
 */
export function NeedsAttention({
  followUps, closing, today, onFollowedUp,
}: {
  followUps: Job[];
  closing: Job[];
  today: string;
  onFollowedUp: (j: Job) => void;
}) {
  if (!followUps.length && !closing.length) return null;
  const name = (j: Job) => [j.title || "Untitled role", j.company].filter(Boolean).join(" · ");
  const due = (d: string) => {
    const n = daysUntil(d, today);
    return n === 0 ? "due today" : n === 1 ? "due tomorrow" : `due ${shortDate(d)}`;
  };
  return (
    <section aria-labelledby="attention-heading" className="space-y-3">
      <h2 id="attention-heading" className="text-lg font-semibold">Needs attention</h2>
      <ul className="grid gap-x-10 gap-y-3 text-sm md:grid-cols-2">
        {followUps.map((j) => (
          <li key={`f${j.id}`} className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="inline-flex shrink-0 items-center gap-1.5 font-medium"><span aria-hidden className="h-2 w-2 rounded-full bg-[var(--dot-orange)]" />Follow up</span>
            <Link href={`/jobs/${j.id}`} className="text-muted hover:text-fg truncate min-w-0">{name(j)}</Link>
            <button
              type="button"
              className="btn btn-sm min-h-9 sm:min-h-0"
              onClick={() => onFollowedUp(j)}
              title="Mark the follow-up done; the next one is due in 7 days"
            >
              ✓ Followed up
            </button>
          </li>
        ))}
        {closing.map((j) => (
          <li key={`d${j.id}`} className="flex items-center gap-2 min-w-0">
            <span className="inline-flex shrink-0 items-center gap-1.5 font-medium"><span aria-hidden className="h-2 w-2 rounded-full bg-[var(--dot-red)]" />Deadline</span>
            <Link href={`/jobs/${j.id}`} className="text-muted hover:text-fg truncate min-w-0">{name(j)}</Link>
            <span className="text-xs text-muted shrink-0">{due(j.deadline!)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
