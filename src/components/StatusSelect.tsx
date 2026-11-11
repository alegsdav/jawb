"use client";

import { STATUSES, type JobStatus } from "@/lib/types";

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

/** Applying sets today's date and a follow-up 10 days out. */
export function applyDates() {
  const now = new Date();
  const follow = new Date(now.getTime() + 10 * 86400000);
  return { date_applied: now.toISOString().slice(0, 10), follow_up_date: follow.toISOString().slice(0, 10) };
}

export function FitBadge({ score }: { score: number }) {
  const cls = score >= 75 ? "text-good bg-good-bg" : score >= 50 ? "text-ok bg-ok-bg" : "text-bad bg-bad-bg";
  return <span className={`chip border-0 font-semibold ${cls}`}>{score}</span>;
}
