"use client";

import { STATUSES, type Fit, type JobStatus } from "@/lib/types";
import { FIT_LABEL } from "@/lib/fit";

// Kept for the job page's `import { applyDates } from "@/components/StatusSelect"`; new code imports @/lib/dates.
export { applyDates } from "@/lib/dates";

const COLORS: Record<JobStatus, string> = {
  to_apply: "",
  applied: "text-accent",
  interview: "text-good",
  offer: "text-good font-semibold",
  rejected: "text-bad",
  skipped: "text-muted",
};

export function StatusSelect({ value, onChange }: { value: JobStatus; onChange: (s: JobStatus) => void }) {
  return (
    <select
      aria-label="Status"
      className={`input py-1 text-xs ${COLORS[value]}`}
      value={value}
      onChange={(e) => onChange(e.target.value as JobStatus)}
    >
      {STATUSES.map((s) => (
        <option key={s.value} value={s.value}>{s.label}</option>
      ))}
    </select>
  );
}

const FIT_CLS: Record<Fit, string> = {
  strong: "text-good bg-good-bg border-good/30",
  possible: "text-ok bg-ok-bg border-ok/30",
  stretch: "text-muted bg-bg border-border",
};

/** Coarse fit bucket as a colored chip. Never shows a number. */
export function FitBadge({ fit }: { fit: Fit }) {
  return <span className={`chip shrink-0 whitespace-nowrap font-medium ${FIT_CLS[fit]}`}>{FIT_LABEL[fit]}</span>;
}
