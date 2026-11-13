"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { emptyResume, emptySection, isEmptyResume, normalizeResume, reconcileIds } from "@/lib/resume";
import { addFacts } from "@/lib/facts";
import { isUniqueViolation } from "@/lib/db";
import { saveMasterDocument } from "@/lib/master";
import type { Resume } from "@/lib/types";
import { ResumeDocument } from "@/components/ResumeDocument";
import { ResumeActions } from "@/components/ResumeActions";
import { DocToolbar, PageCount, UndoRedo } from "@/components/DocToolbar";
import { ResumeImport } from "@/components/ResumeImport";
import { FactsPanel } from "@/components/FactsPanel";
import { SaveStatus, useAutosave } from "@/lib/useAutosave";
import { useHistory } from "@/lib/useHistory";

// LEGACY bullet bank (retired): a one-time offer to move the user's own notes into facts. Intentional
// transition code; remove once nobody has rows in the old `bullets` table.
/** Old bullet-bank tags that were not the user's own notes (AI examples, copies of resume lines). */
const NOT_NOTES = ["example", "from-resume", "accepted"];
const LEGACY_DISMISSED_KEY = "jp:legacy-bank-dismissed";
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/** Re-import keeps bullet ids stable and carries the master's facts over (reconcileIds merges them). */
const mergeImport = (prev: Resume, imported: Resume): Resume => reconcileIds(prev, normalizeResume(imported));

type MasterRow = { id: string; content: unknown; updated_at: string };
const MASTER_COLS = "id, content, updated_at";

/** Load the master row, creating an empty one on the first visit. Safe when two tabs do this at once. */
async function loadOrCreateMaster(supabase: SupabaseClient): Promise<MasterRow> {
  const { data, error } = await supabase.from("resumes").select(MASTER_COLS).eq("is_master", true).maybeSingle();
  if (error) throw error;
  if (data) return data as MasterRow;
  const { data: created, error: e2 } = await supabase
    .from("resumes")
    .insert({ is_master: true, name: "Master resume", content: emptyResume() })
    .select(MASTER_COLS)
    .single();
  if (!e2) return created as MasterRow;
  if (!isUniqueViolation(e2)) throw e2;
  // Another tab (or a double mount) created it first: use that one.
  const again = await supabase.from("resumes").select(MASTER_COLS).eq("is_master", true).single();
  if (again.error) throw again.error;
  return again.data as MasterRow;
}

export default function MasterResumePage() {
  const supabase = useMemo(() => createClient(), []);
  const [id, setId] = useState<string | null>(null);
  /** The row's updated_at as of our last load/save; every save is conditional on it (see saveMasterDocument). */
  const known = useRef<string | null>(null);
  const doc = useHistory<Resume>();
  const resume = doc.value;
  const setDoc = doc.set;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [justImported, setJustImported] = useState(false);
  const [measure, setMeasure] = useState({ pages: 1, overflowLines: 0 });
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [legacyNotes, setLegacyNotes] = useState<string[]>([]);
  const [legacyDismissed, setLegacyDismissed] = useState(true);

  useEffect(() => {
    loadOrCreateMaster(supabase).then(
      (row) => {
        known.current = row.updated_at;
        setId(row.id);
        doc.reset(normalizeResume(row.content));
      },
      (e: { message?: string }) => setError(e?.message || "Couldn't load your master resume."),
    );
    // LEGACY: one-time move of the user's own notes from the retired bullet bank. The table may be gone: ignore errors.
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

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  /**
   * Conflict-safe autosave: if the master changed elsewhere since we last saw it (another tab or
   * device, or facts added from a job page), keep this document but union in the other version's
   * facts, save that, and show the merged facts here too.
   */
  const save = useCallback(
    async (r: Resume) => {
      if (!id || !known.current) return;
      const out = await saveMasterDocument(supabase, id, r, known.current);
      known.current = out.updatedAt;
      if (out.content !== r) {
        const merged = out.content.facts ?? [];
        const added = merged.length - (r.facts?.length ?? 0);
        setDoc((cur) => addFacts(cur, merged), true);
        setNotice(`Added ${added} fact${added === 1 ? "" : "s"} saved from another tab or device.`);
      }
    },
    [id, supabase, setDoc],
  );
  const status = useAutosave(resume, save);

  // LEGACY: bank notes that aren't already facts (case/whitespace-insensitive, de-duplicated).
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
  const factCount = resume.facts?.length ?? 0;
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
    <div className="max-w-5xl lg:max-w-7xl mx-auto space-y-3">
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

          {/* Desktop: facts in a sticky right-hand column beside the page. Phones: below it, with a jump link. */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <div className="min-w-0 space-y-3">
              <DocToolbar onSlot={setSlot}>
                <UndoRedo undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
                <SaveStatus status={status} />
                <span className="hidden md:inline"><PageCount {...measure} /></span>
                <a href="#facts" className="btn btn-sm lg:hidden">Facts ({factCount})</a>
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
              {notice && <p role="status" className="text-sm text-good px-1">{notice}</p>}

              <p className="text-xs text-muted px-1">
                Click any line to edit. Enter adds a bullet, Backspace on an empty bullet removes it, Alt+↑/↓ moves it.
                Undo with Ctrl/⌘+Z.
              </p>
              <ResumeDocument value={resume} onChange={doc.set} onMeasure={setMeasure} actionsSlot={slot} />
            </div>

            <div className="lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto">
              <FactsPanel
                facts={resume.facts ?? []}
                onChange={setFacts}
                onAdd={(lines) => doc.set((cur) => addFacts(cur, lines), true)}
                legacy={pendingLegacy}
                onImportLegacy={() => doc.set((cur) => addFacts(cur, pendingLegacy), true)}
                onDismissLegacy={dismissLegacy}
              />
            </div>
          </div>
        </>
      )}

      {/* TODO(round2, orchestrator): render Worker D's save-failure toast here once useAutosave exports it:
          <SaveErrorToast status={status} />   (import { SaveErrorToast } from "@/lib/useAutosave") */}
    </div>
  );
}
