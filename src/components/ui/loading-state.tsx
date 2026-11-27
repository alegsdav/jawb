"use client";

import { useEffect, useState } from "react";

/*
 * LOADING STATE: a pixel-grid loader for long-running work. Variants: Drive (square cells, a chevron wavefront driving
 * right), Dots (the same, circular cells), Orbit (a comet lapping the grid's perimeter). Paired with a shimmering label
 * and a live elapsed timer in mono tabular figures. Colours are the page's tokens (--fg, --muted), so it follows the
 * theme and the sidebar's dark peek. Inside a filled button, add `loading-on-fill` so it takes the button's text colour.
 * Reduced motion freezes the grid to its dim state and shows the label as plain muted text; the timer still ticks.
 */

export type LoadingVariant = "Drive" | "Dots" | "Orbit";

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

const PATTERNS: Record<LoadingVariant, { delays: (number | null)[]; dur: number; round: boolean }> = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
};

/** Seconds since mount, ticking every tenth of a second: "4.2s", then "1m 3.5s". */
function useElapsed(): string {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDs((d) => d + 1), 100);
    return () => clearInterval(t);
  }, []);
  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

export type LoadingStateProps = {
  /** The text shown beside the grid, without a trailing ellipsis: "Analyzing", "Saving a copy". */
  label?: string;
  variant?: LoadingVariant;
  /** Extra classes for the root (it is `w-fit` by default). */
  className?: string;
};

export function LoadingState({ label = "Churning", variant = "Drive", className }: LoadingStateProps) {
  const elapsed = useElapsed();
  const { delays, dur, round } = PATTERNS[variant];
  return (
    <span
      role="status"
      aria-live="polite"
      className={["loading-state inline-flex w-fit items-center gap-2.5", className].filter(Boolean).join(" ")}
    >
      <span aria-hidden="true" className="grid grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {delays.map((d, i) => (
          <span
            key={i}
            className={`loading-cell size-[4px] bg-fg ${round ? "rounded-full" : "rounded-[1px]"}`}
            style={{
              opacity: d === null ? 0.07 : 0.15,
              animation: d === null ? "none" : `pixel-on ${dur}ms ease-in-out ${d}ms infinite`,
            }}
          />
        ))}
      </span>
      <span
        className="loading-label bg-clip-text text-[13px] font-medium text-transparent"
        style={{
          backgroundImage: "linear-gradient(90deg, var(--muted) 35%, var(--fg) 50%, var(--muted) 65%)",
          backgroundSize: "200% 100%",
          animation: "shimmer-text 1.4s linear infinite",
        }}
      >
        {label}
      </span>
      <span aria-hidden="true" className="font-mono text-[12px] text-muted tabular-nums">
        {elapsed}
      </span>
    </span>
  );
}

export default LoadingState;
