"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  bulletTextMap, countChangedBullets, emptyResume, isEmptyResume, normalizeResume, resumeToPlainText, uid,
} from "@/lib/resume";
import type { Analysis, Fact, Job, JobStatus, Resume } from "@/lib/types";
import { friendlyError, postApi } from "@/lib/api";
import { countPlaceholders, hasPlaceholder, plural } from "@/lib/facts";
import { fitOf } from "@/lib/fit";
import {
  bulletFeedback, carryClientState, findPlaceholder, missingAnswerFacts, normalizeAnalysis, planFill, saveAnswersInOrder,
} from "@/lib/analysis";
import { snapshotPatch } from "@/lib/outcomes";
import { applyStatusChange } from "@/lib/status";
import { isUniqueViolation, MIGRATION_HINT, OPTIONAL_JOB_COLUMNS } from "@/lib/db";
import { sameJson, updateMaster, type MergeConflict } from "@/lib/master";
import { factListWriter, unlinkResumeFacts } from "@/lib/factStore";
import { useFacts } from "@/lib/useFacts";
import {
  addAllFromMaster, addFromMaster, applyPull, cloneForJob, compareMap, dismissAdditions, ensureBaseline, planPull,
  replaceBullet, resolveRemoval, stripBaseline, type PullAddition, type PullRemoval,
} from "@/lib/tailor";
import {
  applySaveAsMaster, baselineAfterMasterSave, carryDrafts, freezesSnapshot, isApplied, jobFromRow, jobPatch, mergeTailored,
  planSaveAsMaster, planTailoredRefresh, readJob, rebaseJob, saveTailoredDocument, statusConflictOutcome, tailoredFromRow,
  writeJobIfUnchanged, type SaveAsMasterPlan,
} from "@/lib/jobSync";
import { ResumeDocument } from "@/components/ResumeDocument";
import { EMPTY_FORMAT_STATE, type DocCommands, type DocSelection, type FormatState } from "@/components/editorTypes";
import { EditMenu, FormatMenu } from "@/components/FormatMenus";
import { JobHeader } from "@/components/job/JobHeader";
import { AppliedNotice } from "@/components/job/AppliedNotice";
import { CoverLetterTab, PostingTab } from "@/components/job/JobTabs";
import { CoachPanel } from "@/components/CoachPanel";
import { PriorityList } from "@/components/PriorityList";
import { FactsPanel } from "@/components/FactsPanel";
import { SideTabs } from "@/components/SideTabs";
import { UndoToast } from "@/components/UndoToast";
import { insertCoachedBullet, priorityItems, type CoachTarget } from "@/lib/coaching";
import { progressFields } from "@/lib/progress";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { StatusSelect, FitBadge } from "@/components/StatusSelect";
import {
  countWords, DocToolbar, EDIT_SHORTCUTS, EditorToolbar, FeedbackLegend, IconButton, MenuBar, MenuBarMenu, PageCount,
  PlaceholderCount, StatusBar, Toggle, ToolbarSep, useEditorShortcuts, useZoom, ZoomSelect,
} from "@/components/DocToolbar";
import { EditorCanvas } from "@/components/ZoomFrame";
import { BriefcaseIcon, ChevronRightIcon } from "@/components/icons";
import { MenuItem, MenuSeparator } from "@/components/Menu";
import { SubmittedView } from "@/components/SubmittedView";
import { PullBanner, SaveAsMasterDialog, TailoredConflictBanner } from "@/components/PullBanner";
import { FlashToast } from "@/components/FlashToast";
import { confirmPlaceholders, downloadResumePdf, resumeTexts } from "@/components/pdfDownload";
import { SaveErrorToast, SaveStatus, useAutosaveWithRetry, worstStatus } from "@/lib/useAutosave";

type Tab = "resume" | "analysis" | "job" | "cover";
type Question = Analysis["questions"][number];
type Flash = { message: string; action?: { label: string; onClick: () => void } | null };
type Conflict = { server: Resume; serverUpdatedAt: string; conflicts: MergeConflict[] };

/** [key, phone label, desktop label] */
const TABS: [Tab, string, string][] = [
  ["resume", "Resume", "Tailored resume"],
  ["analysis", "Analysis", "Analysis"], // phones/tablets only; desktop shows it in the sidebar
  ["job", "Posting", "Job posting"],
  ["cover", "Letter", "Cover letter"],
];

/** Don't re-read the rows again when `focus` and `visibilitychange` fire together. */
const REFRESH_GAP_MS = 1500;

/** View > Zoom choices, in the order of the zoom picker (0 = Fit). */
const ZOOM_CHOICES: [number, string][] = [[0, "Fit"], [0.5, "50%"], [0.75, "75%"], [0.9, "90%"], [1, "100%"], [1.25, "125%"], [1.5, "150%"]];

/** A check mark in a fixed-width cell, so the labels of ticked and unticked menu items line up. */
/** Help > Editing tips: how the document edits, and how the coaching panel follows the caret. */
const EDITING_TIPS =
  "Click a bullet to see its feedback and suggested edits. Type anywhere, like a normal document: Enter starts a new " +
  "paragraph, Backspace joins. Select text and use the toolbar or Format menu for bold, italic, underline, size, " +
  "alignment and lists. The AI reads your bullets from the document's lists and bold section headings. Undo with Ctrl/⌘+Z.";

const tick = (on: boolean) => <span className="inline-block w-3 shrink-0 text-center">{on ? "✓" : ""}</span>;

