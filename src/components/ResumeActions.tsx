"use client";

import { useState } from "react";
import type { Resume } from "@/lib/types";
import { resumeToPlainText } from "@/lib/resume";
import { countPlaceholders } from "@/lib/facts";

/** What gets printed or copied: never the master-only `facts`. */
const printable = (r: Resume): Resume => ({ version: r.version, header: r.header, sections: r.sections });

export function ResumeActions({ resume: full, fileName }: { resume: Resume; fileName: string }) {
  const resume = printable(full);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function downloadPdf() {
    const texts = [resume.header.name, resume.header.contact, ...resume.sections.flatMap((sec) => [
      sec.title, ...sec.items.flatMap((it) => [it.title, it.subtitle, it.location, it.dates, ...it.bullets.map((b) => b.text)]),
    ])];
    const n = countPlaceholders(texts);
    const msg = `This resume still has ${n} [bracketed] placeholder${n > 1 ? "s" : ""} where a real number or detail should go. Download anyway?`;
    if (n && !confirm(msg)) return;
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
