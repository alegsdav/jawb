"use client";

import Link from "next/link";
import type { Job } from "@/lib/types";
import { daysUntil, shortDate } from "@/lib/dates";
import { ClockIcon, CalendarIcon } from "../icons";
import { Panel, PanelHeader, Pill } from "./ui";

/**
 * The dashboard's "Needs attention" panel: follow-ups that are due (with Followed up) and deadlines in
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
  const title = (j: Job) => j.title || "Untitled role";
  const due = (d: string) => {
    const n = daysUntil(d, today);
    return n === 0 ? "Due today" : n === 1 ? "Due tomorrow" : `Due ${shortDate(d)}`;
  };
  const count = followUps.length + closing.length;
  // Phones: the title takes the full width beside the icon, and the pill and button wrap under it (ml-11 = icon + gap).
  const rowCls = "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2/60 motion-reduce:transition-none sm:flex-nowrap";
  const titleCls = "min-w-0 grow basis-[calc(100%-3rem)] rounded-md sm:basis-auto";
  const actionsCls = "ml-11 flex shrink-0 items-center gap-2 sm:ml-0 sm:gap-3";
  return (
    <Panel aria-labelledby="attention-heading" className="space-y-3">
      <PanelHeader
        icon={<ClockIcon />}
        tint="orange"
        title="Needs attention"
        id="attention-heading"
        count={count}
      />
      <ul className="-mx-2 space-y-0.5 text-[13px]">
        {followUps.map((j) => (
          <li key={`f${j.id}`} className={rowCls}>
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-tint-orange text-tint-orange-fg">
              <ClockIcon className="h-4 w-4" />
            </span>
            <Link href={`/jobs/${j.id}`} className={titleCls}>
              <span className="block truncate font-medium">{title(j)}</span>
              <span className="block truncate text-[12px] text-muted">{j.company}</span>
            </Link>
            <div className={actionsCls}>
              <Pill tint="orange">Follow up due</Pill>
              <button
                type="button"
                className="btn btn-sm min-h-9 shrink-0 sm:min-h-0 whitespace-nowrap"
                onClick={() => onFollowedUp(j)}
                title="Mark the follow-up done; the next one is due in 7 days"
              >
                ✓ Followed up
              </button>
            </div>
          </li>
        ))}
        {closing.map((j) => (
          <li key={`d${j.id}`} className={rowCls}>
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-tint-red text-tint-red-fg">
              <CalendarIcon className="h-4 w-4" />
            </span>
            <Link href={`/jobs/${j.id}`} className={titleCls}>
              <span className="block truncate font-medium">{title(j)}</span>
              <span className="block truncate text-[12px] text-muted">{j.company}</span>
            </Link>
            <div className={actionsCls}>
              <Pill tint="red">{due(j.deadline!)}</Pill>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
