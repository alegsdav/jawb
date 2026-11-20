"use client";

import { useEffect, useId, useRef } from "react";
import type { Resume } from "@/lib/types";
import { ResumeImport, type ImportSource } from "@/components/ResumeImport";

/**
 * Re-import the master resume in a centered dialog, so the page behind keeps its place. A successful import hands
 * the resume to the caller, which closes this and shows the review banner. Escape, Cancel and a click outside close
 * it without changes.
 */
export function ReimportDialog({
  onImported, onClose,
}: {
  onImported: (r: Resume, source?: ImportSource) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // A text selection dragged out of the paste box ends on the overlay; that must not count as a click outside.
  const pressedOverlay = useRef(false);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/50 p-4 sm:items-center"
      onMouseDown={(e) => {
        pressedOverlay.current = e.target === e.currentTarget;
      }}
      onClick={(e) => e.target === e.currentTarget && pressedOverlay.current && onClose()}
    >
      <div
        ref={panel}
        tabIndex={-1}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-bg p-5 shadow-xl outline-none"
      >
        <h2 id={titleId} className="mb-4 font-semibold">Re-import resume</h2>
        <ResumeImport replaceWarning onImported={onImported} onCancel={onClose} />
      </div>
    </div>
  );
}
