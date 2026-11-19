"use client";

import { useEffect, useState } from "react";
import type { Resume } from "@/lib/types";
import { postApi } from "@/lib/api";

const MAX_PDF_BYTES = 20 * 1024 * 1024; // read in the browser
const MAX_SERVER_PDF_BYTES = 4 * 1024 * 1024; // the server fallback (its request limit)
const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

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

export function ResumeImport({
  onImported, onCancel, replaceWarning, mode = "both",
}: {
  onImported: (r: Resume) => void;
  onCancel?: () => void;
  replaceWarning: boolean;
  /** "file": only the PDF drop zone; "text": only the paste box (onboarding shows them as separate cards). */
  mode?: "both" | "file" | "text";
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [busyKind, setBusyKind] = useState<"pdf" | "text">("pdf");

  // Load pdf.js (and its worker) while the user is still looking, so the first drop is instant.
  useEffect(() => {
    if (mode !== "text") void import("@/lib/import/importPdf").catch(() => {});
  }, [mode]);

  async function run(file?: File) {
    if (replaceWarning && !confirm("Replace your current master resume with the imported one? Your facts are kept.")) return;
    setBusy(true);
    setBusyKind(file && !/\.(txt|md)$/i.test(file.name) ? "pdf" : "text");
    setError("");
    if (file && isPdf(file)) {
      if (file.size > MAX_PDF_BYTES) return fail("That PDF is over 20 MB.");
      const local = await readPdfHere(file);
      if (local && "resume" in local) return done(local.resume);
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
    done(data.resume);
  }

  function done(resume: Resume) {
    setBusy(false);
    onImported(resume);
    setText("");
  }

  function fail(message: string) {
    setBusy(false);
    setError(message);
  }

  return (
    <div className="space-y-3">
      {replaceWarning && (
        <p className="text-sm">
          <strong>Re-importing replaces the current master.</strong>{" "}
          <span className="text-muted">Your facts are kept.</span>
        </p>
      )}
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
        className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-7 text-center cursor-pointer transition ${
          dragging ? "border-accent bg-accent/5" : "border-border hover:border-fg/40"
        } ${busy ? "pointer-events-none opacity-60" : ""}`}
      >
        <span className="text-sm font-medium">{busy ? (busyKind === "pdf" ? "Opening your PDF…" : "Laying out your resume…") : "Drop your resume PDF here or tap to choose"}</span>
        <span className="text-xs text-muted">
          A PDF opens exactly as it is: the same fonts, sizes, bold, lines and spacing, as text you can edit. No AI, no template. Up to 20 MB.
          From Google Docs: File → Download → PDF. A .txt file is treated as pasted text.
        </span>
        <input
          type="file"
          accept="application/pdf,.pdf,text/plain,.txt"
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
        <p className="text-xs text-muted">
          Pasted text has no formatting to keep, so the AI lays it out in the Harvard template. That uses one of your daily AI analyses.
          To keep your own layout, upload the PDF instead.
        </p>
      )}
      {mode !== "file" && (
        <textarea
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
            {busy ? "Laying out…" : "Lay out with AI (Harvard template)"}
          </button>
        )}
        {onCancel && <button className="btn btn-sm" onClick={onCancel}>Cancel</button>}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </div>
    </div>
  );
}
