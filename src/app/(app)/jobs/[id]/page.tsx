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
import { ResumeDocument, type DocSelection } from "@/components/ResumeDocument";
import { JobHeader } from "@/components/job/JobHeader";
import { AppliedNotice } from "@/components/job/AppliedNotice";
import { CoverLetterTab, PostingTab } from "@/components/job/JobTabs";
import { CoachPanel } from "@/components/CoachPanel";
import { PriorityList } from "@/components/PriorityList";
import { FactsPanel } from "@/components/FactsPanel";
import { SideTabs } from "@/components/SideTabs";
import { UndoToast } from "@/components/UndoToast";
import { insertCoachedBullet, priorityItems, type CoachTarget } from "@/lib/coaching";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { StatusSelect, FitBadge } from "@/components/StatusSelect";
import { DocToolbar, FeedbackLegend, PageCount, PlaceholderCount, Toggle, toggleLabel, UndoRedo } from "@/components/DocToolbar";
import { Menu, MenuItem } from "@/components/Menu";
import { SubmittedView } from "@/components/SubmittedView";
import { PullBanner, SaveAsMasterDialog, TailoredConflictBanner } from "@/components/PullBanner";
import { FlashToast } from "@/components/FlashToast";
import { confirmPlaceholders, downloadResumePdf, resumeTexts } from "@/components/pdfDownload";
import { SaveErrorToast, useAutosaveWithRetry, worstStatus } from "@/lib/useAutosave";
import { useHistory } from "@/lib/useHistory";

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

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [job, setJobState] = useState<Job | null>(null);
  const doc = useHistory<Resume>();
  const resume = doc.value;
  const { set: setDoc, reset: resetDoc } = doc; // stable callbacks (the `doc` object itself is new every render)
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
    (r: Resume, how: "set" | "reset") => {
      docLatest.current = r;
      if (how === "reset") resetDoc(r);
      else setDoc(r, true);
    },
    [setDoc, resetDoc],
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
        showDoc(start, "reset");
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
            showDoc(cur === local ? out.content : mergeTailored(local, cur, out.content).merged, "set");
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
        showDoc(next.content, "reset");
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
    showDoc({ ...merged }, "set"); // a new value, so autosave writes it (on top of their version)
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
            showDoc(plan.content, "reset");
            visible = true;
          } else if (plan.kind === "merge") {
            resumeBase.current = { content: server2, updatedAt: s.updated_at };
            showDoc(plan.content, "set"); // autosave writes the merge
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
    doc.set(next, true);
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
    doc.set(replaceBullet(resume, bid, next), true);
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
    doc.set(next, true);
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
    doc.set(r.resume, true);
    const parts = [r.header ? "your name/contact line" : "", r.bullets ? plural(r.bullets, "bullet") : ""];
    const what = parts.filter(Boolean).join(" and ");
    const kept = r.skipped || r.headerKept ? " Kept what you edited in this tailored copy." : "";
    showFlash(`Updated ${what || "nothing"} from your master resume (Undo to go back).${kept}`, 7000);
  }

  function addOne(a: PullAddition) {
    if (!resume || !master) return;
    doc.set(addFromMaster(resume, master, a), true);
    showFlash(`Added the new ${a.kind === "item" ? "entry" : a.kind} from your master resume (Undo to go back)`);
  }

  function addAll() {
    if (!resume || !master) return;
    const n = pull.additions.length;
    doc.set(addAllFromMaster(resume, master), true);
    showFlash(`Added ${n} new item${n === 1 ? "" : "s"} from your master resume (Undo to go back)`);
  }

  function leaveOut() {
    if (!resume || !master) return;
    doc.set(dismissAdditions(resume, master, pull.additions), true);
    showFlash("Left the new master content out of this tailored copy");
  }

  function onRemoval(r: PullRemoval, choice: "remove" | "keep") {
    if (!resume) return;
    doc.set(resolveRemoval(resume, r, choice), true);
    showFlash(choice === "remove" ? "Removed here too (Undo to go back)" : "Kept in this tailored copy");
  }

  async function resetFromMaster() {
    if (!confirm("Discard this job's tailored edits and start over from your current master resume?")) return;
    const { data: m, error } = await supabase.from("resumes").select("content").eq("is_master", true).maybeSingle();
    if (error) return fail(error, "Couldn't load your master resume. Try again.");
    const fresh = m ? normalizeResume(m.content) : emptyResume();
    if (isEmptyResume(fresh)) return setError("Your master resume is empty. Import it on the Master resume page first.");
    setMaster(fresh);
    doc.set(cloneForJob(fresh), true);
    showFlash("Replaced with your master resume (Undo to go back)");
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
      showDoc({ ...cur, baseline: baselineAfterMasterSave(copyThen, res.content) }, "set");
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
      <div role="alert" className="card p-6 space-y-3 max-w-lg">
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
              doc.set(replaceBullet(resume, bid, rewrite), true);
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
    <label className="text-xs text-muted flex items-center gap-1.5">
      Follow up
      <input
        type="date"
        className="ghost-input text-xs border-border sm:border-transparent"
        value={job.follow_up_date ?? ""}
        onChange={(e) => patch({ follow_up_date: e.target.value || null })}
      />
    </label>
  );
  const statusSelect = <StatusSelect value={job.status} onChange={changeStatus} />;

  return (
    <div className="space-y-2 sm:space-y-3">
      <JobHeader
        job={job}
        applied={applied}
        statusSelect={statusSelect}
        followUp={followUp}
        saveState={saveState}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((o) => !o)}
        onPatch={patch}
        onDelete={deleteJob}
      />

      <AppliedNotice
        job={job}
        applied={applied}
        followUp={followUp}
        statusSelect={statusSelect}
        reapply={reapply}
        onReapply={setReapply}
        onViewSubmitted={() => setViewingSubmitted(true)}
      />

      {migrationHint && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-ok/40 bg-ok-bg px-3 py-2 text-sm">
          <span className="flex-1">
            {MIGRATION_HINT} Until then, some details (deadlines, the copy of what you sent, interview tracking) aren&apos;t saved.
          </span>
          <button type="button" className="text-muted hover:text-fg" aria-label="Dismiss" onClick={() => setMigrationHint(false)}>✕</button>
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-bad/40 bg-bad-bg px-3 py-2 text-sm">
          <span className="flex-1 text-bad">{error}</span>
          <button type="button" className="text-muted hover:text-fg px-1" aria-label="Dismiss" onClick={() => setError("")}>✕</button>
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" className="flex border-b border-border overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 sm:gap-1">
        {TABS.map(([key, short, full]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => selectTab(key)}
            className={`shrink-0 px-2.5 sm:px-3 py-2 text-sm -mb-px border-b-2 flex items-center gap-1.5 ${key === "analysis" ? "lg:hidden" : ""} ${
              tab === key ? "border-accent text-fg font-medium" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{full}</span>
            {/* No room for the chip at phone width; the Analysis tab itself shows it. */}
            {key === "analysis" && fit && <span className="hidden sm:inline-flex"><FitBadge fit={fit} /></span>}
            {key === "analysis" && analyzeError && !quiet && <span className="text-bad" aria-label="Analysis failed">!</span>}
            {key === "resume" && pending.length > 0 && (
              <span className="chip border-0 bg-accent text-[var(--accent-fg)] px-1.5">{pending.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className={`min-w-0 space-y-3 ${tab === "analysis" ? "hidden lg:block" : ""}`}>
          {/* Kept mounted across tabs so selection and "Review" requests survive tab switches. */}
          <div className={`space-y-2 sm:space-y-3 ${tab === "resume" || tab === "analysis" ? "" : "hidden"}`}>
            {needsMaster ? (
              <div className="card p-6 sm:p-10 text-center space-y-3">
                <h2 className="text-lg font-semibold">Import your resume first</h2>
                <p className="text-sm text-muted max-w-md mx-auto">
                  Each job gets its own tailored copy of your master resume. Your master resume is empty, so there&apos;s
                  nothing to tailor yet. Upload your resume PDF (or paste it), then come back to this job.
                </p>
                <Link href="/resume" className="btn btn-primary">Import your resume</Link>
              </div>
            ) : !resume ? (
              <p className="text-sm text-muted">Loading your tailored copy…</p>
            ) : (
              <>
                <DocToolbar onSlot={setSlot}>
                  <UndoRedo undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
                  {quiet ? null : pending.length > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <span className="hidden sm:inline text-xs font-medium text-accent">
                        {plural(pending.length, "suggestion")}
                      </span>
                      <button type="button" className="btn btn-sm" onClick={reviewNext}>
                        <span>Review<span className="sm:hidden"> {pending.length}</span></span>
                      </button>
                      <button type="button" className="hidden sm:inline-flex btn btn-sm btn-primary" onClick={acceptAll}>Accept all</button>
                    </div>
                  ) : analyzing ? (
                    <span className="text-xs text-muted">
                      Analyzing<span className="hidden sm:inline"> against the job</span>…
                    </span>
                  ) : analyzeError ? (
                    <button type="button" className="btn btn-sm text-bad lg:hidden" onClick={() => selectTab("analysis")}>
                      Analysis failed
                    </button>
                  ) : null}
                  {!quiet && <PlaceholderCount count={placeholderCount} onClick={goToPlaceholder} />}
                  {!quiet && (
                    <span className="hidden sm:inline-flex"><Toggle on={showFeedback} onChange={setShowFeedback} label="Feedback" /></span>
                  )}
                  {showHighlights && (analysis || changedCount > 0) && (
                    <FeedbackLegend analyzed={!!analysis} changedCount={changedCount} />
                  )}
                  <span className="hidden md:inline"><PageCount {...measure} /></span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <button type="button" className="btn btn-sm btn-primary" onClick={downloadPdf} disabled={pdfBusy}>
                      {pdfBusy ? "Building…" : <span>Download<span className="hidden sm:inline"> PDF</span></span>}
                    </button>
                    <Menu label="More ▾">
                      {pending.length > 0 && (
                        <MenuItem className="sm:hidden" onSelect={acceptAll} hint="Apply every suggested edit (Undo to go back)">
                          Accept all {plural(pending.length, "suggestion")}
                        </MenuItem>
                      )}
                      <MenuItem onSelect={copyText}>Copy as text</MenuItem>
                      {!quiet && (
                        <MenuItem
                          className="sm:hidden"
                          onSelect={() => setShowFeedback((v) => !v)}
                          hint="Ratings, suggested edits and changes from your master resume"
                        >
                          {toggleLabel("Feedback", showFeedback)}
                        </MenuItem>
                      )}
                      <MenuItem
                        onSelect={makeMaster}
                        hint="Adds this copy's edits to your master resume. Nothing is removed unless you choose."
                      >
                        Save this tailored copy as my master resume…
                      </MenuItem>
                      <MenuItem onSelect={resetFromMaster} hint="Discards this job's tailored edits" danger>
                        Start over from master resume…
                      </MenuItem>
                    </Menu>
                  </div>
                </DocToolbar>
                {!quiet && (
                  <PullBanner
                    plan={pull}
                    onPull={pullFromMaster}
                    onAdd={addOne}
                    onAddAll={addAll}
                    onDismissAdditions={leaveOut}
                    onRemoval={onRemoval}
                  />
                )}
                <ResumeDocument
                  value={resume}
                  onChange={doc.set}
                  feedback={quiet ? undefined : feedback}
                  showHighlights={showHighlights}
                  baseline={compareTo}
                  showChanges={showHighlights}
                  onReject={rejectSuggestion}
                  onMeasure={setMeasure}
                  actionsSlot={slot}
                  reveal={reveal}
                  quiet={quiet}
                  onSelectionChange={onSelection}
                />
              </>
            )}
          </div>

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

        <aside
          className={`${tab === "analysis" ? "" : "hidden"} lg:block lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto`}
        >
          {side}
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
