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

/** Quiet one-line meter for the sidebar footer: text and a thin bar, no card. Shows only when 2 or fewer analyses are left. Renders nothing until loaded or without migration 0004. */
export function UsageMeter() {
  const usage = useUsage();
  if (!usage?.available || usage.heavy.remaining > 2) return null;
  const { heavy } = usage;
  const pct = heavy.limit ? Math.round((heavy.remaining / heavy.limit) * 100) : 0;
  return (
    <div className="space-y-1.5 px-2 text-[13px]" title="Job analyses, resume imports and resume drafts. Rolling 24 hours.">
      <p className={heavy.remaining ? "text-muted" : "text-bad"}>
        {heavyLine(heavy)}
        {!heavy.remaining && heavy.resetAt && <> · next one at {clock(heavy.resetAt)}</>}
      </p>
      <div
        className="h-[3px] overflow-hidden rounded-full bg-fg/10"
        role="meter"
        aria-label="Analyses left today"
        aria-valuemin={0}
        aria-valuemax={heavy.limit}
        aria-valuenow={heavy.remaining}
      >
        <div className={`h-full rounded-full ${heavy.remaining ? "bg-[var(--dot-blue)]" : "bg-bad"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** The Account page's card: both limits, in plain words. */
export function UsageCard() {
  const usage = useUsage();
  return (
    <section className="space-y-2" aria-labelledby="usage-heading">
      <h2 id="usage-heading" className="font-semibold">AI usage</h2>
      {!usage ? (
        // Blank space the height of the two loaded lines (text-sm = 20px), so the page doesn't shift when usage arrives.
        <>
          <div aria-hidden className="h-5" />
          <div aria-hidden className="h-5" />
        </>
      ) : !usage.available ? (
        <p className="text-sm text-muted">{MIGRATION_HINT} Until then there are no AI limits.</p>
      ) : (
        <>
          <p className="text-sm">
            <strong>{heavyLine(usage.heavy)}</strong>
            {!usage.heavy.remaining && usage.heavy.resetAt && <> · next one at {clock(usage.heavy.resetAt)}</>}
          </p>
          <p className="text-sm">
            {usage.light.remaining} of {usage.light.limit} quick AI actions left this hour
            {!usage.light.remaining && usage.light.resetAt && <> · more at {clock(usage.light.resetAt)}</>}
          </p>
        </>
      )}
    </section>
  );
}
