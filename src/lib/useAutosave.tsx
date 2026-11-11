"use client";

import { useEffect, useRef, useState } from "react";

/** Debounced save. Returns a status string for display. */
export function useAutosave<T>(value: T | null, save: (v: T) => Promise<unknown>, delay = 800) {
  const [status, setStatus] = useState<"saved" | "saving" | "unsaved" | "error">("saved");
  const first = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (value === null) return;
    if (first.current) {
      first.current = false;
      return;
    }
    setStatus("unsaved");
    const t = setTimeout(async () => {
      setStatus("saving");
      try {
        await saveRef.current(value);
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return status;
}

export function SaveStatus({ status }: { status: string }) {
  const text = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved changes", error: "Save failed" }[status];
  return <span className={`text-xs ${status === "error" ? "text-bad" : "text-muted"}`}>{text}</span>;
}
