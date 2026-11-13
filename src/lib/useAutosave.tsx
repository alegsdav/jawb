"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSaveQueue, type SaveQueue, type SaveState } from "./saveQueue";

export { createSaveQueue, RETRY_DELAYS, type SaveQueue, type SaveState } from "./saveQueue";

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
 * The scheduling itself lives in createSaveQueue (saveQueue.ts).
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
  const queue = useRef<SaveQueue<T> | null>(null);
  if (!queue.current) {
    queue.current = createSaveQueue<T>({
      save: (v) => saveRef.current(v),
      onStatus: setStatus,
      delay,
      onError: (e) => console.warn("Autosave failed (will retry):", e),
    });
  }

  const retry = useCallback(() => queue.current?.flush(), []);

  useEffect(() => {
    if (value === null) return;
    if (first.current) {
      first.current = false;
      return;
    }
    queue.current?.push(value, delay);
  }, [value, delay]);

  useEffect(() => {
    const q = queue.current!;
    const flush = () => q.flush();
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    const onOnline = () => q.hasPending() && flush();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!q.busy()) return;
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
      q.dispose();
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
