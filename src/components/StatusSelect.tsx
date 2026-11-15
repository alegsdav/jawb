"use client";

import { STATUSES, type Fit, type JobStatus } from "@/lib/types";
import { FIT_LABEL } from "@/lib/fit";

const COLORS: Record<JobStatus, string> = {
  to_apply: "",
  applied: "text-accent",
  interview: "text-good",
  offer: "text-good font-semibold",
  rejected: "text-bad",
  skipped: "text-muted",
};

const DOT: Record<JobStatus, string> = {
  to_apply: "var(--muted)",
  applied: "var(--tint-blue-fg)",
  interview: "var(--good)",
  offer: "var(--good)",
  rejected: "var(--bad)",
  skipped: "var(--border)",
};

/** Status as a pill: a coloured dot and the label, still a native select underneath. */
export function StatusSelect({ value, onChange }: { value: JobStatus; onChange: (s: JobStatus) => void }) {
  return (
    <span className="relative inline-flex items-center">
      <span aria-hidden className="pointer-events-none absolute left-3 h-2 w-2 rounded-full" style={{ background: DOT[value] }} />
      <select
        aria-label="Status"
        className={`input rounded-full py-1 pl-7 pr-2 text-xs font-medium ${COLORS[value]}`}
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
const FIT_CLS: Record<Fit, string> = {
  strong: "text-good bg-good-bg border-transparent",
  possible: "text-ok bg-ok-bg border-transparent",
  stretch: "text-muted bg-surface-2 border-border",
};

/** Coarse fit bucket as a colored chip. Never shows a number. */
export function FitBadge({ fit }: { fit: Fit }) {
  return <span className={`chip shrink-0 whitespace-nowrap font-medium ${FIT_CLS[fit]}`}>{FIT_LABEL[fit]}</span>;
}
