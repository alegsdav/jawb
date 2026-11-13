"use client";

import { useEffect, useRef, useState } from "react";

export type SaveState = "saved" | "saving" | "unsaved" | "error";

/**
 * Debounced save. Returns a status string for display.
 *
 * Edits are never dropped: a pending save is flushed immediately (with the latest value) when the
 * component unmounts (e.g. client-side navigation), when the page is hidden (iOS app switch, tab
 * close) and on `pagehide`. While anything is unsaved or saving, closing/reloading the tab asks
 * for confirmation. Saves run one at a time, in order, so an older value never lands last.
 */
export function useAutosave<T>(value: T | null, save: (v: T) => Promise<unknown>, delay = 800): SaveState {
  const [status, setStatus] = useState<SaveState>("saved");
  const first = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;
  /** Latest value not yet handed to `save` (wrapped so `null`/falsy values are still "pending"). */
  const pending = useRef<{ v: T } | null>(null);
  const inFlight = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => void>(() => {});

  flushRef.current = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    inFlight.current++;
    setStatus("saving");
    const fn = saveRef.current;
    chain.current = chain.current
      .catch(() => {})
      .then(() => fn(p.v))
      .then(
        () => {
          inFlight.current--;
          if (!pending.current && !inFlight.current) setStatus("saved");
        },
        () => {
          inFlight.current--;
          // Keep the value so the next edit, navigation or tab close retries it (and the tab-close prompt still shows).
          if (!pending.current) pending.current = p;
          setStatus("error");
        },
      );
  };

  useEffect(() => {
    if (value === null) return;
    if (first.current) {
      first.current = false;
      return;
    }
    pending.current = { v: value };
    setStatus("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), delay);
  }, [value, delay]);

  useEffect(() => {
    const flush = () => flushRef.current();
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!pending.current && !inFlight.current) return;
      flush(); // start saving now; the prompt gives it time to finish
      e.preventDefault();
      e.returnValue = ""; // older Safari/Chrome need this to show the prompt
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
      flush(); // unmount (e.g. <Link> navigation): save whatever is pending, fire-and-forget
    };
  }, []);

  return status;
}

export function SaveStatus({ status }: { status: string }) {
  const text = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved changes", error: "Save failed" }[status];
  return (
    <span role="status" className={`text-xs whitespace-nowrap ${status === "error" ? "text-bad" : "text-muted"}`}>
      {text}
    </span>
  );
}
