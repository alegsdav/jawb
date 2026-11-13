"use client";

import { daysUntil, localToday, shortDate } from "@/lib/dates";

// The date helpers live in @/lib/dates; re-exported so existing imports keep working.
export { daysUntil, localToday };

export type Urgency = "overdue" | "soon" | null;

/** Flag only jobs still to apply: overdue, or due within 3 days (today included). */
export function deadlineUrgency(deadline: string | null, status: string, today = localToday()): Urgency {
  if (!deadline || status !== "to_apply") return null;
  const d = daysUntil(deadline, today);
  return d < 0 ? "overdue" : d <= 3 ? "soon" : null;
}

/** "Closing soon" = still to apply, deadline today through 7 days out. */
export function isClosingSoon(deadline: string | null, status: string, today = localToday()) {
  if (!deadline || status !== "to_apply") return false;
  const d = daysUntil(deadline, today);
  return d >= 0 && d <= 7;
}

function flagText(deadline: string, today: string) {
  const d = daysUntil(deadline, today);
  if (d < 0) return d === -1 ? "Overdue · yesterday" : `Overdue · ${-d} days`;
  return d === 0 ? "Due today" : d === 1 ? "Due tomorrow" : `Due in ${d} days`;
}

/** Date input plus an "Overdue" / "Due in 2 days" flag when the deadline is close. */
export function DeadlineField({
  value, status, onChange, today = localToday(), compact = false,
}: {
  value: string | null;
  status: string;
  onChange: (v: string | null) => void;
  today?: string;
  /** Phone cards: label inline with the input, and read-only once the status is past To apply. */
  compact?: boolean;
}) {
  const urgency = deadlineUrgency(value, status, today);
  // Phones: once the job is past To apply the deadline no longer matters; show it read-only (if set).
  if (compact && status !== "to_apply") {
    return value ? <span className="text-xs text-muted">Deadline {shortDate(value)}</span> : null;
  }
  return (
    <div className={compact ? "flex flex-wrap items-center gap-x-2 gap-y-1" : "flex flex-col items-start gap-0.5"}>
      <label className="inline-flex items-center gap-1.5">
        {compact && <span className="text-xs text-muted">Deadline</span>}
        <input
          type="date"
          aria-label="Application deadline"
          className={`ghost-input text-xs ${compact ? "border-border" : ""} ${urgency === "overdue" ? "text-bad" : urgency === "soon" ? "text-ok" : ""}`}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      </label>
      {urgency && value && (
        <span
          className={`chip border-0 whitespace-nowrap font-semibold ${urgency === "overdue" ? "text-bad bg-bad-bg" : "text-ok bg-ok-bg"}`}
        >
          {flagText(value, today)}
        </span>
      )}
    </div>
  );
}
