"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { emptyResume, isEmptyResume, normalizeResume, reconcileIds, uid } from "@/lib/resume";
import { dbErrorMessage, isUniqueViolation } from "@/lib/db";
import { mergeResumes, sameJson, saveMasterDocument, type MergeConflict } from "@/lib/master";
import { PAGE_DEFAULTS } from "@/lib/doc/types";
import type { Fact, Resume } from "@/lib/types";
import { ResumeDocument } from "@/components/ResumeDocument";
import { EMPTY_FORMAT_STATE, type DocCommands, type DocSelection, type FormatState } from "@/components/editorTypes";
import { EditMenu, FormatMenu } from "@/components/FormatMenus";
import { CoachPanel } from "@/components/CoachPanel";
import { SideTabs } from "@/components/SideTabs";
import { insertCoachedBullet, type CoachTarget } from "@/lib/coaching";
import { useResumeActions } from "@/components/ResumeActions";
import {
  countWords, DocToolbar, EDIT_SHORTCUTS, EditorToolbar, IconButton, MenuBar, MenuBarMenu, StatusBar, ToolbarSep,
  useEditorShortcuts, useZoom, ZoomSelect,
} from "@/components/DocToolbar";
import { MenuItem, MenuSeparator } from "@/components/Menu";
import { PageSetupDialog } from "@/components/PageSetupDialog";
import { EditorCanvas } from "@/components/ZoomFrame";
import { CopyIcon, DocIcon, DownloadIcon } from "@/components/icons";
import { ResumeImport } from "@/components/ResumeImport";
import { FactsPanel } from "@/components/FactsPanel";
import { Builder } from "@/components/Builder";
import { Onboarding } from "@/components/Onboarding";
import { UndoToast } from "@/components/UndoToast";
import { useFacts } from "@/lib/useFacts";
import { importedBulletFacts, plural } from "@/lib/facts";
import { SaveErrorToast, SaveStatus, useAutosaveWithRetry } from "@/lib/useAutosave";

/** Re-import keeps bullet ids stable (so jobs' "changes vs master" and linked facts stay right). */
const mergeImport = (prev: Resume, imported: Resume): Resume => reconcileIds(prev, normalizeResume(imported));

/** The editing tips, shown as the Help menu's hint (the document itself stays uncluttered). */
const EDIT_TIPS =
  "Type anywhere, like a normal document: Enter starts a new paragraph, Backspace joins. Select text and use the toolbar " +
  "or Format menu for bold, italic, underline, size, alignment and lists. The AI reads your bullets from the document's " +
  "lists and bold section headings. Undo with Ctrl/⌘+Z.";

/** Zoom choices for View > Zoom (0 = Fit). */
const ZOOM_CHOICES: { label: string; value: number }[] = [
  { label: "Fit", value: 0 },
  { label: "50%", value: 0.5 },
  { label: "75%", value: 0.75 },
  { label: "90%", value: 0.9 },
  { label: "100%", value: 1 },
  { label: "125%", value: 1.25 },
  { label: "150%", value: 1.5 },
];

