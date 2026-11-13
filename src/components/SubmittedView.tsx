"use client";

import { useEffect, useRef, useState } from "react";
import type { Resume } from "@/lib/types";
import { ResumeView } from "./ResumeDocument";
import { downloadResumePdf } from "./pdfDownload";

export const formatSubmitted = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Full-screen, read-only view of the resume that was sent with the application. */
export function SubmittedView({
  resume, submittedAt, fileName, onClose, onReplace,
}: {
  resume: Resume;
  submittedAt: string;
  fileName: string;
  onClose: () => void;
  /** Re-snapshot from the current tailored copy (asks for confirmation itself). */
  onReplace: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const opener = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  async function download() {
    setBusy(true);
    try {
      await downloadResumePdf(resume, fileName, { warn: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="submitted-title"
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="mx-auto my-0 sm:my-8 max-w-4xl min-h-dvh sm:min-h-0 bg-bg sm:rounded-xl shadow-xl">
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-bg/95 px-3 sm:px-4 py-2.5 sm:rounded-t-xl pt-[max(0.625rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1 basis-48">
            <h2 id="submitted-title" className="font-semibold">What you sent</h2>
            <p className="text-xs text-muted">
              Saved when you marked this job Applied on {formatSubmitted(submittedAt)}. Read-only.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={onReplace}>Replace with current tailored copy…</button>
            <button type="button" className="btn btn-sm btn-primary min-h-10 sm:min-h-0" onClick={download} disabled={busy}>
              {busy ? "Building…" : "Download this PDF"}
            </button>
            <button ref={closeBtn} type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={onClose} aria-label="Close">Close</button>
          </div>
        </div>
        <div className="p-0 sm:p-3">
          <ResumeView value={resume} />
        </div>
      </div>
    </div>
  );
}
