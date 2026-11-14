"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { emptyResume, emptySection, isEmptyResume, normalizeResume, reconcileIds, uid } from "@/lib/resume";
import { dbErrorMessage, isUniqueViolation } from "@/lib/db";
import { mergeResumes, sameJson, saveMasterDocument, type MergeConflict } from "@/lib/master";
import type { Fact, Resume } from "@/lib/types";
import { ResumeDocument, type DocSelection } from "@/components/ResumeDocument";
import { CoachPanel } from "@/components/CoachPanel";
import { SideTabs } from "@/components/SideTabs";
import { insertCoachedBullet, type CoachTarget } from "@/lib/coaching";
import { ResumeActions } from "@/components/ResumeActions";
import { DocToolbar, PageCount, UndoRedo } from "@/components/DocToolbar";
import { ResumeImport } from "@/components/ResumeImport";
import { FactsPanel } from "@/components/FactsPanel";
import { UndoToast } from "@/components/UndoToast";
import { useFacts } from "@/lib/useFacts";
import { importedBulletFacts, plural } from "@/lib/facts";
import { SaveErrorToast, SaveStatus, useAutosaveWithRetry } from "@/lib/useAutosave";
import { useHistory } from "@/lib/useHistory";

/** Re-import keeps bullet ids stable (so jobs' "changes vs master" and linked facts stay right). */
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

type Conflict = { server: Resume; serverUpdatedAt: string; conflicts: MergeConflict[] };

/** "Your master resume was changed elsewhere": autosave is paused until the user picks a side. */
function ConflictBanner({
  conflict, busy, onReload, onKeepMine,
}: { conflict: Conflict; busy: boolean; onReload: () => void; onKeepMine: () => void }) {
  const shown = conflict.conflicts.slice(0, 3);
  const more = conflict.conflicts.length - shown.length;
  return (
    <div
      role="alert"
      className="fixed z-40 inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-4 lg:bottom-4 sm:max-w-md rounded-xl border border-bad/50 bg-surface p-4 text-sm shadow-lg space-y-2 max-h-[70dvh] overflow-y-auto"
    >
      <p className="font-semibold text-bad">Your master resume was changed elsewhere</p>
      <p className="text-muted">
        Another tab or device changed the same {conflict.conflicts.length === 1 ? "line" : "lines"}. Nothing here is saved
        until you choose.
      </p>
      <ul className="space-y-1">
        {shown.map((c, i) => (
          <li key={i} className="break-words">
            <span className="font-medium">{c.where}</span>
            {(c.local || c.server) && (
              <span className="block text-xs text-muted">
                Yours: “{c.local || "(empty)"}” · Theirs: “{c.server || "(empty)"}”
              </span>
            )}
          </li>
        ))}
        {more > 0 && <li className="text-xs text-muted">and {more} more</li>}
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="btn min-h-10 sm:min-h-0 flex-1 sm:flex-none" disabled={busy} onClick={onReload}>
          Reload theirs
        </button>
        <button type="button" className="btn btn-primary min-h-10 sm:min-h-0 flex-1 sm:flex-none" disabled={busy} onClick={onKeepMine}>
          Keep mine (overwrite)
        </button>
      </div>
      <p className="text-xs text-muted">
        Reload theirs shows their version and drops your unsaved edits here. Keep mine saves your version of these lines
        over theirs and keeps their other changes.
      </p>
    </div>
  );
}

