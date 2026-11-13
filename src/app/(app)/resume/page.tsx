"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { emptyResume, emptySection, isEmptyResume, normalizeResume, reconcileIds } from "@/lib/resume";
import { addFacts } from "@/lib/facts";
import type { Resume } from "@/lib/types";
import { ResumeDocument } from "@/components/ResumeDocument";
import { ResumeActions } from "@/components/ResumeActions";
import { DocToolbar, PageCount, UndoRedo } from "@/components/DocToolbar";
import { ResumeImport } from "@/components/ResumeImport";
import { FactsPanel } from "@/components/FactsPanel";
import { SaveStatus, useAutosave } from "@/lib/useAutosave";
import { useHistory } from "@/lib/useHistory";

/** Old bullet-bank tags that were not the user's own notes (AI examples, copies of resume lines). */
const NOT_NOTES = ["example", "from-resume", "accepted"];
const LEGACY_DISMISSED_KEY = "jp:legacy-bank-dismissed";
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/** Re-import keeps bullet ids stable and carries the master's facts over (reconcileIds merges them). */
const mergeImport = (prev: Resume, imported: Resume): Resume => reconcileIds(prev, normalizeResume(imported));

export default function MasterResumePage() {
  const supabase = useMemo(() => createClient(), []);
  const [id, setId] = useState<string | null>(null);
  const doc = useHistory<Resume>();
  const resume = doc.value;
  const [error, setError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [justImported, setJustImported] = useState(false);
  const [measure, setMeasure] = useState({ pages: 1, overflowLines: 0 });
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [legacyNotes, setLegacyNotes] = useState<string[]>([]);
  const [legacyDismissed, setLegacyDismissed] = useState(true);

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
    // One-time move of the user's own notes from the retired bullet bank. The table may be gone: ignore errors.
    try {
      setLegacyDismissed(localStorage.getItem(LEGACY_DISMISSED_KEY) === "1");
    } catch {
      setLegacyDismissed(false);
    }
    Promise.resolve(supabase.from("bullets").select("text, tags"))
      .then(({ data }) => {
        const rows = (data ?? []) as { text: string | null; tags: string[] | null }[];
        setLegacyNotes(
          rows
            .filter((b) => b.text?.trim() && !(b.tags ?? []).some((t) => NOT_NOTES.includes(t)))
            .map((b) => b.text!.trim()),
        );
      })
      .catch(() => {});
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

  // Bank notes that aren't already facts (case/whitespace-insensitive, de-duplicated).
  const pendingLegacy = useMemo(() => {
    if (legacyDismissed || !resume) return [];
    const have = new Set((resume.facts ?? []).map(norm));
    const out: string[] = [];
    for (const t of legacyNotes) {
      const k = norm(t);
      if (!have.has(k)) {
        have.add(k);
        out.push(t);
      }
    }
    return out;
  }, [legacyNotes, legacyDismissed, resume]);

  if (error && !resume) return <p className="text-bad">{error}</p>;
  if (!resume) return <p className="text-muted">Loading…</p>;

  const empty = isEmptyResume(resume);
  const onImported = (r: Resume) => {
    doc.set((cur) => mergeImport(cur, r), true);
    setImportOpen(false);
    if (empty) setJustImported(true);
  };
  const setFacts = (facts: string[]) => doc.set((cur) => ({ ...cur, facts }), true);
  const dismissLegacy = () => {
    setLegacyDismissed(true);
    try {
      localStorage.setItem(LEGACY_DISMISSED_KEY, "1");
    } catch {
      /* private mode: dismissal lasts for this visit */
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-3">
      <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
        <h1 className="text-xl font-semibold">Master resume</h1>
        <p className="text-sm text-muted">Everything true about you. Each job gets its own tailored copy.</p>
      </div>

      {empty && !importOpen ? (
        <div className="card p-5 sm:p-8 space-y-4 max-w-2xl">
          <div className="space-y-1">
            <p className="label">Step 1 of 2</p>
            <h2 className="text-lg font-semibold">Import your resume — then add jobs to tailor it for</h2>
            <p className="text-sm text-muted">
              Upload the PDF (or paste the text). It&apos;s rebuilt into a one-page Harvard-style document with your
              exact wording and only the sections you already have. Every job you add later gets its own tailored copy.
            </p>
          </div>
          <ResumeImport replaceWarning={false} onImported={onImported} />
        </div>
      ) : (
        <>
          {justImported && (
            <div className="card border-good/40 bg-good-bg p-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex-1 min-w-48">
                <p className="font-medium">Step 1 done — your master resume is ready.</p>
                <p className="text-sm text-muted">Check it below, then add the first job you want to tailor it for.</p>
              </div>
              <Link href="/" className="btn btn-primary py-2 w-full sm:w-auto">Next: add a job →</Link>
            </div>
          )}

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
                  if (title?.trim()) doc.set((cur) => ({ ...cur, sections: [...cur.sections, emptySection(title.trim())] }), true);
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

          <p className="text-xs text-muted px-1">
            Click any line to edit. Enter adds a bullet, Backspace on an empty bullet removes it, Alt+↑/↓ moves it.
            Undo with Ctrl/⌘+Z.
          </p>
          <ResumeDocument value={resume} onChange={doc.set} onMeasure={setMeasure} actionsSlot={slot} />

          <FactsPanel
            facts={resume.facts ?? []}
            onChange={setFacts}
            onAdd={(lines) => doc.set((cur) => addFacts(cur, lines), true)}
            legacy={pendingLegacy}
            onImportLegacy={() => doc.set((cur) => addFacts(cur, pendingLegacy), true)}
            onDismissLegacy={dismissLegacy}
          />
        </>
      )}
    </div>
  );
}