/** Printer glyph (same 24px stroke style as ./icons; there is no printer icon there). */
function PrintIcon({ className }: { className?: string }) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M7 9V4h10v5" /><rect x="4" y="9" width="16" height="7" rx="1.5" /><path d="M7 14h10v6H7z" />
    </svg>
  );
}

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
  /** The master resume. Undo lives in the editor (its own history), so the page keeps plain state. */
  const [resume, setResume] = useState<Resume | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [justImported, setJustImported] = useState(false);
  const [measure, setMeasure] = useState({ pages: 1, overflowLines: 0 });
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [commentEl, setCommentEl] = useState<HTMLDivElement | null>(null);
  /** The document's commands (bold, italic, reset, set a line's style) for the Format menu. */
  const commandsRef = useRef<DocCommands | null>(null);
  /** Formatting state of the caret's line (drives the Format menu's check marks and enabled states). */
  const [formatState, setFormatState] = useState<FormatState>(EMPTY_FORMAT_STATE);
  const [zoom, setZoom] = useZoom("resume");
  const facts = useFacts(supabase);
  const mirrorRef = useRef(facts.mirror);
  mirrorRef.current = facts.mirror;
  /** "Fact deleted · Undo" */
  const [undo, setUndo] = useState<{ message: string; restore: Fact[] } | null>(null);
  /** The entry or bullet the coaching panel is about (follows the selection; "Back" clears it). */
  const [coachTarget, setCoachTarget] = useState<CoachTarget | null>(null);
  const [coachStart, setCoachStart] = useState<"questions" | undefined>(undefined);
  const [sideTab, setSideTab] = useState<"coach" | "facts">("coach");
  // Print and save shortcuts, and the File/toolbar actions. Hooks run before the early returns below.
  useEditorShortcuts({ onPrint: () => window.print(), onSave: () => {} });
  const actions = useResumeActions(resume ?? emptyResume(), `${resume?.header.name ?? ""} Resume`);
  /** Onboarding: "I don't have a resume yet" opens the builder. */
  const [building, setBuilding] = useState(false);
  /** Entry ids of a resume the builder just made (for "Go deeper"). */
  const [built, setBuilt] = useState<string[] | null>(null);
  const [email, setEmail] = useState("");
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
        setResume(content);
      },
      (e: { code?: string; message?: string }) => {
        console.error("Loading the master resume failed:", e);
        setError(dbErrorMessage(e, "load"));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The account email prefills the builder's contact details.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""), () => {});
  }, [supabase]);

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
          setResume((cur) => (!cur ? cur : cur === r ? out.content : mergeResumes(r, cur, out.content).merged));
          setNotice("Merged changes made on another device.");
        }
      }
      // Same save: facts linked to master bullets follow their bullet's text (or become standalone when
      // the bullet is emptied or deleted). Throws on failure, so autosave retries this step too.
      await mirrorRef.current(id, base.current.content);
    },
    [id, supabase],
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
    setResume(next.content);
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
    setResume({ ...merged }); // a new value, so autosave runs
  }

  if (error && !resume) return <p className="text-bad">{error}</p>;
  if (!resume) return <p className="text-muted">Loading…</p>;

  const empty = isEmptyResume(resume);
  const factCount = facts.facts.length;
  const onImported = (r: Resume) => {
    const next = mergeImport(resume, r);
    setResume(next);
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
    setResume(next);
    return bulletId;
  };
  /** The builder's draft becomes the master; its "what did you do" answers are already facts. */
  const onBuilt = (r: Resume, saved: Fact[], entryIds: string[]) => {
    setResume(normalizeResume(r));
    facts.absorb(saved);
    setBuilding(false);
    setBuilt(entryIds);
  };
  /** "Go deeper" on a built experience: the coaching questions for that entry. */
  const goDeeper = (sectionId: string, entryId: string) => {
    setCoachTarget({ sectionId, entryId, bulletId: null });
    setCoachStart("questions");
    setSideTab("coach");
    document.getElementById("side-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const deleteFact = async (f: Fact) => {
    if (await facts.remove([f.id])) setUndo({ message: "Fact deleted", restore: [f] });
  };
  const onboarding = empty && !importOpen;
  const banners = (
    <>
      {built && (
        <section aria-labelledby="built-heading" className="space-y-2 rounded-lg border border-border bg-surface p-4">
          <h2 id="built-heading" className="text-sm font-medium">Your first draft is ready.</h2>
          <p className="text-sm text-muted">
            It uses only what you told us. Replace each [placeholder] with a real number, or go deeper on an experience:
            a few quick questions help you find numbers worth adding.
          </p>
          <div className="flex flex-wrap gap-2">
            {built
              .map((eid) => resume.sections.flatMap((sec) => sec.items.map((it) => ({ sec, it }))).find((x) => x.it.id === eid))
              .filter((x): x is NonNullable<typeof x> => !!x)
              .map(({ sec, it }) => (
                <button key={it.id} type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={() => goDeeper(sec.id, it.id)}>
                  Go deeper: {it.title || "this experience"}
                </button>
              ))}
            <Link href="/" className="btn btn-sm btn-primary min-h-10 sm:min-h-0">Next: add a job →</Link>
            <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={() => setBuilt(null)}>Dismiss</button>
          </div>
        </section>
      )}
      {justImported && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface p-4">
          <div className="min-w-48 flex-1">
            <p className="text-sm font-medium">Step 1 done — your master resume is ready.</p>
            <p className="text-xs text-muted">Check it below, then add the first job you want to tailor it for.</p>
          </div>
          <Link href="/" className="btn btn-sm btn-primary w-full sm:w-auto">Next: add a job →</Link>
        </div>
      )}
      {importOpen && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <ResumeImport replaceWarning onImported={onImported} onCancel={() => setImportOpen(false)} />
        </div>
      )}
      {(error || actions.error) && <p role="alert" className="px-1 text-sm text-bad">{error || actions.error}</p>}
      {notice && <p role="status" className="px-1 text-sm text-good">{notice}</p>}
    </>
  );

  return (
    <div className="flex flex-col lg:h-full lg:min-h-0">
      <DocToolbar>
        <h1 className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-normal text-muted">
          <DocIcon className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Master resume</span>
          <span className="sr-only sm:hidden">Master resume</span>
        </h1>
        {/* Phones: the menus wrap onto a second line and get smaller padding, so each popup stays on screen. */}
        <div className="ml-1 flex min-w-0 items-center whitespace-normal sm:whitespace-nowrap [&>div]:gap-0 [&_button[aria-haspopup]]:px-1.5 [&_[role=menu]]:min-w-36 sm:[&>div]:gap-0.5 sm:[&_button[aria-haspopup]]:px-2 sm:[&_[role=menu]]:min-w-56">
          <MenuBar>
            <MenuBarMenu label="File">
              <MenuItem onSelect={() => void actions.download()} disabled={actions.busy} hint="Your resume as a PDF, ready to send">
                Download PDF
              </MenuItem>
              <MenuItem onSelect={() => void actions.copy()}>Copy as text</MenuItem>
              <MenuItem onSelect={() => window.print()} shortcut="Ctrl+P">Print…</MenuItem>
              <MenuItem onSelect={() => setPageSetupOpen(true)} disabled={!resume} hint="Margins of every page">
                Page setup…
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={() => setImportOpen((o) => !o)}>Re-import resume</MenuItem>
            </MenuBarMenu>
            <EditMenu commandsRef={commandsRef} fmt={formatState} />
            <MenuBarMenu label="View">
              {ZOOM_CHOICES.map((z) => (
                <MenuItem key={z.value} onSelect={() => setZoom(z.value)}>
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden="true" className="inline-block w-3">{zoom === z.value ? "✓" : ""}</span>
                    {z.label}
                    {zoom === z.value && <span className="sr-only">(current)</span>}
                  </span>
                </MenuItem>
              ))}
            </MenuBarMenu>
            <FormatMenu commandsRef={commandsRef} fmt={formatState} />
            <MenuBarMenu label="Help">
              <MenuItem onSelect={() => {}} hint={EDIT_TIPS}>Editing tips</MenuItem>
              <MenuItem onSelect={() => {}} hint={EDIT_SHORTCUTS}>Keyboard shortcuts</MenuItem>
            </MenuBarMenu>
          </MenuBar>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {/* Phones: the status gets whatever room the menus leave and truncates, so it never covers Help. */}
          <span className="block min-w-0 max-w-[72px] overflow-hidden text-right sm:max-w-none [&>span]:block [&>span]:truncate">
            <SaveStatus status={conflict ? "error" : status} />
          </span>
          <a
            href="#side-panel"
            className="hidden rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg sm:inline-flex lg:hidden"
            onClick={() => setSideTab("facts")}
          >
            Facts ({factCount})
          </a>
        </div>
      </DocToolbar>

      {!empty && (
        <EditorToolbar>
          <IconButton label="Print (Ctrl/⌘+P)" onClick={() => window.print()}>
            <PrintIcon />
          </IconButton>
          <ZoomSelect value={zoom} onChange={setZoom} />
          <ToolbarSep />
          <div ref={setSlot} className="flex items-center" />
          <ToolbarSep />
          <IconButton label={actions.copied ? "Copied" : "Copy as text"} onClick={() => void actions.copy()}>
            <CopyIcon />
          </IconButton>
          <IconButton label={actions.busy ? "Building PDF…" : "Download PDF"} onClick={() => void actions.download()} disabled={actions.busy}>
            <DownloadIcon />
          </IconButton>
        </EditorToolbar>
      )}

      <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:flex-row">
        {/* Document column: grey Docs canvas (scrolls on lg+), status bar pinned at its bottom. */}
        <div className="flex min-w-0 flex-1 flex-col lg:min-h-0">
          {onboarding ? (
            <div className="mx-auto w-full max-w-[860px] space-y-3 px-4 pb-6 pt-4 sm:px-8">
              {building ? (
                <Builder email={email} onBuilt={onBuilt} onCancel={() => setBuilding(false)} />
              ) : (
                <Onboarding onImported={onImported} onBuild={() => setBuilding(true)} />
              )}
            </div>
          ) : (
            <>
              {/* Banners sit above the canvas, unscaled, in the page's column. */}
              <div className="mx-auto w-full max-w-[816px] shrink-0 space-y-3 px-4 pt-4 empty:hidden">{banners}</div>
              <EditorCanvas zoom={zoom} className="min-w-0 flex-1 pb-6 lg:min-h-0 lg:overflow-auto">
                <ResumeDocument
                  value={resume}
                  onChange={setResume}
                  onMeasure={setMeasure}
                  actionsSlot={slot}
                  commentSlot={commentEl}
                  onSelectionChange={onSelection}
                  commandsRef={commandsRef}
                  onFormatStateChange={setFormatState}
                />
              </EditorCanvas>
              {!empty && (
                <StatusBar
                  pages={measure.pages}
                  words={countWords(resume)}
                  zoom={zoom}
                  onZoom={setZoom}
                />
              )}
            </>
          )}
        </div>

        {/* Side panel: hairline divider on lg+, its own scroll. Phones: stacked below the document. */}
        <div
          id="side-panel"
          className="scroll-mt-16 space-y-4 border-t border-border p-4 lg:relative lg:w-[340px] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0"
        >
          {/* The selected bullet's comment card. Takes no room in flow: a bottom sheet on phones, an overlay on the panel on lg+. */}
          <div
            ref={setCommentEl}
            className="empty:hidden fixed inset-x-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 max-h-[45dvh] overflow-y-auto lg:absolute lg:inset-x-4 lg:bottom-auto lg:top-4 lg:z-20 lg:max-h-[70%]"
          />
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
              <section className="space-y-2" aria-labelledby="coach-intro">
                <h2 id="coach-intro" className="text-sm font-medium">Coach</h2>
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

      {pageSetupOpen && resume && (
        <PageSetupDialog
          page={resume.page ?? PAGE_DEFAULTS}
          onApply={(page) => setResume((cur) => (cur ? { ...cur, page } : cur))}
          onClose={() => setPageSetupOpen(false)}
        />
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