const PrintIcon = ({ className }: { className?: string }) => (
  <svg
    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}
  >
    <path d="M7 9V3h10v6" /><rect x="4" y="9" width="16" height="8" rx="2" /><path d="M7 14h10v7H7z" />
  </svg>
);

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [job, setJobState] = useState<Job | null>(null);
  /** The tailored copy. Undo lives in the editor (its own history), so the page keeps plain state. */
  const [resume, setResume] = useState<Resume | null>(null);
  const [master, setMaster] = useState<Resume | null>(null);
  /** Bullet texts when the page loaded: stand-in for `original` on analyses saved before it existed. */
  const [loadedTexts, setLoadedTexts] = useState<Map<string, string> | null>(null);
  /** The master is empty, so there's nothing to tailor yet. */
  const [needsMaster, setNeedsMaster] = useState(false);
  const [tab, setTab] = useState<Tab>("resume");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [writing, setWriting] = useState(false);
  const [coverError, setCoverError] = useState("");
  const [showFeedback, setShowFeedback] = useState(true);
  const [measure, setMeasure] = useState({ pages: 1, overflowLines: 0 });
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  /** Side-panel slot for the selected bullet's comment card (like a Docs comment). */
  const [commentEl, setCommentEl] = useState<HTMLDivElement | null>(null);
  /** Document zoom (0 = Fit), remembered per document. */
  const [zoom, setZoom] = useZoom("job");
  useEditorShortcuts({ onPrint: () => window.print(), onSave: () => {} });
  /** Page-level problem, always plain language. Cleared by the next successful action or a tab change. */
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [migrationHint, setMigrationHint] = useState(false);
  const [flash, setFlash] = useState<Flash>({ message: "" });
  const [reveal, setReveal] = useState<{ id: string; n: number } | null>(null);
  const [viewingSubmitted, setViewingSubmitted] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** What's typed in each answer box (by question id). Lives here so a re-analysis or a merge can carry it over. */
  const [drafts, setDraftsState] = useState<Record<string, string>>({});
  /** Both devices changed the same line of the tailored copy: its autosave is paused until the user picks a side. */
  const [conflict, setConflictState] = useState<Conflict | null>(null);
  const [resolving, setResolving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  /** "Save this tailored copy as my master resume" confirmation. */
  const [saveMaster, setSaveMaster] = useState<{ plan: SaveAsMasterPlan; copy: Resume } | null>(null);
  const [saveMasterBusy, setSaveMasterBusy] = useState(false);
  /** After applying: the tailoring tools are folded away unless this is on ("Keep editing (for a re-apply)"). */
  const [reapply, setReapply] = useState(false);
  /** The student's facts (migration 0005): answers are saved here; facts coached on this page follow its bullets. */
  const facts = useFacts(supabase);
  const mirrorRef = useRef(facts.mirror);
  mirrorRef.current = facts.mirror;
  /** The entry or bullet the coaching panel is about (follows the document's selection; "Back" clears it). */
  const [coachTarget, setCoachTarget] = useState<CoachTarget | null>(null);
  const [sideTab, setSideTab] = useState<"coach" | "facts">("coach");
  /** This job's tailored copy's row id (facts coached here link to it). */
  const [tailoredId, setTailoredId] = useState<string | null>(null);
  const [factUndo, setFactUndo] = useState<Fact | null>(null);
  /** Imperative document commands (formatting, undo and redo) for the toolbar and menus. */
  const commandsRef = useRef<DocCommands | null>(null);
  /** Formatting state of the caret's line (drives the Format menu's check marks and enabled states). */
  const [formatState, setFormatState] = useState<FormatState>(EMPTY_FORMAT_STATE);

  const autoRan = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The job as on screen, always current (async saves and merges read it, so they never act on an old render). */
  const jobRef = useRef<Job | null>(null);
  /**
   * The job row as this tab last loaded or saved it: the base for "which fields did this tab change"
   * and for merging the analysis. Every job write is conditional on `jobVersion` (its updated_at).
   */
  const lastSaved = useRef<Job | null>(null);
  const jobVersion = useRef("");
  /** The tailored copy as last loaded or saved here, with its updated_at (merge base; saves are conditional on it). */
  const resumeBase = useRef<{ content: Resume; updatedAt: string } | null>(null);
  /** The tailored copy as on screen, always current (see jobRef). */
  const docLatest = useRef<Resume | null>(null);
  docLatest.current = resume;
  const resumeIdRef = useRef<string | null>(null);
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const conflictRef = useRef<Conflict | null>(null);
  /** Optional columns (migrations 0002/0003) this database doesn't have: never write them. */
  const missingCols = useRef<Set<string>>(new Set());
  const hintShown = useRef(false);
  /** Every read-merge-write of this page's rows runs one at a time, in order. */
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const lastRefresh = useRef(0);

  const serial = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.current.catch(() => {}).then(fn);
    chain.current = run.catch(() => {});
    return run;
  }, []);

  /** Every change to the job goes through here, so jobRef is never behind the screen. */
  const updateJob = useCallback((fn: (j: Job) => Job) => {
    const cur = jobRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    jobRef.current = next;
    setJobState(next);
  }, []);
  const setDrafts = useCallback((d: Record<string, string>) => {
    draftsRef.current = d;
    setDraftsState(d);
  }, []);
  /** Show a new tailored copy (from a merge or another device) and keep docLatest in step. */
  const showDoc = useCallback(
    (r: Resume) => {
      docLatest.current = r;
      setResume(r);
    },
    [],
  );
  const setConflict = useCallback((c: Conflict | null) => {
    conflictRef.current = c;
    setConflictState(c);
  }, []);

  const fail = useCallback((e: unknown, fallback: string) => {
    console.warn(fallback, e);
    setError(friendlyError(e, fallback));
  }, []);

  /** A successful action: say so briefly (as a toast) and clear any earlier error. */
  const showFlash = useCallback((message: string, ms = 3500, action?: Flash["action"]) => {
    setError("");
    setFlash({ message, action });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash({ message: "" }), ms);
  }, []);

  const showHint = useCallback(() => {
    if (hintShown.current) return;
    hintShown.current = true;
    setMigrationHint(true);
  }, []);

  // ---------- load ----------

  useEffect(() => {
    (async () => {
      const [{ data: j, error: e1 }, { data: r, error: eR }, { data: m, error: eM }] = await Promise.all([
        supabase.from("jobs").select("*").eq("id", id).maybeSingle(),
        supabase.from("resumes").select("id, content, updated_at").eq("job_id", id).maybeSingle(),
        supabase.from("resumes").select("content").eq("is_master", true).maybeSingle(),
      ]);
      const loadFail = (e: unknown, fallback: string) => {
        setLoadFailed(true);
        fail(e, fallback);
      };
      if (e1 || eR || eM) return loadFail(e1 ?? eR ?? eM, "Couldn't load this job.");
      if (!j) return loadFail(null, "This job doesn't exist anymore. It may have been deleted.");
      const masterResume = m ? normalizeResume(m.content) : emptyResume();
      const masterEmpty = isEmptyResume(masterResume);
      const loaded = jobFromRow(j);
      for (const c of OPTIONAL_JOB_COLUMNS) if (!(c in j)) missingCols.current.add(c);
      lastSaved.current = loaded;
      jobVersion.current = loaded.updated_at;
      jobRef.current = loaded;
      setMaster(masterResume);
      setJobState(loaded);
      setDrafts(loaded.analysis?.answers ?? {});

      const open = async (row: { id: string; content: unknown; updated_at: string }) => {
        resumeIdRef.current = row.id;
        setTailoredId(row.id);
        const stored = tailoredFromRow(row.content);
        resumeBase.current = { content: stored, updatedAt: row.updated_at };
        let start: Resume;
        let selfHeal = false;
        if (!isEmptyResume(stored)) {
          // Copies made before baselines existed start tracking master changes from now.
          start = masterEmpty ? stored : ensureBaseline(stored, masterResume).resume;
        } else {
          if (masterEmpty) return setNeedsMaster(true);
          // Self-heal: this copy was made before the master had content. Start it over from the master.
          start = cloneForJob(masterResume);
          selfHeal = true;
        }
        setLoadedTexts(bulletTextMap(start));
        showDoc(start);
        if (start !== stored) {
          // Saved like any other edit: only if nobody changed the row since we read it (else merged).
          persistResume().catch((e) =>
            selfHeal ? loadFail(e, "Couldn't set up this job's tailored copy.") : console.warn("Couldn't store the baseline:", e),
          );
        }
      };

      if (r) return open(r);
      // Never create a tailored copy from an empty master; that copy would be a dead end.
      if (masterEmpty) return setNeedsMaster(true);
      // First visit: this job's tailored copy starts as a clone of the master (same bullet ids, so changes can be tracked).
      const { data: created, error: e2 } = await supabase
        .from("resumes")
        .insert({ job_id: id, name: `${j.company} ${j.title}`.trim(), content: cloneForJob(masterResume) })
        .select("id, content, updated_at")
        .single();
      if (created && !e2) return open(created);
      if (!isUniqueViolation(e2)) return loadFail(e2, "Couldn't create this job's tailored copy.");
      // Another tab (or a double render) created it first: use that one.
      const { data: again, error: e4 } = await supabase.from("resumes").select("id, content, updated_at").eq("job_id", id).single();
      if (e4 || !again) return loadFail(e4, "Couldn't load this job's tailored copy.");
      return open(again);
    })().catch((e) => {
      setLoadFailed(true);
      fail(e, "Couldn't load this job.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---------- conflict-safe saves ----------

  /**
   * Bring a re-read job row onto the screen: fields this tab changed and hasn't saved yet stay (they're
   * saved on top next), everything else shows the row as it is now, and the analysis is merged (answers
   * saved on another device are never dropped). Unsaved answer drafts stay in their boxes.
   * Must run inside `serial`. Returns true when anything visible changed.
   */
  const applyServerJob = useCallback(
    (server: Job): boolean => {
      const base = lastSaved.current;
      const local = jobRef.current;
      if (!base || !local) return false;
      let next = rebaseJob(local, base, server);
      lastSaved.current = server;
      jobVersion.current = server.updated_at;
      if (!sameJson(local.analysis, next.analysis)) {
        const carried = carryDrafts(local.analysis, next.analysis, draftsRef.current);
        if (carried.analysis !== next.analysis) next = { ...next, analysis: carried.analysis };
        setDrafts(carried.drafts);
      }
      const visible = !sameJson({ ...local, updated_at: "" }, { ...next, updated_at: "" });
      updateJob(() => next);
      return visible;
    },
    [updateJob, setDrafts],
  );

  /**
   * Save the job's changed fields (and analysis), conditional on its updated_at. If another device saved
   * in between: re-read, merge (applyServerJob) and write this tab's changes again on top.
   */
  const persistJob = useCallback(
    () =>
      serial(async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const cur = jobRef.current;
          const base = lastSaved.current;
          if (!cur || !base) return;
          const patch = jobPatch(base, cur);
          if (!Object.keys(patch).length) return;
          const out = await writeJobIfUnchanged(supabase, id, patch, jobVersion.current, missingCols.current);
          if (out.droppedColumns) showHint();
          if (out.kind === "saved") {
            jobVersion.current = out.updatedAt;
            lastSaved.current = { ...base, ...patch };
            return;
          }
          const server = await readJob(supabase, id);
          if (!server) throw new Error("This job was deleted on another device.");
          applyServerJob(server);
        }
        throw new Error("This job kept changing on another device while saving. We'll keep retrying.");
      }),
    [serial, supabase, id, showHint, applyServerJob],
  );
  const saveJob = useCallback(() => persistJob(), [persistJob]);
  const jobSave = useAutosaveWithRetry(job, saveJob, 500);

  /**
   * Save the tailored copy, conditional on its updated_at. If another device saved in between,
   * three-way merge and save the merge ("Merged changes from another device."); if both changed the
   * same line, stop and ask (the conflict banner).
   */
  const persistResume = useCallback(
    () =>
      serial(async () => {
        const rid = resumeIdRef.current;
        const base = resumeBase.current;
        const local = docLatest.current;
        if (!rid || !base || !local || conflictRef.current) return;
        if (!sameJson(local, base.content)) {
          const out = await saveTailoredDocument(supabase, rid, local, base);
          if (out.kind === "conflict") {
            setConflict({ server: out.server, serverUpdatedAt: out.serverUpdatedAt, conflicts: out.conflicts });
            return;
          }
          resumeBase.current = { content: out.content, updatedAt: out.updatedAt };
          if (out.merged) {
            // Edits typed while the save was in flight are merged on top (base = what was sent).
            const cur = docLatest.current ?? local;
            showDoc(cur === local ? out.content : mergeTailored(local, cur, out.content).merged);
            showFlash("Merged changes from another device.", 5000);
          }
        }
        // Same save: facts coached on this copy's bullets follow their text (standalone once a bullet is
        // emptied or deleted). Throws on failure, so the autosave retries this step too.
        await mirrorRef.current(rid, (resumeBase.current ?? base).content);
      }),
    [serial, supabase, setConflict, showDoc, showFlash],
  );
  const saveResume = useCallback(() => persistResume(), [persistResume]);
  const resumeSave = useAutosaveWithRetry(resume, saveResume);

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

  /** Conflict choice: drop this tab's unsaved edits to the copy and show the version saved on the other device. */
  async function reloadTheirs() {
    const c = conflictRef.current;
    const rid = resumeIdRef.current;
    if (!c || !rid) return;
    setResolving(true);
    try {
      await serial(async () => {
        let next = { content: c.server, updatedAt: c.serverUpdatedAt };
        const { data } = await supabase.from("resumes").select("content, updated_at").eq("id", rid).maybeSingle();
        if (data) next = { content: tailoredFromRow(data.content), updatedAt: (data as { updated_at: string }).updated_at };
        resumeBase.current = next;
        setConflict(null);
        showDoc(next.content);
      });
      showFlash("Loaded the version saved on your other device.");
    } finally {
      setResolving(false);
    }
  }

  /** Conflict choice: keep this tab's version of the conflicting lines (their other changes are kept too) and save it. */
  function keepMine() {
    const c = conflictRef.current;
    const base = resumeBase.current;
    const local = docLatest.current;
    if (!c || !base || !local) return;
    const { merged } = mergeTailored(base.content, local, c.server);
    resumeBase.current = { content: c.server, updatedAt: c.serverUpdatedAt };
    setConflict(null);
    showDoc({ ...merged }); // a new value, so autosave writes it (on top of their version)
  }

  const saveState = conflict ? "error" : worstStatus(jobSave.status, resumeSave.status);
  const { retry: retryJob } = jobSave;
  const { retry: retryResume } = resumeSave;
  const retrySaves = useCallback(() => {
    retryJob();
    retryResume();
  }, [retryJob, retryResume]);

  // ---------- refresh when the tab comes back (phone unlocked, laptop tab focused) ----------

  const refresh = useCallback(async () => {
    if (!lastSaved.current || !jobRef.current) return;
    const now = Date.now();
    if (now - lastRefresh.current < REFRESH_GAP_MS) return;
    lastRefresh.current = now;
    const base = resumeBase.current;
    const dirty =
      Object.keys(jobPatch(lastSaved.current, jobRef.current)).length > 0 ||
      (!!base && !!docLatest.current && !sameJson(docLatest.current, base.content));
    if (dirty) {
      // Save what's pending first; the re-read below then merges anything still unsaved.
      retryJob();
      retryResume();
      await new Promise((r) => setTimeout(r, 0));
    }
    try {
      const changed = await serial(async () => {
        const rid = resumeIdRef.current;
        const [server, row, m] = await Promise.all([
          readJob(supabase, id),
          rid ? supabase.from("resumes").select("content, updated_at").eq("id", rid).maybeSingle() : Promise.resolve(null),
          supabase.from("resumes").select("content").eq("is_master", true).maybeSingle(),
        ]);
        let visible = false;
        if (!server) {
          setError("This job was deleted on another device.");
          return false;
        }
        if (server.updated_at !== jobVersion.current) visible = applyServerJob(server) || visible;
        const rb = resumeBase.current;
        const local = docLatest.current;
        if (row?.data && rb && local && !conflictRef.current) {
          const s = row.data as { content: unknown; updated_at: string };
          const server2 = tailoredFromRow(s.content);
          const plan = planTailoredRefresh(rb, local, { content: server2, updatedAt: s.updated_at });
          if (plan.kind === "replace") {
            resumeBase.current = { content: server2, updatedAt: s.updated_at };
            showDoc(plan.content);
            visible = true;
          } else if (plan.kind === "merge") {
            resumeBase.current = { content: server2, updatedAt: s.updated_at };
            showDoc(plan.content); // autosave writes the merge
            visible = true;
          } else if (plan.kind === "conflict") {
            setConflict({ server: server2, serverUpdatedAt: s.updated_at, conflicts: plan.conflicts });
          } else if (s.updated_at !== rb.updatedAt) {
            resumeBase.current = { content: rb.content, updatedAt: s.updated_at };
          }
        }
        if (m.data) {
          const fresh = normalizeResume(m.data.content);
          setMaster((cur) => (cur && sameJson(cur, fresh) ? cur : fresh));
        }
        return visible;
      });
      if (changed) showFlash("Updated with changes from your other device.");
    } catch (e) {
      console.warn("Refreshing the job failed:", e);
    }
  }, [serial, supabase, id, applyServerJob, showDoc, setConflict, showFlash, retryJob, retryResume]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    const onFocus = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // ---------- derived ----------

  const analysis = job?.analysis ?? null;
  const fit = fitOf(analysis);
  const applied = !!job && isApplied(job);
  // Every new "applied" state starts quiet; undoing Applied restores the normal page.
  const [appliedSeen, setAppliedSeen] = useState(applied);
  if (applied !== appliedSeen) {
    setAppliedSeen(applied);
    setReapply(false);
  }
  const quiet = applied && !reapply;
  const feedback = useMemo(() => bulletFeedback(analysis, resume, loadedTexts), [analysis, resume, loadedTexts]);
  // Document order, for "Review" and "Accept all". Stale or rejected suggestions are already left out.
  const pending = useMemo(() => {
    if (!resume || quiet) return [];
    return [...bulletTextMap(resume).keys()].filter((bid) => feedback[bid]?.suggestion).map((bid) => ({ id: bid, rewrite: feedback[bid].suggestion }));
  }, [resume, feedback, quiet]);
  const baseline = resume?.baseline;
  const compareTo = useMemo(() => compareMap(baseline, master), [baseline, master]);
  const changedCount = useMemo(() => (resume && compareTo ? countChangedBullets(resume, compareTo) : 0), [resume, compareTo]);
  const pull = useMemo(() => planPull(resume, master), [resume, master]);
  const placeholderCount = useMemo(() => (resume ? countPlaceholders(resumeTexts(resume)) : 0), [resume]);
  const factTexts = useMemo(() => facts.facts.map((f) => f.text), [facts.facts]);
  const priority = useMemo(() => (resume && !quiet ? priorityItems(resume, feedback) : []), [resume, feedback, quiet]);

  // Tailoring progress for the dashboard (migration 0006), saved with the job's other fields through
  // the same conditional autosave. Not while applied (the suggestions are folded away then).
  useEffect(() => {
    if (!job || !resume || quiet) return;
    const next = progressFields(analysis, pending.length);
    if ((job.suggestions_total ?? null) === next.suggestions_total && (job.suggestions_pending ?? null) === next.suggestions_pending) return;
    updateJob((j) => ({ ...j, ...next }));
  }, [job, resume, quiet, analysis, pending.length, updateJob]);
  const missingFacts = useMemo(
    () =>
      analysis && facts.status === "ready" ? missingAnswerFacts(analysis.questions, analysis.answers, factTexts, analysis.bullets) : [],
    [analysis, factTexts, facts.status],
  );

  // The latest values, for async work that finishes later (an analysis takes 20-60s; drafts typed meanwhile count).
  const latest = useRef({ analysis, drafts });
  latest.current = { analysis, drafts };

  const analyze = useCallback(async () => {
    if (!resume) return;
    setAnalyzing(true);
    setAnalyzeError("");
    await persistResume().catch(() => {}); // analyze exactly what's on screen (the route reads the saved copy)
    const { data, error } = await postApi<{ analysis: Analysis; saved?: boolean }>("/api/analyze", { jobId: id });
    setAnalyzing(false);
    if (error || !data?.analysis) return setAnalyzeError(error ?? "The analysis didn't come back. Try again.");
    // Keep answers and drafts typed on this page; match them to the new questions by text. The job
    // autosave then merges this with what the server stored (it's the same run) and writes only what's new.
    const carried = carryClientState(jobRef.current?.analysis ?? null, normalizeAnalysis(data.analysis), draftsRef.current);
    setDrafts(carried.drafts);
    updateJob((j) => ({ ...j, analysis: carried.analysis }));
    setError("");
  }, [resume, persistResume, id, setDrafts, updateJob]);

  // Run the first analysis automatically so the tailored copy has suggestions right away.
  // (Never with an empty master: there's no tailored copy then, so `resume` stays null. Never after applying.)
  useEffect(() => {
    if (autoRan.current || !job || !resume) return;
    autoRan.current = true;
    if (!job.analysis && !job.submitted_at && job.description.trim() && !isEmptyResume(resume)) analyze();
  }, [job, resume, analyze]);

  function selectTab(t: Tab) {
    setTab(t);
    setError("");
  }

  const setAnalysis = (fn: (a: Analysis) => Analysis) => updateJob((j) => (j.analysis ? { ...j, analysis: fn(j.analysis) } : j));
  const patch = (p: Partial<Job>) => updateJob((j) => ({ ...j, ...p }));

  function rejectSuggestion(bulletId: string) {
    setAnalysis((a) => ({ ...a, dismissed: [...new Set([...(a.dismissed ?? []), bulletId])] }));
    setError("");
  }

  function acceptAll() {
    if (!resume || !pending.length) return;
    let next = resume;
    for (const p of pending) next = replaceBullet(next, p.id, p.rewrite);
    setResume(next);
    showFlash(`Accepted ${plural(pending.length, "suggested edit")} (Undo to go back)`);
  }

  function reviewNext() {
    const next = pending[0];
    if (!next) return;
    selectTab("resume");
    setReveal({ id: next.id, n: Date.now() });
  }

  /** Jump to the first [placeholder] in the document and select it, ready to type over. */
  function goToPlaceholder() {
    selectTab("resume");
    const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".doc-canvas input, .doc-canvas textarea");
    const el = Array.from(fields).find((f) => hasPlaceholder(f.value));
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true }); // in the tap itself, so iOS opens the keyboard
    const m = /\[[^\]\n]+\]/.exec(el.value);
    if (m) el.setSelectionRange(m.index, m.index + m[0].length);
    if (el.dataset.bullet) setReveal({ id: el.dataset.bullet, n: Date.now() });
  }

  function fillTarget(q: Question): string | null {
    if (!resume || !q.bullet_id || !q.placeholder) return null;
    const text = bulletTextMap(resume).get(q.bullet_id);
    if (text === undefined) return null;
    const suggestion = feedback[q.bullet_id]?.suggestion ?? "";
    return findPlaceholder(text, q.placeholder) || (suggestion && findPlaceholder(suggestion, q.placeholder)) ? text : null;
  }

  /**
   * Put an answer in place of its placeholder in the tailored bullet. On phones (Analysis tab) stay on
   * the questions and offer "See bullet"; on desktop the document is beside the panel, so show the bullet.
   */
  function fillAnswer(q: Question, value: string) {
    const text = fillTarget(q);
    if (!resume || text === null || !q.bullet_id || !q.placeholder) return;
    const next = planFill(text, feedback[q.bullet_id]?.suggestion ?? "", q.placeholder, value);
    if (next === null) return;
    const bid = q.bullet_id;
    setResume(replaceBullet(resume, bid, next));
    const show = () => {
      selectTab("resume");
      setReveal({ id: bid, n: Date.now() });
    };
    if (tab === "analysis") {
      showFlash(`Filled ${q.placeholder} in the bullet.`, 6000, {
        label: "See bullet",
        onClick: () => {
          setFlash({ message: "" });
          show();
        },
      });
      return;
    }
    show();
    showFlash(`Filled ${q.placeholder}. Edit the bullet if it reads oddly.`, 5000);
  }

  async function writeCoverLetter() {
    if (job?.cover_letter && !confirm("Replace the current cover letter?")) return;
    setWriting(true);
    setCoverError("");
    await persistResume().catch(() => {});
    const { data, error } = await postApi<{ cover_letter: string }>("/api/cover-letter", { jobId: id });
    setWriting(false);
    if (error || typeof data?.cover_letter !== "string") return setCoverError(error ?? "The letter didn't come back. Try again.");
    patch({ cover_letter: data.cover_letter });
    setError("");
  }

  /** Facts first (the facts table), then the answers on this job; see saveAnswersInOrder. */
  async function saveAnswers(answers: Record<string, string>): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
    const current = latest.current.analysis;
    if (!current) return { ok: false, error: "Run the analysis first." };
    const res = await saveAnswersInOrder({
      analysis: current,
      answers,
      writeMaster: factListWriter(supabase, "answer", facts.replace),
      // Queued on the job autosave (retries by itself, merges with other devices); only answers change.
      persist: (next) => setAnalysis((a) => ({ ...a, answers: next.answers })),
    });
    if (!res.ok) {
      console.warn("Saving answers failed at", res.stage, res.error);
      return {
        ok: false,
        error: friendlyError(res.error, "Couldn't save them to your facts. Check your connection, then tap Retry."),
      };
    }
    setError("");
    return { ok: true, added: res.added };
  }

  /** The document's selection drives the coaching panel (a section alone doesn't). */
  const onSelection = useCallback((sel: DocSelection | null) => {
    if (!sel || sel.kind === "section") return;
    setCoachTarget((cur) => {
      const next = { sectionId: sel.sectionId, entryId: sel.entryId, bulletId: sel.kind === "bullet" ? sel.bulletId : null };
      return cur && cur.entryId === next.entryId && cur.bulletId === next.bulletId ? cur : next;
    });
    setSideTab("coach");
  }, []);

  /** Put a coached bullet on this tailored copy (an undo step); returns its id. */
  function insertBullet(target: CoachTarget, text: string, mode: "add" | "replace"): string | null {
    const cur = docLatest.current;
    if (!cur || !cur.sections.some((sec) => sec.items.some((it) => it.id === target.entryId))) return null;
    const { resume: next, bulletId } = insertCoachedBullet(cur, target, text, mode, uid());
    setResume(next);
    setReveal({ id: bulletId, n: Date.now() });
    return bulletId;
  }

  async function downloadPdf() {
    if (!resume || !job) return;
    setPdfBusy(true);
    try {
      if (await downloadResumePdf(stripBaseline(resume), `${resume.header.name} Resume ${job.company}`)) setError("");
    } catch (e) {
      fail(e, "Couldn't build the PDF. Try again.");
    } finally {
      setPdfBusy(false);
    }
  }

  function copy(text: string, done: string) {
    navigator.clipboard.writeText(text).then(
      () => showFlash(done),
      (e) => fail(e, "Couldn't copy to the clipboard. Try again."),
    );
  }

  function copyText() {
    if (!resume || !confirmPlaceholders(placeholderCount, "This tailored copy", "Copy")) return;
    copy(resumeToPlainText(resume), "Copied as text");
  }

  function copyCoverLetter() {
    if (!job || !confirmPlaceholders(countPlaceholders([job.cover_letter]), "This cover letter", "Copy")) return;
    copy(job.cover_letter, "Cover letter copied as text");
  }

  function pullFromMaster() {
    if (!resume || !master) return;
    const r = applyPull(resume, master);
    setResume(r.resume);
    const what = r.bullets ? plural(r.bullets, "line") : "";
    const kept = r.skipped ? " Kept what you edited in this tailored copy." : "";
    showFlash(`Updated ${what || "nothing"} from your master resume (Undo to go back).${kept}`, 7000);
  }

  function addOne(a: PullAddition) {
    if (!resume || !master) return;
    setResume(addFromMaster(resume, master, a));
    showFlash(`Added the new ${a.kind === "item" ? "entry" : a.kind} from your master resume (Undo to go back)`);
  }

  function addAll() {
    if (!resume || !master) return;
    const n = pull.additions.length;
    setResume(addAllFromMaster(resume, master));
    showFlash(`Added ${n} new item${n === 1 ? "" : "s"} from your master resume (Undo to go back)`);
  }

  function leaveOut() {
    if (!resume || !master) return;
    setResume(dismissAdditions(resume, master, pull.additions));
    showFlash("Left the new master content out of this tailored copy");
  }

  function onRemoval(r: PullRemoval, choice: "remove" | "keep") {
    if (!resume) return;
    setResume(resolveRemoval(resume, r, choice));
    showFlash(choice === "remove" ? "Removed here too (Undo to go back)" : "Kept in this tailored copy");
  }

  /**
   * "Reset to master resume": the tailored copy becomes a fresh clone of the current master (text, formatting, page
   * setup; same paragraph ids and baseline), then the analysis runs again for this job. Never while applied (the
   * submitted snapshot is separate and must not change) and never while an analysis is already running.
   */
  async function resetToMaster() {
    if (applied || analyzing) return;
    if (!confirm(
      "Replace this job's resume with your current master resume (all its text and formatting)? " +
      "Edits you made for this job are replaced. Then the AI re-analyzes it for this job.",
    )) return;
    const { data: m, error } = await supabase.from("resumes").select("content").eq("is_master", true).maybeSingle();
    if (error) return fail(error, "Couldn't load your master resume. Try again.");
    const fresh = m ? normalizeResume(m.content) : emptyResume();
    if (isEmptyResume(fresh)) return setError("Your master resume is empty. Import it on the Master resume page first.");
    setMaster(fresh);
    // showDoc (not setResume) so the autosave and analyze below read the new copy, not the one on screen before this render.
    showDoc(cloneForJob(fresh));
    showFlash("Reset to your master resume. Re-analyzing…", 5000);
    await analyze();
  }

  /** "Save this tailored copy as my master resume…": warn about placeholders, then show what it will do. */
  async function makeMaster() {
    const copyNow = docLatest.current;
    if (!copyNow) return;
    if (!confirmPlaceholders(countPlaceholders(resumeTexts(copyNow)), "This tailored copy", "Save it as your master resume")) return;
    const { data: m, error } = await supabase.from("resumes").select("content").eq("is_master", true).maybeSingle();
    if (error) return fail(error, "Couldn't load your master resume. Try again.");
    if (!m) return setError("No master resume yet. Open Master resume and import yours first.");
    const current = normalizeResume(m.content);
    setMaster(current);
    setSaveMaster({ plan: planSaveAsMaster(copyNow, current), copy: copyNow });
  }

  /** Merge this copy's edits into the master (conflict-safe; nothing removed unless ticked), then re-baseline the copy. */
  async function confirmSaveMaster(remove: Set<string>) {
    const pendingSave = saveMaster;
    if (!pendingSave) return;
    setSaveMasterBusy(true);
    try {
      const { copy: copyThen } = pendingSave;
      const res = await updateMaster(supabase, (current) => applySaveAsMaster(copyThen, current, remove));
      if (!res.ok) return fail(res.error, "Couldn't update your master resume. Try again.");
      setMaster(res.content);
      const cur = docLatest.current ?? copyThen;
      showDoc({ ...cur, baseline: baselineAfterMasterSave(copyThen, res.content) });
      setSaveMaster(null);
      const removed = [...remove].filter((rid) => pendingSave.plan.removals.some((r) => r.id === rid)).length;
      showFlash(
        removed ? `Master resume updated. Removed ${plural(removed, "item")} you left out here.` : "Master resume updated. Nothing was removed from it.",
        6000,
      );
    } finally {
      setSaveMasterBusy(false);
    }
  }

  /**
   * Change the status. The job row is re-read first, so a stale tab decides from what's really stored
   * (another device may already have marked it Applied). A new "what you sent" snapshot is only written
   * if the row still has none; if another device froze one first, that one is kept and shown.
   */
  async function changeStatus(next: JobStatus) {
    if (!jobRef.current || statusBusy) return;
    setStatusBusy(true);
    try {
      await serial(async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const fresh = await readJob(supabase, id);
          if (!fresh) return setError("This job was deleted on another device.");
          applyServerJob(fresh);
          const p = await applyStatusChange({
            job: fresh,
            next,
            sentResume: docLatest.current, // exactly what's on screen
            master,
            confirm: async (message) => window.confirm(message),
          });
          if (!p) return; // cancelled
          const snap = freezesSnapshot(p);
          const out = await writeJobIfUnchanged(supabase, id, p, fresh.updated_at, missingCols.current, { requireNoSnapshot: snap });
          if (out.droppedColumns) showHint();
          if (out.kind === "saved") {
            jobVersion.current = out.updatedAt;
            lastSaved.current = { ...(lastSaved.current ?? fresh), ...p };
            updateJob((j) => ({ ...j, ...p }));
            setError("");
            return;
          }
          const again = await readJob(supabase, id);
          const outcome = statusConflictOutcome(p, again);
          if (!again || outcome === "gone") return setError("This job was deleted on another device.");
          applyServerJob(again);
          if (outcome === "already-applied") {
            showFlash("Already marked as applied on another device. Kept the copy of what you sent from there.", 8000);
            return;
          }
        }
        setError("This job kept changing on another device. Try the status again.");
      });
    } catch (e) {
      fail(e, "Couldn't change the status. Check your connection and try again.");
    } finally {
      setStatusBusy(false);
    }
  }

  function replaceSnapshot() {
    if (!resume) return;
    if (!confirm("Replace the saved copy of what you sent with this job's current tailored copy? Only do this if you sent the updated version.")) return;
    if (!confirmPlaceholders(placeholderCount, "Your tailored copy", "Replace")) return;
    patch(snapshotPatch(stripBaseline(resume), master));
    showFlash("Saved copy of what you sent updated");
  }

  async function deleteJob() {
    if (!confirm("Delete this job and its tailored copy?")) return;
    // Facts coached on this job's bullets stay, as standalone facts (the database does this too).
    if (resumeIdRef.current) await unlinkResumeFacts(supabase, resumeIdRef.current);
    const { error } = await supabase.from("jobs").delete().eq("id", id);
    if (error) return fail(error, "Couldn't delete this job. Try again.");
    router.push("/");
  }

  if (loadFailed && !job) {
    return (
      <div role="alert" className="rounded-lg border border-border p-6 space-y-3 max-w-lg">
        <p className="text-bad">{error || "Couldn't load this job."}</p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary min-h-10 sm:min-h-0" onClick={() => window.location.reload()}>Try again</button>
          <Link href="/" className="btn min-h-10 sm:min-h-0">Back to jobs</Link>
        </div>
      </div>
    );
  }
  if (!job) return <p className="text-muted">Loading…</p>;
  const showHighlights = showFeedback && !quiet;

  const panel = (
    <AnalysisPanel
      analysis={analysis}
      analyzing={analyzing}
      onAnalyze={analyze}
      error={analyzeError}
      disabledReason={needsMaster ? "Import your resume first, then the analysis runs automatically." : !resume ? "Loading your resume…" : undefined}
      drafts={drafts}
      onDraftsChange={setDrafts}
      onSaveAnswers={saveAnswers}
      missingFacts={missingFacts}
      pendingCount={pending.length}
      onReview={reviewNext}
      onAcceptAll={acceptAll}
      canFill={(q) => fillTarget(q) !== null}
      onFill={fillAnswer}
      quiet={quiet}
      top={
        priority.length || analysis?.keywords.missing.length ? (
          <PriorityList
            items={priority}
            missingKeywords={analysis?.keywords.missing ?? []}
            onAccept={(bid, rewrite) => {
              if (!resume) return;
              setResume(replaceBullet(resume, bid, rewrite));
              showFlash("Accepted the suggested edit (Undo to go back)");
            }}
            onReject={rejectSuggestion}
            onShow={(bid) => {
              selectTab("resume");
              setReveal({ id: bid, n: Date.now() });
            }}
            onAcceptAll={acceptAll}
          />
        ) : null
      }
    />
  );

  const coach =
    coachTarget && resume ? (
      <CoachPanel
        key={`${coachTarget.entryId}:${coachTarget.bulletId ?? ""}`}
        resume={resume}
        resumeId={tailoredId}
        jobId={id}
        target={coachTarget}
        facts={facts}
        onBack={() => setCoachTarget(null)}
        onInsert={insertBullet}
        disabledReason={quiet ? "You've applied with this copy. Turn on “Keep editing (for a re-apply)” to coach it again." : undefined}
      />
    ) : null;

  const side = (
    <div className="space-y-3">
      <SideTabs
        label="Panel"
        value={sideTab}
        onChange={setSideTab}
        tabs={[
          { key: "coach", label: "Coach" },
          { key: "facts", label: `Facts (${facts.facts.length})` },
        ]}
      />
      {sideTab === "facts" ? (
        <FactsPanel
          facts={facts.facts}
          status={facts.status}
          error={facts.error}
          onAdd={(lines) => facts.add(lines.map((text) => ({ text, source: "manual" })))}
          onEdit={facts.edit}
          onDelete={async (f) => {
            if (await facts.remove([f.id])) setFactUndo(f);
          }}
        />
      ) : (
        (coach ?? panel)
      )}
    </div>
  );

  const followUp = (
    <label className="flex items-center gap-1.5 text-[13px] text-muted">
      Follow up
      <input
        type="date"
        className="ghost-input text-[13px] border-border sm:border-transparent"
        value={job.follow_up_date ?? ""}
        onChange={(e) => patch({ follow_up_date: e.target.value || null })}
      />
    </label>
  );
  /** The same follow-up date as two grid cells (label, input) for the details list in JobHeader. */
  const followUpRow = (
    <>
      <span className="text-muted">Follow up</span>
      <input
        type="date"
        className="ghost-input justify-self-start text-[13px] border-border sm:border-transparent sm:-ml-[5px]"
        value={job.follow_up_date ?? ""}
        onChange={(e) => patch({ follow_up_date: e.target.value || null })}
      />
    </>
  );
  const statusSelect = <StatusSelect value={job.status} onChange={changeStatus} />;
  /** Resume-only controls: on the Tailored resume tab (and on the Analysis tab beside it on lg+). */
  const resumeBar = (tab === "resume" || tab === "analysis") && !!resume && !needsMaster;
  /** The Tailored resume (or Analysis on lg+) tab: the canvas column; the other tabs scroll as a plain column. */
  const docTab = tab === "resume" || tab === "analysis";
  const quietText = "whitespace-nowrap rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg";

  /** Notices: shown above the canvas on the resume tab, inside the scrolling column on the others. */
  const notices = (
    <>
            {migrationHint && (
              <div role="status" className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-[13px]">
                <span className="flex-1 text-muted">
                  {MIGRATION_HINT} Until then, some details (deadlines, the copy of what you sent, interview tracking, progress on the
                  dashboard) aren&apos;t saved.
                </span>
                <button type="button" className="px-1 text-muted hover:text-fg" aria-label="Dismiss" onClick={() => setMigrationHint(false)}>✕</button>
              </div>
            )}
            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-bad/40 px-3 py-2 text-[13px]">
                <span className="flex-1 text-bad">{error}</span>
                <button type="button" className="px-1 text-muted hover:text-fg" aria-label="Dismiss" onClick={() => setError("")}>✕</button>
              </div>
            )}
            <AppliedNotice
              job={job}
              applied={applied}
              followUp={followUp}
              statusSelect={statusSelect}
              reapply={reapply}
              onReapply={setReapply}
              onViewSubmitted={() => setViewingSubmitted(true)}
            />
            {resumeBar && !quiet && (
              <PullBanner
                plan={pull}
                onPull={pullFromMaster}
                onAdd={addOne}
                onAddAll={addAll}
                onDismissAdditions={leaveOut}
                onRemoval={onRemoval}
              />
            )}
            {resumeBar && !applied && (
              // Always offered (not only when the banner shows): the banner only sees text changes, not formatting.
              <div className="flex justify-end">
                <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={resetToMaster} disabled={analyzing}>
                  Reset to master resume
                </button>
              </div>
            )}
    </>
  );

  /** The document tabs. Desktop: inside the top bar. Phones: their own row under it (the menus keep the whole bar). */
  const tabList = (className: string) => (
    <div role="tablist" aria-label="Job sections" className={className}>
      {TABS.map(([key, short, full]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          onClick={() => selectTab(key)}
          className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-[1.5px] px-0.5 text-[13px] transition-colors ${
            key === "analysis" ? "lg:hidden" : ""
          } ${tab === key ? "border-fg font-medium text-fg" : "border-transparent text-muted hover:text-fg"}`}
        >
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{full}</span>
          {/* No room for the chip at phone width; the Analysis tab itself shows it. */}
          {key === "analysis" && fit && <span className="hidden sm:inline-flex"><FitBadge fit={fit} /></span>}
          {key === "analysis" && analyzeError && !quiet && <span className="text-bad" aria-label="Analysis failed">!</span>}
          {key === "resume" && pending.length > 0 && <span className="text-xs text-muted">({pending.length})</span>}
        </button>
      ))}
    </div>
  );
  /** Fixed width: "Saved" / "Saving…" / "Unsaved changes" never resize the row beside it. */
  const saveBox = (className: string, width = "w-[112px]") => (
    <div className={`${width} shrink-0 items-center justify-end ${className}`}>
      <SaveStatus status={saveState} />
    </div>
  );

  const topBar = (
    <DocToolbar>
      <Link
        href="/"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2 py-1 text-xs font-normal text-muted hover:text-fg sm:px-2.5"
      >
        <BriefcaseIcon className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Jobs</span>
        <span className="sr-only sm:hidden">Jobs</span>
      </Link>
      <span className="hidden shrink-0 items-center gap-1 sm:flex">
        <ChevronRightIcon className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
        <span className="max-w-[220px] truncate text-xs text-muted" title={job.title}>
          {job.title || "Untitled job"}
        </span>
      </span>
      <span className="mx-2 hidden h-4 w-px shrink-0 bg-border sm:block" aria-hidden="true" />

      {/* Phones: the top bar is nowrap, and the menus would inherit that and stretch to fit their hints off-screen.
          Wrapping them at phone width keeps each popup about 224px wide, inside the screen. */}
      <div className="whitespace-normal sm:whitespace-nowrap [&>div]:gap-0 [&_button[aria-haspopup]]:px-1.5 [&_[role=menu]]:min-w-44 sm:[&>div]:gap-0.5 sm:[&_button[aria-haspopup]]:px-2 sm:[&_[role=menu]]:min-w-56">
      <MenuBar>
        <MenuBarMenu label="File">
          <MenuItem onSelect={downloadPdf} disabled={pdfBusy}>
            {pdfBusy ? "Building PDF…" : "Download PDF"}
          </MenuItem>
          <MenuItem onSelect={copyText}>Copy as text</MenuItem>
          <MenuItem onSelect={() => window.print()} shortcut="Ctrl+P">Print…</MenuItem>
          <MenuSeparator />
          <MenuItem
            onSelect={makeMaster}
            hint="Adds this copy's edits to your master resume. Nothing is removed unless you choose."
          >
            Save this tailored copy as my master resume…
          </MenuItem>
          <MenuItem
            onSelect={resetToMaster}
            disabled={applied || analyzing}
            hint={applied ? "Locked: this job is marked Applied" : "Copies your master resume here and re-analyzes it"}
            danger
          >
            Reset to master resume…
          </MenuItem>
        </MenuBarMenu>
        <EditMenu commandsRef={commandsRef} fmt={formatState} />
        <MenuBarMenu label="View">
          {!quiet && (
            <MenuItem onSelect={() => setShowFeedback((v) => !v)}>
              <span className="flex items-center gap-1.5">{tick(showFeedback)}Feedback</span>
            </MenuItem>
          )}
          {!quiet && <MenuSeparator />}
          {ZOOM_CHOICES.map(([value, label]) => (
            <MenuItem key={value} onSelect={() => setZoom(value)}>
              <span className="flex items-center gap-1.5">{tick(zoom === value)}{label}</span>
            </MenuItem>
          ))}
        </MenuBarMenu>
        <FormatMenu commandsRef={commandsRef} fmt={formatState} />
        <MenuBarMenu label="Help">
          <MenuItem onSelect={() => {}} hint={EDITING_TIPS}>
            Editing tips
          </MenuItem>
          <MenuItem onSelect={() => {}} hint={EDIT_SHORTCUTS}>
            Keyboard shortcuts
          </MenuItem>
          <MenuItem
            onSelect={() => {}}
            hint="Green strong, amber could be stronger, red weak. Blue bar: changed from your master resume. Yellow [N]: a placeholder to fill in."
          >
            What the colours mean
          </MenuItem>
        </MenuBarMenu>
      </MenuBar>
      </div>

      {tabList("ml-2 hidden h-full min-w-0 flex-1 items-stretch gap-3 overflow-x-auto sm:flex [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}
      {saveBox("ml-auto hidden pl-2 sm:flex")}
    </DocToolbar>
  );

  return (
    // Phones: fill the viewport above the bottom tab bar (header + pb-16 in the app layout), so no grey band shows under the document.
    <div className="flex flex-col min-h-[calc(100dvh-7rem)] sm:min-h-[calc(100dvh-7.5rem)] lg:h-full lg:min-h-0">
      {/* Sticky together: on phones the document tabs and save status sit in a second row under the menus. */}
      <div className="sticky top-0 z-10 shrink-0">
        {topBar}
        <div className="flex h-10 items-center gap-2 border-b border-border bg-surface px-3 sm:hidden">
          {tabList("flex h-full min-w-0 flex-1 items-stretch gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden")}
          {saveBox("flex text-[11px] [&_*]:text-[11px]", "w-[84px]")}
        </div>
      </div>

      {/* Formatting-style row under the top bar: fixed height, scrolls sideways on phones. Resume tab only. */}
      {resumeBar && (
        <div className={`shrink-0 ${tab === "analysis" ? "hidden lg:block" : ""}`}>
          <EditorToolbar>
            <IconButton label="Print (Ctrl+P)" onClick={() => window.print()}>
              <PrintIcon />
            </IconButton>
            <ZoomSelect value={zoom} onChange={setZoom} />
            <ToolbarSep />
            {/* Document actions (add, move, delete) portal in here: one fixed group, so the row never changes width. */}
            <div ref={setSlot} className="flex items-center" />
            <ToolbarSep />
            <div className="ml-auto flex items-center gap-1">
              {quiet ? null : pending.length > 0 ? (
                <>
                  <span className="hidden text-xs text-muted sm:inline">{plural(pending.length, "suggestion")}</span>
                  <button type="button" className={quietText} onClick={reviewNext}>
                    <span>Review<span className="sm:hidden"> {pending.length}</span></span>
                  </button>
                  <button type="button" className={quietText} onClick={acceptAll}>
                    Accept all
                  </button>
                </>
              ) : analyzing ? (
                <span className="px-1 text-xs whitespace-nowrap text-muted">
                  Analyzing<span className="hidden sm:inline"> against the job</span>…
                </span>
              ) : analyzeError ? (
                <button type="button" className={`${quietText} text-bad lg:hidden`} onClick={() => selectTab("analysis")}>
                  Analysis failed
                </button>
              ) : null}
              {!quiet && <PlaceholderCount count={placeholderCount} onClick={goToPlaceholder} />}
              <span className="hidden md:inline-flex"><PageCount {...measure} /></span>
              {!quiet && <Toggle on={showFeedback} onChange={setShowFeedback} label="Feedback" />}
            </div>
          </EditorToolbar>
        </div>
      )}

      <div className="flex flex-col lg:min-h-0 lg:flex-1 lg:flex-row">
        {/* Document column: grey canvas on the resume tab (scrolls on lg+), with notices above and a status bar below. */}
        <div className={`flex min-w-0 flex-1 flex-col lg:min-h-0 ${tab === "analysis" ? "hidden lg:flex" : "flex"}`}>
          {docTab ? (
            <div className="mx-auto w-full max-w-[860px] shrink-0 space-y-4 px-4 pt-4 sm:px-8 empty:hidden">{notices}</div>
          ) : (
            <div className="min-h-0 flex-1 lg:overflow-y-auto">
              <div className="mx-auto max-w-[860px] space-y-4 px-4 pb-6 pt-4 sm:px-8">
                {notices}
                {tab === "job" && <PostingTab job={job} onPatch={patch} />}
                {tab === "cover" && (
                  <CoverLetterTab
                    job={job}
                    quiet={quiet}
                    writing={writing}
                    error={coverError}
                    canWrite={!!resume}
                    onWrite={writeCoverLetter}
                    onCopy={copyCoverLetter}
                    onPatch={patch}
                  />
                )}
              </div>
            </div>
          )}

          {/* Kept mounted across tabs so selection and "Review" requests survive tab switches. */}
          <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${docTab ? "" : "hidden"}`}>
            {needsMaster ? (
              <div className="mx-4 mb-4 rounded-lg border border-border p-6 text-center space-y-3 sm:mx-8 sm:p-10">
                <h2 className="text-lg font-semibold">Import your resume first</h2>
                <p className="text-sm text-muted max-w-md mx-auto">
                  Each job gets its own tailored copy of your master resume. Your master resume is empty, so there&apos;s
                  nothing to tailor yet. Upload your resume PDF (or paste it), then come back to this job.
                </p>
                <Link href="/resume" className="btn btn-primary">Import your resume</Link>
              </div>
            ) : !resume ? (
              <p className="px-4 pt-4 text-sm text-muted sm:px-8">Loading your tailored copy…</p>
            ) : (
              <>
                <EditorCanvas zoom={zoom} className="min-w-0 flex-1 lg:overflow-auto">
                  <ResumeDocument
                    value={resume}
                    onChange={setResume}
                    feedback={quiet ? undefined : feedback}
                    showHighlights={showHighlights}
                    baseline={compareTo}
                    showChanges={showHighlights}
                    onReject={rejectSuggestion}
                    onMeasure={setMeasure}
                    actionsSlot={slot}
                    commentSlot={commentEl}
                    reveal={reveal}
                    quiet={quiet}
                    onSelectionChange={onSelection}
                    commandsRef={commandsRef}
                    onFormatStateChange={setFormatState}
                  />
                </EditorCanvas>
                <StatusBar
                  pages={measure.pages}
                  words={countWords(resume)}
                  zoom={zoom}
                  onZoom={setZoom}
                />
              </>
            )}
          </div>
        </div>

        {/* Side panel: the comment card of the selected bullet at the top (only when there is one), then job details
            and the coach/facts/analysis panels. Its own scroll on lg+. Phones: the details come first; the panels show on the Analysis tab. */}
        <aside className="relative order-first space-y-3 border-b border-border p-4 lg:order-none lg:space-y-4 lg:w-[340px] lg:shrink-0 lg:overflow-y-auto lg:border-b-0 lg:border-l">
          {/* Header block: the selected bullet's comment card is an overlay under it on desktop (absolute, so the
              rows above and the panel below never move). On phones it is a bottom sheet above the tab bar. */}
          <div className="relative">
            <JobHeader
              job={job}
              applied={applied}
              statusSelect={statusSelect}
              followUp={followUpRow}
              saveState={saveState}
              detailsOpen={detailsOpen}
              onToggleDetails={() => setDetailsOpen((o) => !o)}
              onPatch={patch}
              onDelete={deleteJob}
            />
            {resumeBar && showHighlights && (analysis || changedCount > 0) && (
              // Phones: behind the "Details" toggle. The legend's bordered "?" button is flattened to a plain glyph.
              <div
                className={`${detailsOpen ? "flex" : "hidden"} mt-3 items-center justify-between gap-3 text-xs text-muted sm:flex lg:mt-4`}
              >
                <span>Colours in the document</span>
                <div className="[&_button]:border-0 [&_button]:bg-transparent [&_button]:px-1 [&_button]:text-muted">
                  <FeedbackLegend analyzed={!!analysis} changedCount={changedCount} />
                </div>
              </div>
            )}
            <div
              ref={setCommentEl}
              className="empty:hidden fixed inset-x-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 max-h-[45dvh] overflow-y-auto rounded-lg shadow-lg lg:absolute lg:inset-x-0 lg:top-full lg:mt-3 lg:bottom-auto lg:z-20 lg:max-h-none lg:overflow-visible"
            />
          </div>
          <div className={`${tab === "analysis" ? "" : "hidden"} border-t border-border pt-4 lg:block`}>{side}</div>
        </aside>
      </div>

      {viewingSubmitted && job.submitted_resume && job.submitted_at && (
        <SubmittedView
          resume={job.submitted_resume}
          submittedAt={job.submitted_at}
          fileName={`${job.submitted_resume.header.name} Resume ${job.company}`}
          onClose={() => setViewingSubmitted(false)}
          onReplace={replaceSnapshot}
        />
      )}

      {saveMaster && (
        <SaveAsMasterDialog
          plan={saveMaster.plan}
          busy={saveMasterBusy}
          onCancel={() => setSaveMaster(null)}
          onConfirm={confirmSaveMaster}
        />
      )}

      {conflict && (
        <TailoredConflictBanner conflicts={conflict.conflicts} busy={resolving} onReload={reloadTheirs} onKeepMine={keepMine} />
      )}

      {factUndo && (
        <UndoToast
          message="Fact deleted"
          onUndo={() => {
            void facts.restore([factUndo]);
            setFactUndo(null);
          }}
          onClose={() => setFactUndo(null)}
        />
      )}
      <FlashToast
        message={flash.message}
        action={flash.action}
        raised={saveState === "error" && !conflict}
        onClose={() => setFlash({ message: "" })}
      />
      {!conflict && <SaveErrorToast status={saveState} onRetry={retrySaves} />}
    </div>
  );
}
