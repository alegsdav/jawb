"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveState = "saved" | "saving" | "unsaved" | "error";

/** Automatic retries after a failed save, in ms (the last delay repeats). */
export const RETRY_DELAYS = [3000, 10000, 30000];

/** Retry functions of every mounted autosave, so <SaveErrorToast> can retry without being handed one. */
const retryRegistry = new Set<() => void>();

/** Retry every failed autosave on the page right now. */
export function retryAllSaves() {
  for (const retry of retryRegistry) retry();
}

/**
 * Debounced save. Returns the status and a `retry` function.
 *
 * Edits are never dropped: a pending save is flushed immediately (with the latest value) when the
 * component unmounts (e.g. client-side navigation), when the page is hidden (iOS app switch, tab
 * close) and on `pagehide`. While anything is unsaved or saving, closing/reloading the tab asks
 * for confirmation. Saves run one at a time, in order, so an older value never lands last.
 *
 * A failed save keeps its value and retries by itself after 3s, 10s, then every 30s, and as soon
 * as the browser comes back online. `retry()` (or retryAllSaves()) tries again immediately.
 */
export function useAutosaveWithRetry<T>(
  value: T | null,
  save: (v: T) => Promise<unknown>,
  delay = 800,
): { status: SaveState; retry: () => void } {
  const [status, setStatus] = useState<SaveState>("saved");
  const first = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;
  /** Latest value not yet handed to `save` (wrapped so `null`/falsy values are still "pending"). */
  const pending = useRef<{ v: T } | null>(null);
  const inFlight = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  const flushRef = useRef<() => void>(() => {});

  flushRef.current = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    inFlight.current++;
    // While recovering from a failure, stay "error" until a save actually lands (no toast flicker).
    setStatus(failures.current ? "error" : "saving");
    const fn = saveRef.current;
    chain.current = chain.current
      .catch(() => {})
      .then(() => fn(p.v))
      .then(
        () => {
          inFlight.current--;
          failures.current = 0;
          if (!pending.current && !inFlight.current) setStatus("saved");
        },
        (e) => {
          inFlight.current--;
          console.warn("Autosave failed (will retry):", e);
          // Keep the value so a retry, the next edit, navigation or tab close saves it (and the tab-close prompt still shows).
          if (!pending.current) pending.current = p;
          setStatus("error");
          if (!retryTimer.current && !timer.current) {
            const wait = RETRY_DELAYS[Math.min(failures.current, RETRY_DELAYS.length - 1)];
            failures.current++;
            retryTimer.current = setTimeout(() => {
              retryTimer.current = null;
              flushRef.current();
            }, wait);
          }
        },
      );
  };

  const retry = useCallback(() => flushRef.current(), []);

  useEffect(() => {
    if (value === null) return;
    if (first.current) {
      first.current = false;
      return;
    }
    pending.current = { v: value };
    if (!failures.current) setStatus("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), delay);
  }, [value, delay]);

  useEffect(() => {
    const flush = () => flushRef.current();
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    const onOnline = () => pending.current && retry();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!pending.current && !inFlight.current) return;
      flush(); // start saving now; the prompt gives it time to finish
      e.preventDefault();
      e.returnValue = ""; // older Safari/Chrome need this to show the prompt
    };
    retryRegistry.add(retry);
    window.addEventListener("pagehide", flush);
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      retryRegistry.delete(retry);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
      flush(); // unmount (e.g. <Link> navigation): save whatever is pending, fire-and-forget
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [retry]);

  return { status, retry };
}

/** Same as useAutosaveWithRetry, returning only the status (failed saves still retry automatically). */
export function useAutosave<T>(value: T | null, save: (v: T) => Promise<unknown>, delay = 800): SaveState {
  return useAutosaveWithRetry(value, save, delay).status;
}

/** Combine several autosave statuses into the one to show: error > saving > unsaved > saved. */
export function worstStatus(...all: SaveState[]): SaveState {
  for (const s of ["error", "saving", "unsaved"] as const) if (all.includes(s)) return s;
  return "saved";
}

export function SaveStatus({ status }: { status: string }) {
  const text = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved changes", error: "Not saved" }[status];
  return (
    <span role="status" className={`text-xs whitespace-nowrap ${status === "error" ? "text-bad font-medium" : "text-muted"}`}>
      {text}
    </span>
  );
}

/**
 * Hard-to-miss notice while a save is failing: fixed at the bottom of the screen (above the phone tab
 * bar), with a "Retry now" button. Renders nothing unless `status` is "error". Without `onRetry` it
 * retries every autosave on the page.
 */
export function SaveErrorToast({ status, onRetry }: { status: string; onRetry?: () => void }) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (status !== "error") return null;
  return (
    <div
      role="alert"
      className="fixed z-40 inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-sm flex items-center gap-3 rounded-xl border border-bad/40 bg-surface px-4 py-3 text-sm shadow-lg"
    >
      <span className="flex-1 min-w-0">
        <strong className="text-bad">Not saved</strong>
        <span className="text-muted"> — {offline ? "you're offline. It saves when you're back." : "retrying…"}</span>
      </span>
      <button type="button" className="btn btn-sm shrink-0 min-h-10 sm:min-h-0" onClick={onRetry ?? retryAllSaves}>
        Retry now
      </button>
    </div>
  );
}
