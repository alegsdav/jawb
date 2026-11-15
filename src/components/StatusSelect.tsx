"use client";

import { STATUSES, type Fit, type JobStatus } from "@/lib/types";
import { FIT_LABEL } from "@/lib/fit";

/** Dot colour per status (the only colour a status gets). */
export const STATUS_DOT: Record<JobStatus, string> = {
  to_apply: "var(--dot-grey)",
  applied: "var(--dot-blue)",
  interview: "var(--dot-orange)",
  offer: "var(--dot-green)",
  rejected: "var(--dot-red)",
  skipped: "var(--dot-grey)",
};

/** Status as a dot and a label, still a native select underneath. */
export function StatusSelect({ value, onChange }: { value: JobStatus; onChange: (s: JobStatus) => void }) {
  return (
    <span className="relative inline-flex items-center">
      <span aria-hidden className="pointer-events-none absolute left-2.5 h-2 w-2 rounded-full" style={{ background: STATUS_DOT[value] }} />
      <select
        aria-label="Status"
        className="input rounded-full border-transparent bg-transparent py-1 pl-6 pr-1 text-xs font-medium hover:bg-surface-2"
        value={value}
        onChange={(e) => onChange(e.target.value as JobStatus)}
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </span>
  );
}

const FIT_DOT: Record<Fit, string> = {
  strong: "var(--dot-green)",
  possible: "var(--dot-orange)",
  stretch: "var(--dot-grey)",
};

/** Coarse fit bucket: a dot and a word. Never shows a number. */
export function FitBadge({ fit }: { fit: Fit }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs font-medium">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: FIT_DOT[fit] }} />
      {FIT_LABEL[fit]}
    </span>
  );
}