export default function MasterResumePage() {
  const supabase = useMemo(() => createClient(), []);
  const [id, setId] = useState<string | null>(null);
  /**
   * The content and updated_at as of our last load/save: the merge base. Every save is conditional on
   * this updated_at; if the row changed elsewhere, saveMasterDocument three-way merges against it.
   */
  const base = useRef<{ content: Resume; updatedAt: string } | null>(null);
  /** Set while both sides changed the same thing: autosave is paused until the user picks a side. */
  const [conflict, setConflictState] = useState<Conflict | null>(null);
  const conflictRef = useRef<Conflict | null>(null);
  const setConflict = (c: Conflict | null) => {
    conflictRef.current = c;
    setConflictState(c);
  };
  const [resolving, setResolving] = useState(false);
  const doc = useHistory<Resume>();
  const resume = doc.value;
  const setDoc = doc.set;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [justImported, setJustImported] = useState(false);
  const [measure, setMeasure] = useState({ pages: 1, overflowLines: 0 });
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const facts = useFacts(supabase);
  const mirrorRef = useRef(facts.mirror);
  mirrorRef.current = facts.mirror;
  /** "Fact deleted · Undo" */
  const [undo, setUndo] = useState<{ message: string; restore: Fact[] } | null>(null);
  /** The entry or bullet the coaching panel is about (follows the selection; "Back" clears it). */
  const [coachTarget, setCoachTarget] = useState<CoachTarget | null>(null);
  const [coachStart, setCoachStart] = useState<"questions" | undefined>(undefined);
  const [sideTab, setSideTab] = useState<"coach" | "facts">("coach");
  const latestDoc = useRef<Resume | null>(null);
  latestDoc.current = resume;
  const onSelection = useCallback((sel: DocSelection | null) => {
    if (!sel || sel.kind === "section") return;
    setCoachTarget((cur) => {
      const next = { sectionId: sel.sectionId, entryId: sel.entryId, bulletId: sel.kind === "bullet" ? sel.bulletId : null };
      return cur && cur.entryId === next.entryId && cur.bulletId === next.bulletId ? cur : next;
    });
    setCoachStart(undefined);
    setSideTab("coach");
  }, []);

  useEffect(() => {
    loadOrCreateMaster(supabase).then(
      (row) => {
        const content = normalizeResume(row.content);
        base.current = { content, updatedAt: row.updated_at };
        setId(row.id);
        doc.reset(content);
      },
      (e: { code?: string; message?: string }) => {
        console.error("Loading the master resume failed:", e);
        setError(dbErrorMessage(e, "load"));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  /**
   * Conflict-safe autosave: if the master changed elsewhere since our last load/save (another tab or
   * device, facts or "Save as master" from a job page), three-way merge: changes from both sides are
   * kept and shown here. If both sides changed the same thing, nothing is written and the conflict
   * banner asks which version to keep (autosave stays paused until then).
   */
  const save = useCallback(
    async (r: Resume) => {
      if (!id || !base.current || conflictRef.current) return;
      // Nothing new in the document (e.g. right after a merge, or a retry after the facts step failed).
      if (!sameJson(r, base.current.content)) {
        const out = await saveMasterDocument(supabase, id, r, base.current);
        if (out.kind === "conflict") {
          setConflict({ server: out.server, serverUpdatedAt: out.serverUpdatedAt, conflicts: out.conflicts });
          return;
        }
        base.current = { content: out.content, updatedAt: out.updatedAt };
        if (out.merged) {
          // Edits typed while this save was in flight are merged on top (base = what we sent).
          setDoc((cur) => (cur === r ? out.content : mergeResumes(r, cur, out.content).merged), true);
          setNotice("Merged changes made on another device.");
        }
      }
      // Same save: facts linked to master bullets follow their bullet's text (or become standalone when
      // the bullet is emptied or deleted). Throws on failure, so autosave retries this step too.
      await mirrorRef.current(id, base.current.content);
    },
    [id, supabase, setDoc],
  );
  const { status, retry } = useAutosaveWithRetry(resume, save);

  // While a conflict is open nothing is saved, so ask before the tab closes.
  useEffect(() => {
    if (!conflict) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [conflict]);

  /** Conflict choice: drop this page's unsaved edits and show the version saved elsewhere. */
  async function reloadTheirs() {
    if (!id || !conflictRef.current) return;
    setResolving(true);
    let next = { content: conflictRef.current.server, updatedAt: conflictRef.current.serverUpdatedAt };
    const { data } = await supabase.from("resumes").select("content, updated_at").eq("id", id).maybeSingle();
    if (data) next = { content: normalizeResume(data.content), updatedAt: (data as { updated_at: string }).updated_at };
    base.current = next;
    doc.reset(next.content);
    setConflict(null);
    setResolving(false);
    setNotice("Loaded the version saved on your other tab or device.");
  }

  /**
   * Conflict choice: keep this page's version of the conflicting lines (their other changes are kept
   * too) and save it over theirs. Rebasing on the server copy makes the next save write exactly that.
   */
  function keepMine() {
    const c = conflictRef.current;
    if (!c || !base.current || !resume) return;
    const { merged } = mergeResumes(base.current.content, resume, c.server);
    base.current = { content: c.server, updatedAt: c.serverUpdatedAt };
    setConflict(null);
    setDoc({ ...merged }, true); // a new value, so autosave runs
  }

  if (error && !resume) return <p className="text-bad">{error}</p>;
  if (!resume) return <p className="text-muted">Loading…</p>;

  const empty = isEmptyResume(resume);
  const factCount = facts.facts.length;
  const onImported = (r: Resume) => {
    const next = mergeImport(resume, r);
    doc.set(next, true);
    setImportOpen(false);
    if (empty) setJustImported(true);
    // Every bullet you imported is a fact the AI can use, linked to its bullet (it follows your edits).
    if (id) void facts.add(importedBulletFacts(next, id, facts.facts));
  };
  /** Put a coached bullet on the master (an undo step); returns its id. */
  const insertBullet = (target: CoachTarget, text: string, mode: "add" | "replace"): string | null => {
    const cur = latestDoc.current;
    if (!cur || !cur.sections.some((sec) => sec.items.some((it) => it.id === target.entryId))) return null;
    const { resume: next, bulletId } = insertCoachedBullet(cur, target, text, mode, uid());
    doc.set(next, true);
    return bulletId;
  };
  const deleteFact = async (f: Fact) => {
    if (await facts.remove([f.id])) setUndo({ message: "Fact deleted", restore: [f] });
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
                <SaveStatus status={conflict ? "error" : status} />
                <span className="hidden md:inline"><PageCount {...measure} /></span>
                <a
                  href="#side-panel"
                  className="btn btn-sm lg:hidden"
                  onClick={() => setSideTab("facts")}
                >
                  Facts ({factCount})
                </a>
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
              <ResumeDocument value={resume} onChange={doc.set} onMeasure={setMeasure} actionsSlot={slot} onSelectionChange={onSelection} />
            </div>

            <div id="side-panel" className="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto space-y-3 scroll-mt-16">
              <SideTabs
                label="Panel"
                value={sideTab}
                onChange={setSideTab}
                tabs={[
                  { key: "coach", label: "Coach" },
                  { key: "facts", label: `Facts (${factCount})` },
                ]}
              />
              {sideTab === "coach" &&
                (coachTarget ? (
                  <CoachPanel
                    key={`${coachTarget.entryId}:${coachTarget.bulletId ?? ""}:${coachStart ?? ""}`}
                    resume={resume}
                    resumeId={id}
                    target={coachTarget}
                    facts={facts}
                    startWith={coachStart}
                    onBack={() => setCoachTarget(null)}
                    onInsert={insertBullet}
                  />
                ) : (
                  <section className="card p-4 space-y-2" aria-labelledby="coach-intro">
                    <h2 id="coach-intro" className="font-semibold">Coach</h2>
                    <p className="text-sm text-muted">
                      Select any entry or bullet on your resume to see examples of strong bullets, or answer a few questions
                      that help you find your real numbers. Nothing goes on your resume until you choose it.
                    </p>
                  </section>
                ))}
              {sideTab === "facts" && (
              <FactsPanel
                facts={facts.facts}
                status={facts.status}
                error={facts.error}
                onAdd={async (lines) => {
                  const added = await facts.add(lines.map((text) => ({ text, source: "manual" })));
                  if (added?.length) setNotice(`Saved ${plural(added.length, "fact")}.`);
                  else if (added) setNotice("You already have that fact.");
                }}
                onEdit={facts.edit}
                onDelete={deleteFact}
              />
              )}
            </div>
          </div>
        </>
      )}

      {undo && (
        <UndoToast
          message={undo.message}
          onUndo={() => {
            void facts.restore(undo.restore);
            setUndo(null);
          }}
          onClose={() => setUndo(null)}
          raised={status === "error"}
        />
      )}
      {/* Fixed "Not saved — retrying…" notice; visible even when the toolbar has scrolled away on phones. */}
      {conflict ? (
        <ConflictBanner conflict={conflict} busy={resolving} onReload={reloadTheirs} onKeepMine={keepMine} />
      ) : (
        <SaveErrorToast status={status} onRetry={retry} />
      )}
    </div>
  );
}
