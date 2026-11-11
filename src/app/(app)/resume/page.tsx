"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { emptyResume, normalizeResume } from "@/lib/resume";
import type { Resume } from "@/lib/types";
import { ResumeEditor } from "@/components/ResumeEditor";
import { ResumeActions } from "@/components/ResumeActions";
import { SaveStatus, useAutosave } from "@/lib/useAutosave";

export default function MasterResumePage() {
  const supabase = createClient();
  const [id, setId] = useState<string | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);
  const [error, setError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("resumes").select("id, content").eq("is_master", true).maybeSingle();
      if (error) return setError(error.message);
      if (data) {
        setId(data.id);
        setResume(normalizeResume(data.content));
      } else {
        const fresh = emptyResume();
        const { data: created, error: e2 } = await supabase
          .from("resumes").insert({ is_master: true, name: "Master resume", content: fresh }).select("id").single();
        if (e2) return setError(e2.message);
        setId(created.id);
        setResume(fresh);
        setImportOpen(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(
    async (r: Resume) => {
      if (!id) return;
      const { error } = await supabase.from("resumes").update({ content: r }).eq("id", id);
      if (error) throw error;
    },
    [id, supabase],
  );
  const status = useAutosave(resume, save);

  async function runImport(file?: File) {
    const hasContent = resume?.sections.some((sec) => sec.items.some((it) => it.title || it.bullets.some((b) => b.text)));
    if (hasContent && !confirm("Replace your current master resume with the imported one?")) return;
    setImporting(true);
    setError("");
    let res: Response;
    if (file) {
      const form = new FormData();
      form.append("file", file);
      res = await fetch("/api/parse-resume", { method: "POST", body: form });
    } else {
      res = await fetch("/api/parse-resume", { method: "POST", body: JSON.stringify({ text: importText }) });
    }
    const json = await res.json().catch(() => ({ error: `Upload failed (HTTP ${res.status}).` }));
    setImporting(false);
    if (!res.ok) return setError(json.error);
    setResume(json.resume);
    setImportOpen(false);
    setImportText("");
  }

  if (error && !resume) return <p className="text-bad">{error}</p>;
  if (!resume) return <p className="text-muted">Loading…</p>;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Master resume</h1>
          <p className="text-sm text-muted">Everything true about you. Each job gets its own tailored copy of this.</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <SaveStatus status={status} />
          <button className="btn btn-sm" onClick={() => setImportOpen((o) => !o)}>Import PDF or text</button>
          <ResumeActions resume={resume} fileName={`${resume.header.name} Resume`} />
        </div>
      </div>

      {importOpen && (
        <div className="card p-4 space-y-3">
          <p className="text-sm">
            Upload your resume PDF or paste it as text. It gets split into sections, entries and bullets with your
            wording unchanged. <strong>This replaces the current master.</strong>
          </p>
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
              if (f) runImport(f);
            }}
            className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center cursor-pointer transition ${
              dragging ? "border-accent bg-accent/5" : "border-border hover:border-fg/40"
            } ${importing ? "pointer-events-none opacity-60" : ""}`}
          >
            <span className="text-sm font-medium">{importing ? "Reading your resume…" : "Drop a PDF here or tap to choose"}</span>
            <span className="text-xs text-muted">PDF or .txt, up to 4 MB. From Google Docs: File → Download → PDF.</span>
            <input
              type="file"
              accept="application/pdf,.pdf,text/plain,.txt"
              className="sr-only"
              disabled={importing}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) runImport(f);
              }}
            />
          </label>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="h-px flex-1 bg-border" />or paste text<span className="h-px flex-1 bg-border" />
          </div>
          <textarea
            className="input w-full h-40 font-mono text-xs"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste resume text…"
          />
          <div className="flex gap-2">
            <button className="btn btn-primary btn-sm" disabled={importing || !importText.trim()} onClick={() => runImport()}>
              {importing ? "Parsing…" : "Import text"}
            </button>
            <button className="btn btn-sm" onClick={() => setImportOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}

      <p className="text-xs text-muted">
        Tip: hover (or tap) a line for move/delete controls. Press Enter in a bullet to add the next one.
      </p>
      <ResumeEditor value={resume} onChange={setResume} />
    </div>
  );
}
