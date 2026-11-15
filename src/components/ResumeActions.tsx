"use client";

import { useState } from "react";
import type { Resume } from "@/lib/types";
import { resumeToPlainText } from "@/lib/resume";
import { downloadResumePdf } from "./pdfDownload";
import { CopyIcon, DownloadIcon } from "./icons";
import { IconButton } from "./DocToolbar";

/** What gets printed or copied: never the master-only `facts`. */
const printable = (r: Resume): Resume => ({ version: r.version, header: r.header, sections: r.sections });

/** "Copy as text" and "Download PDF" as icon buttons. Failures show a short message instead of failing silently. */
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
      <IconButton label={copied ? "Copied" : "Copy as text"} onClick={copy}>
        <CopyIcon />
      </IconButton>
      <IconButton label={busy ? "Building PDF…" : "Download PDF"} onClick={downloadPdf} disabled={busy}>
        <DownloadIcon />
      </IconButton>
      {error && (
        <span role="alert" className="max-w-xs truncate px-1 text-xs text-bad" title={error}>
          {error}
        </span>
      )}
    </>
  );
}
