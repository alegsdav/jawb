"use client";

import { useState } from "react";
import type { Resume } from "@/lib/types";
import { postApi } from "@/lib/api";

export function ResumeImport({
  onImported, onCancel, replaceWarning,
}: {
  onImported: (r: Resume) => void;
  onCancel?: () => void;
  replaceWarning: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  async function run(file?: File) {
    if (replaceWarning && !confirm("Replace your current master resume with the imported one? Your facts are kept.")) return;
    setBusy(true);
    setError("");
    let body: FormData | { text: string };
    if (file) {
      body = new FormData();
      body.append("file", file);
    } else {
      body = { text };
    }
    const { data, error } = await postApi<{ resume: Resume }>("/api/parse-resume", body);
    setBusy(false);
    if (error || !data) return setError(error ?? "Import failed.");
    onImported(data.resume);
    setText("");
  }

  return (
    <div className="space-y-3">
      {replaceWarning && (
        <p className="text-sm">
          <strong>Re-importing replaces the current master.</strong>{" "}
          <span className="text-muted">Your facts are kept.</span>
        </p>
      )}
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
        <span className="text-sm font-medium">{busy ? "Reading your resume…" : "Drop your resume PDF here or tap to choose"}</span>
        <span className="text-xs text-muted">PDF or .txt, up to 4 MB. From Google Docs: File → Download → PDF.</span>
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
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="h-px flex-1 bg-border" />or paste text<span className="h-px flex-1 bg-border" />
      </div>
      <textarea
        className="input w-full h-36 font-mono text-xs"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste resume text…"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()} onClick={() => run()}>
          {busy ? "Parsing…" : "Import text"}
        </button>
        {onCancel && <button className="btn btn-sm" onClick={onCancel}>Cancel</button>}
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
    </div>
  );
}
