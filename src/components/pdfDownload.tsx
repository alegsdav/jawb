"use client";

import type { Resume } from "@/lib/types";
import { countPlaceholders } from "@/lib/facts";

/** Every visible text field on the page (facts are never exported). */
export function resumeTexts(r: Resume): string[] {
  return [
    r.header.name,
    r.header.contact,
    ...r.sections.flatMap((sec) => [
      sec.title,
      ...sec.items.flatMap((it) => [it.title, it.subtitle, it.location, it.dates, ...it.bullets.map((b) => b.text)]),
    ]),
  ];
}

/**
 * Build the Harvard-layout PDF in the browser and download it. Returns false if the user backed out
 * of the placeholder warning. The PDF renderer is loaded on demand (it's large).
 */
export async function downloadResumePdf(resume: Resume, fileName: string, { warn = true } = {}): Promise<boolean> {
  const n = warn ? countPlaceholders(resumeTexts(resume)) : 0;
  if (
    n &&
    !confirm(
      `This resume still has ${n} [bracketed] placeholder${n > 1 ? "s" : ""}. Replace ${n > 1 ? "them" : "it"} with your real numbers before sending.\n\nDownload anyway?`,
    )
  )
    return false;
  const [{ pdf }, { ResumePdf }] = await Promise.all([import("@react-pdf/renderer"), import("./ResumePdf")]);
  const blob = await pdf(<ResumePdf resume={resume} />).toBlob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${fileName.replace(/[^\w\- ]+/g, "").trim() || "resume"}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
