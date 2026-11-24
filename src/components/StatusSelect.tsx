"use client";

import { STATUSES, type Fit, type JobStatus } from "@/lib/types";
import { FIT_LABEL } from "@/lib/fit";
import { ChevronDownIcon } from "@/components/icons";

/** Dot colour per status (the only colour a status gets). */
export const STATUS_DOT: Record<JobStatus, string> = {
  to_apply: "var(--dot-grey)",
  applied: "var(--dot-blue)",
  interview: "var(--dot-orange)",
  offer: "var(--dot-green)",
  rejected: "var(--dot-red)",
  skipped: "var(--dot-grey)",
};

/**
 * Status as a dot and a label, still a native select underneath.
 * `form`: fills its parent and matches the job page's date fields (h-8, bordered, 13px). The dashboard table keeps the default.
 */
export function StatusSelect({ value, onChange, form = false }: { value: JobStatus; onChange: (s: JobStatus) => void; form?: boolean }) {
  return (
    <span className={`relative inline-flex items-center ${form ? "h-full w-full" : ""}`}>
      <span aria-hidden className="pointer-events-none absolute left-2.5 h-2 w-2 rounded-full" style={{ background: STATUS_DOT[value] }} />
      <select
        aria-label="Status"
        className={
          form
            ? "ghost-input h-full w-full border-border pl-6 pr-1 text-[13px] font-medium"
            : "input appearance-none cursor-pointer rounded-full border-transparent bg-surface-2 py-1 pl-6 pr-6 text-xs font-medium hover:bg-surface-2/80 motion-reduce:transition-none"
        }
        value={value}
        onChange={(e) => onChange(e.target.value as JobStatus)}
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      {!form && <ChevronDownIcon className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted" />}
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
