"use client";

import { useEffect, useState } from "react";
import { API_CALLED_EVENT, getApi } from "@/lib/api";
import { MIGRATION_HINT } from "@/lib/db";

type Bucket = { used: number; limit: number; remaining: number; resetAt: string | null };
export type Usage = { available: true; heavy: Bucket; light: Bucket } | { available: false };

/** "7 of 10 analyses left today" (rolling 24 hours). */
export const heavyLine = (b: Bucket) =>
  `${b.remaining} of ${b.limit} ${b.limit === 1 ? "analysis" : "analyses"} left today`;

/** Time of day a limit frees up, in the viewer's time zone ("3:40 PM"). */
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The student's AI usage, refreshed on focus and after every API call. */
function useUsage(): Usage | null {
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      if (timer) clearTimeout(timer);
      // A moment after the call, so the finished row is counted.
      timer = setTimeout(async () => {
        const { data } = await getApi<Usage>("/api/usage");
        if (alive && data) setUsage(data);
      }, 300);
    };
    load();
    window.addEventListener(API_CALLED_EVENT, load);
    window.addEventListener("focus", load);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener(API_CALLED_EVENT, load);
      window.removeEventListener("focus", load);
    };
  }, []);
  return usage;
}

/** Compact meter for the sidebar footer. Renders nothing until loaded or without migration 0004. */
export function UsageMeter() {
  const usage = useUsage();
  if (!usage?.available) return null;
  const { heavy } = usage;
  const pct = heavy.limit ? Math.round((heavy.remaining / heavy.limit) * 100) : 0;
  return (
    <div className="space-y-1" title="Job analyses, resume imports and resume drafts. Rolling 24 hours.">
      <p className={`text-xs ${heavy.remaining ? "text-muted" : "text-bad"}`}>{heavyLine(heavy)}</p>
      <div
        className="h-1.5 rounded-full bg-border overflow-hidden"
        role="meter"
        aria-label="Analyses left today"
        aria-valuemin={0}
        aria-valuemax={heavy.limit}
        aria-valuenow={heavy.remaining}
      >
        <div className={`h-full rounded-full ${heavy.remaining ? "bg-accent" : "bg-bad"}`} style={{ width: `${pct}%` }} />
      </div>
      {!heavy.remaining && heavy.resetAt && <p className="text-xs text-muted">Next one at {clock(heavy.resetAt)}</p>}
    </div>
  );
}

/** The Account page's card: both limits, in plain words. */
export function UsageCard() {
  const usage = useUsage();
  return (
    <section className="card p-4 space-y-2" aria-labelledby="usage-heading">
      <h2 id="usage-heading" className="font-semibold">AI usage</h2>
      {!usage ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !usage.available ? (
        <p className="text-sm text-muted">{MIGRATION_HINT} Until then there are no AI limits.</p>
      ) : (
        <>
          <p className="text-sm">
            <strong>{heavyLine(usage.heavy)}</strong>
            {!usage.heavy.remaining && usage.heavy.resetAt && <> · next one at {clock(usage.heavy.resetAt)}</>}
          </p>
          <p className="text-xs text-muted">
            Job analyses, re-analyses, resume imports and resume drafts count toward this, over a rolling 24 hours.
          </p>
          <p className="text-sm">
            {usage.light.remaining} of {usage.light.limit} quick AI actions left this hour
            {!usage.light.remaining && usage.light.resetAt && <> · more at {clock(usage.light.resetAt)}</>}
          </p>
          <p className="text-xs text-muted">Coaching, cover letters and reading job details, over a rolling 60 minutes.</p>
        </>
      )}
    </section>
  );
}
