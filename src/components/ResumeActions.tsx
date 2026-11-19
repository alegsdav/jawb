"use client";

import { useCallback, useMemo, useState } from "react";
import type { Resume } from "@/lib/types";
import { docPlainText } from "@/lib/doc/model";
import { resumeDoc } from "@/lib/resume";
import { downloadResumePdf } from "./pdfDownload";
import { CopyIcon, DownloadIcon } from "./icons";
import { IconButton } from "./DocToolbar";

/** What gets printed or copied: the document and page setup, never the master-only `facts` or the baseline. */
const printable = (r: Resume): Resume => ({ version: r.version, doc: r.doc, page: r.page, header: r.header, sections: r.sections });

/**
 * "Download PDF" and "Copy as text" as reusable actions (toolbar buttons, menu items, or the compact
 * `ResumeActions` below). Failures set `error` to a short message instead of failing silently.
 */
export function useResumeActions(full: Resume, fileName: string) {
  const resume = useMemo(() => printable(full), [full]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const download = useCallback(async () => {
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
  }, [resume, fileName]);

  const copy = useCallback(async () => {
    setError("");
    try {
      await navigator.clipboard.writeText(docPlainText(resumeDoc(resume)));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Couldn't copy. Your browser blocked the clipboard; download the PDF instead.");
    }
  }, [resume]);

  return { download, copy, busy, copied, error };
}

/** "Copy as text" and "Download PDF" as icon buttons, with the error message next to them. */
export function ResumeActions({ resume, fileName }: { resume: Resume; fileName: string }) {
  const { download, copy, busy, copied, error } = useResumeActions(resume, fileName);
  return (
    <>
      <IconButton label={copied ? "Copied" : "Copy as text"} onClick={copy}>
        <CopyIcon />
      </IconButton>
      <IconButton label={busy ? "Building PDF…" : "Download PDF"} onClick={download} disabled={busy}>
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
