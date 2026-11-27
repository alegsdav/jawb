"use client";

import { useEffect, useState } from "react";
import type { Resume } from "@/lib/types";
import { postApi } from "@/lib/api";
import { LoadingState } from "@/components/ui/loading-state";

const MAX_PDF_BYTES = 20 * 1024 * 1024; // read in the browser
const MAX_DOCX_BYTES = 20 * 1024 * 1024; // read in the browser
const MAX_SERVER_PDF_BYTES = 4 * 1024 * 1024; // the server fallback (its request limit)
const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const isDocx = (f: File) => f.type === DOCX_TYPE || /\.docx$/i.test(f.name);
const isOldDoc = (f: File) => /\.doc$/i.test(f.name);

/**
 * Reads a .docx in the browser (its XML is unzipped here; nothing is uploaded). Resolves to the resume or to an
 * error message to show.
 */
async function readDocxHere(file: File): Promise<{ resume: Resume } | { error: string }> {
  const { resumeFromDocx } = await import("@/lib/import/resumeFromDocx");
  const { DocxError } = await import("@/lib/import/docxToDoc");
  try {
    return { resume: resumeFromDocx(new Uint8Array(await file.arrayBuffer())) };
  } catch (e) {
    if (e instanceof DocxError) return { error: e.message };
    console.error("Reading the Word file failed.", e);
    return { error: "Couldn't read that Word file. Save it again as .docx, or export it as PDF." };
  }
}

/**
 * Reads a PDF in the browser (pdf.js, loaded on demand). Resolves to the resume, to an error message when the PDF
 * has no text, or to null when the browser could not read it at all (then the server tries).
 */
async function readPdfHere(file: File): Promise<{ resume: Resume } | { error: string } | null> {
  try {
    const { importPdfInBrowser, NoTextError } = await import("@/lib/import/importPdf");
    try {
      return { resume: await importPdfInBrowser(file) };
    } catch (e) {
      if (e instanceof NoTextError) return { error: e.message };
      throw e;
    }
  } catch (e) {
    console.error("Reading the PDF in the browser failed; trying the server.", e);
    return null;
  }
}

/** Id of the paste box: the file error's "Paste your resume text instead" action focuses it (one paste box per page). */
const PASTE_BOX_ID = "resume-paste-text";

/** Where an import came from; a file import gets the review banner (a pasted text does not). */
export type ImportSource = { fileName: string };

export function ResumeImport({
  onImported, onCancel, replaceWarning, mode = "both",
}: {
  onImported: (r: Resume, source?: ImportSource) => void;
  onCancel?: () => void;
  replaceWarning: boolean;
  /** "file": only the PDF drop zone; "text": only the paste box (onboarding shows them as separate cards). */
  mode?: "both" | "file" | "text";
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  /** The error came from a file, so the way forward is pasting the text instead. */
  const [errorFromFile, setErrorFromFile] = useState(false);
  const [busyKind, setBusyKind] = useState<"pdf" | "docx" | "text">("pdf");

  // Load pdf.js (and its worker) while the user is still looking, so the first drop is instant.
  useEffect(() => {
    if (mode !== "text") void import("@/lib/import/importPdf").catch(() => {});
  }, [mode]);

  async function run(file?: File) {
    if (replaceWarning && !confirm("Replace your current master resume with the imported one? Your facts are kept.")) return;
    setBusy(true);
    setBusyKind(file && isDocx(file) ? "docx" : file && !/\.(txt|md)$/i.test(file.name) ? "pdf" : "text");
    setError("");
    setErrorFromFile(!!file);
    if (file && isOldDoc(file) && !isDocx(file)) {
      return fail("That's an old Word (.doc) file. Save it as .docx or PDF first.");
    }
    if (file && isDocx(file)) {
      if (file.size > MAX_DOCX_BYTES) return fail("That Word file is over 20 MB.");
      const local = await readDocxHere(file);
      if ("resume" in local) return done(local.resume, file);
      return fail(local.error);
    }
    if (file && isPdf(file)) {
      if (file.size > MAX_PDF_BYTES) return fail("That PDF is over 20 MB.");
      const local = await readPdfHere(file);
      if (local && "resume" in local) return done(local.resume, file);
      if (local) return fail(local.error);
      if (file.size > MAX_SERVER_PDF_BYTES) {
        return fail("Couldn't read that file. Export it again as a text PDF, or paste the text.");
      }
    }
    let body: FormData | { text: string };
    if (file) {
      body = new FormData();
      body.append("file", file);
    } else {
      body = { text };
    }
    const { data, error } = await postApi<{ resume: Resume }>("/api/parse-resume", body);
    if (error || !data) return fail(error ?? "Import failed.");
    done(data.resume, file);
  }

  function done(resume: Resume, file?: File) {
    setBusy(false);
    onImported(resume, file ? { fileName: file.name } : undefined);
    setText("");
  }

  function fail(message: string) {
    setBusy(false);
    setError(message);
  }

  /** Scrolls to the paste box (it may sit in another card, in onboarding) and focuses it. */
  function pasteInstead() {
    const box = document.getElementById(PASTE_BOX_ID);
    box?.scrollIntoView({ behavior: "smooth", block: "center" });
    box?.focus();
  }

  return (
    <div className="space-y-3">
      {replaceWarning && <p className="text-sm">Re-importing replaces the current master. Your facts are kept.</p>}
      {mode !== "text" && (
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) run(f);
        }}
        title="A PDF or Word file opens exactly as it is: the same fonts, sizes, bold, lines and spacing, as text you can edit. A .docx is the most accurate. From Google Docs: File → Download → Microsoft Word (.docx) or PDF."
        className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-7 text-center cursor-pointer transition ${
          dragging ? "border-accent bg-accent/5" : "border-border hover:border-fg/40"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <span className="text-sm font-medium">
          {busy ? (
            <LoadingState label={busyKind === "docx" ? "Opening your document" : busyKind === "pdf" ? "Opening your PDF" : "Laying out your resume"} />
          ) : (
            "Drop your resume here or tap to choose"
          )}
        </span>
        <span className="text-xs text-muted">PDF or .docx, up to 20 MB</span>
        <input
          type="file"
          accept={`application/pdf,.pdf,${DOCX_TYPE},.docx,application/msword,.doc,text/plain,.txt`}
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) run(f);
          }}
        />
      </label>
      )}
      {mode === "both" && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="h-px flex-1 bg-border" />or paste text<span className="h-px flex-1 bg-border" />
        </div>
      )}
      {mode !== "file" && (
        <textarea
          id={PASTE_BOX_ID}
          title="Pasted text has no formatting to keep, so the AI lays it out in the Harvard template. That uses one of your daily AI analyses. To keep your own layout, upload the PDF instead."
          className="input w-full h-36 font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste resume text…"
          aria-label="Resume text"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {mode !== "file" && (
          <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={() => run()}>
            {busy ? <LoadingState label="Laying out" className="loading-on-fill" /> : "Lay out with AI (Harvard template)"}
          </button>
        )}
        {onCancel && <button className="btn btn-sm" onClick={onCancel}>Cancel</button>}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </div>
      {error && errorFromFile && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm">
          <span className="flex-1 min-w-48 text-muted">
            Paste the text from your resume instead. It is laid out in the clean Harvard template (uses one of your daily AI analyses).
          </span>
          <button type="button" className="btn btn-sm btn-primary min-h-10 sm:min-h-0" onClick={pasteInstead}>
            Paste your resume text instead
          </button>
        </div>
      )}
    </div>
  );
}
