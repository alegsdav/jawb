"use client";

import { useEffect, useRef } from "react";

/**
 * "Saved 3 facts · Undo": a short confirmation with Undo, fixed above the phone tab bar (bottom center
 * on desktop). Closes itself after `ms`.
 */
export function UndoToast({
  message, onUndo, onClose, ms = 8000, raised = false,
}: {
  message: string;
  onUndo: () => void;
  onClose: () => void;
  ms?: number;
  raised?: boolean;
}) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const t = setTimeout(() => close.current(), ms);
    return () => clearTimeout(t);
  }, [message, ms]);
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed z-40 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md flex items-center gap-3 rounded-xl border border-good/40 bg-surface px-4 py-2.5 text-sm shadow-lg ${
        raised ? "bottom-[calc(9rem+env(safe-area-inset-bottom))] lg:bottom-20" : "bottom-[calc(4.25rem+env(safe-area-inset-bottom))] lg:bottom-4"
      }`}
    >
      <span className="flex-1 min-w-0 text-good">{message}</span>
      <button type="button" className="btn btn-sm shrink-0 min-h-9 sm:min-h-0" onClick={onUndo}>
        Undo
      </button>
      <button type="button" className="shrink-0 text-muted hover:text-fg px-1 min-h-8" aria-label="Dismiss" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}
