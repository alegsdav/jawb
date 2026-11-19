"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MAX_TAB_STOPS, type TabStop, type TabStopAlign } from "@/lib/doc/types";
import { TAB_STOP_MAX_IN, TAB_STOP_STEP_IN, nextStopRow, rowsFromStops, stopsFromRows, type StopRow } from "@/lib/tabStopsUi";

const ALIGN_LABELS: Record<TabStopAlign, string> = { left: "Left", center: "Center", right: "Right" };

/**
 * Tab stops of the paragraph the caret is in: each stop's position (inches from the text's left edge) and alignment.
 * Apply hands the stops to the caller (null when none are left, which restores the default tabs); Cancel, Escape and a
 * click outside close it without changes.
 */
export function TabStopsDialog({
  stops, onApply, onClose,
}: {
  /** The paragraph's stops as they are now. */
  stops: TabStop[] | null;
  onApply: (stops: TabStop[] | null) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<StopRow[]>(() => rowsFromStops(stops));
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const firstInput = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    firstInput.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  function edit(i: number, change: Partial<StopRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...change } : r)));
    setError(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = stopsFromRows(rows);
    if (!result.ok) return setError(result.error);
    onApply(result.stops.length ? result.stops : null);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-doc-keep-selection
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form onSubmit={submit} noValidate className="w-full max-w-md space-y-4 rounded-xl border border-border bg-bg p-5 shadow-xl">
        <div>
          <h2 id={titleId} className="font-semibold">Tab stops</h2>
          <p className="text-xs text-muted">
            Press Tab in a line to jump to the next stop. Without stops, the last tab pushes text to the right margin.
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-muted">No stops: tabs use the default spacing.</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row, i) => (
              <li key={i} className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">Position (in)</span>
                  <input
                    ref={i === 0 ? firstInput : undefined}
                    type="number"
                    inputMode="decimal"
                    step={TAB_STOP_STEP_IN}
                    min={0}
                    max={TAB_STOP_MAX_IN}
                    className="input w-28"
                    value={row.inches}
                    onChange={(e) => edit(i, { inches: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted">Alignment</span>
                  <select className="input" value={row.align} onChange={(e) => edit(i, { align: e.target.value as TabStopAlign })}>
                    {(Object.keys(ALIGN_LABELS) as TabStopAlign[]).map((a) => (
                      <option key={a} value={a}>{ALIGN_LABELS[a]}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-sm min-h-10 sm:min-h-0"
                  aria-label={`Remove stop ${i + 1}`}
                  onClick={() => {
                    setRows((rs) => rs.filter((_, j) => j !== i));
                    setError(null);
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap justify-between gap-2">
          <button
            type="button"
            className="btn btn-sm min-h-10 sm:min-h-0"
            disabled={rows.length >= MAX_TAB_STOPS}
            onClick={() => setRows((rs) => [...rs, nextStopRow(rs)])}
          >
            Add stop
          </button>
          <button
            type="button"
            className="btn btn-sm min-h-10 sm:min-h-0"
            disabled={rows.length === 0}
            onClick={() => {
              setRows([]);
              setError(null);
            }}
          >
            Clear all
          </button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-sm btn-primary min-h-10 sm:min-h-0">
            Apply
          </button>
        </div>
      </form>
    </div>
  );
}
