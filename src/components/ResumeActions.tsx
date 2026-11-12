"use client";

import { useState } from "react";
import type { Resume } from "@/lib/types";
import { resumeToPlainText } from "@/lib/resume";

export function ResumeActions({ resume, fileName }: { resume: Resume; fileName: string }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function downloadPdf() {
    setBusy(true);
    try {
      const [{ pdf }, { ResumePdf }] = await Promise.all([import("@react-pdf/renderer"), import("./ResumePdf")]);
      const blob = await pdf(<ResumePdf resume={resume} />).toBlob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${fileName.replace(/[^\w\- ]+/g, "").trim() || "resume"}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(resumeToPlainText(resume));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <button className="btn btn-sm" onClick={copy}>{copied ? "Copied" : "Copy text"}</button>
      <button className="btn btn-sm btn-primary" onClick={downloadPdf} disabled={busy}>
        {busy ? "Building…" : "Download PDF"}
      </button>
    </>
  );
}
