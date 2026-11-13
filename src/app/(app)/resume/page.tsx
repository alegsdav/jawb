"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { emptyResume, emptySection, isEmptyResume, normalizeResume } from "@/lib/resume";
import type { Resume } from "@/lib/types";
import { ResumeDocument } from "@/components/ResumeDocument";
import { ResumeActions } from "@/components/ResumeActions";
import { DocToolbar, PageCount, UndoRedo } from "@/components/DocToolbar";
import { ResumeImport } from "@/components/ResumeImport";
import { SaveStatus, useAutosave } from "@/lib/useAutosave";
import { useHistory } from "@/lib/useHistory";
import { addToBank, bulletsFromResume } from "@/lib/bank";

export default function MasterResumePage() {
  const supabase = createClient();
  const [id, setId] = useState<string | null>(null);
  const doc = useHistory<Resume>();
  const resume = doc.value;
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [measure, setMeasure] = useState({ pages: 1, overflowLines: 0 });
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("resumes").select("id, content").eq("is_master", true).maybeSingle();
      if (error) return setError(error.message);
      if (data) {
        setId(data.id);
        doc.reset(normalizeResume(data.content));
      } else {
        const fresh = emptyResume();
        const { data: created, error: e2 } = await supabase
          .from("resumes").insert({ is_master: true, name: "Master resume", content: fresh }).select("id").single();
        if (e2) return setError(e2.message);
        setId(created.id);
        doc.reset(fresh);
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

  if (error && !resume) return <p className="text-bad">{error}</p>;
  if (!resume) return <p className="text-muted">Loading…</p>;

  const empty = isEmptyResume(resume);
  const onImported = (r: Resume) => {
    doc.set(r, true);
    setImportOpen(false);
    // Every bullet from an uploaded resume goes into the bank too (duplicates are skipped).
    addToBank(supabase, bulletsFromResume(r))
      .then((added) => setNote(added.length ? `Added ${added.length} bullet${added.length > 1 ? "s" : ""} to your bullet bank.` : ""))
      .catch(() => setNote("Couldn't copy bullets to your bank."));
  };

  return (
    <div className="max-w-5xl mx-auto space-y-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h1 className="text-xl font-semibold">Master resume</h1>
        <p className="text-sm text-muted">Everything true about you. Each job gets its own tailored copy.</p>
      </div>

      {empty && !importOpen ? (
        <div className="card p-5 sm:p-8 space-y-4 max-w-2xl">
          <div>
            <h2 className="font-semibold">Start by importing your resume</h2>
            <p className="text-sm text-muted">
              Upload the PDF (or paste the text). It&apos;s rebuilt into a one-page Harvard-style document with your
              exact wording and only the sections you already have.
            </p>
          </div>
          <ResumeImport replaceWarning={false} onImported={onImported} />
        </div>
      ) : (
        <>
          <DocToolbar onSlot={setSlot}>
            <UndoRedo undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
            <SaveStatus status={status} />
            <span className="hidden md:inline"><PageCount {...measure} /></span>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <button className="btn btn-sm" onClick={() => setImportOpen((o) => !o)}>Re-import</button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  const title = prompt("Section name (only add sections you actually have):");
                  if (title?.trim()) doc.set({ ...resume, sections: [...resume.sections, emptySection(title.trim())] }, true);
                }}
              >
                + Section
              </button>
              <ResumeActions resume={resume} fileName={`${resume.header.name} Resume`} />
            </div>
          </DocToolbar>

          {importOpen && (
            <div className="card p-4">
              <ResumeImport replaceWarning onImported={onImported} onCancel={() => setImportOpen(false)} />
            </div>
          )}
          {error && <p className="text-sm text-bad">{error}</p>}
      {note && <p className="text-sm text-good">{note}</p>}

          <p className="text-xs text-muted px-1">
            Click any line to edit. Enter adds a bullet, Backspace on an empty bullet removes it, Alt+↑/↓ moves it.
            Undo with Ctrl/⌘+Z.
          </p>
          <ResumeDocument value={resume} onChange={doc.set} onMeasure={setMeasure} actionsSlot={slot} />
        </>
      )}
    </div>
  );
}
