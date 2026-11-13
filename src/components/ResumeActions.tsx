"use client";

import { useState } from "react";
import type { Resume } from "@/lib/types";
import { resumeToPlainText } from "@/lib/resume";
import { downloadResumePdf } from "./pdfDownload";

/** What gets printed or copied: never the master-only `facts`. */
const printable = (r: Resume): Resume => ({ version: r.version, header: r.header, sections: r.sections });

/** "Copy as text" and "Download PDF" buttons. Failures show a short message instead of failing silently. */
export function ResumeActions({ resume: full, fileName }: { resume: Resume; fileName: string }) {
  const resume = printable(full);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function downloadPdf() {
    setBusy(true);
    setError("");
    try {
      await downloadResumePdf(resume, fileName);
    } catch (e) {
      console.error("PDF download failed:", e);
      setError("Couldn't build the PDF. Try again, or use Copy as text.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    setError("");
    try {
      await navigator.clipboard.writeText(resumeToPlainText(resume));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy. Your browser blocked the clipboard; download the PDF instead.");
    }
  }

  return (
    <>
      <button className="btn btn-sm" onClick={copy}>{copied ? "Copied" : "Copy as text"}</button>
      <button className="btn btn-sm btn-primary" onClick={downloadPdf} disabled={busy}>
        {busy ? "Building…" : "Download PDF"}
      </button>
      {error && (
        <span role="alert" className="basis-full text-right text-xs text-bad">
          {error}
        </span>
      )}
    </>
  );
}
