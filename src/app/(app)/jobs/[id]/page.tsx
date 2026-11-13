"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  bulletTextMap, countChangedBullets, emptyResume, isEmptyResume, normalizeResume, resumeToPlainText,
} from "@/lib/resume";
import type { Analysis, Job, JobStatus, Resume } from "@/lib/types";
import { friendlyError, postApi } from "@/lib/api";
import { countPlaceholders, hasPlaceholder } from "@/lib/facts";
import { fitOf } from "@/lib/fit";
import {
  bulletFeedback, carryClientState, findPlaceholder, missingAnswerFacts, normalizeAnalysis, planFill, saveAnswersInOrder,
} from "@/lib/analysis";
import { snapshotPatch } from "@/lib/outcomes";
import { applyStatusChange } from "@/lib/status";
import { isMissingColumn, isUniqueViolation, MIGRATION_HINT, OPTIONAL_JOB_COLUMNS } from "@/lib/db";
import { updateMaster } from "@/lib/master";
import {
  addAllFromMaster, addFromMaster, applyPull, cloneForJob, compareMap, diffFields, dismissAdditions, ensureBaseline, JOB_FIELDS,
  makeBaseline, missingOptionalColumns, omitKeys, planPull, readBaseline, replaceBullet, resolveRemoval, stripBaseline,
  type PullAddition, type PullRemoval,
} from "@/lib/tailor";
import { ResumeDocument } from "@/components/ResumeDocument";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { StatusSelect, FitBadge } from "@/components/StatusSelect";
import { DeadlineField } from "@/components/DeadlineField";
import { DocToolbar, FeedbackLegend, PageCount, PlaceholderCount, Toggle, UndoRedo } from "@/components/DocToolbar";
import { Menu, MenuItem } from "@/components/Menu";
import { SubmittedView, formatSubmitted } from "@/components/SubmittedView";
import { PullBanner } from "@/components/PullBanner";
import { FlashToast } from "@/components/FlashToast";
import { PlaceholderTextarea } from "@/components/PlaceholderTextarea";
import { confirmPlaceholders, downloadResumePdf, resumeTexts } from "@/components/pdfDownload";
import { SaveErrorToast, SaveStatus, useAutosaveWithRetry, worstStatus } from "@/lib/useAutosave";
import { useHistory } from "@/lib/useHistory";

type Tab = "resume" | "analysis" | "job" | "cover";
type Question = Analysis["questions"][number];

/** [key, phone label, desktop label] */
const TABS: [Tab, string, string][] = [
  ["resume", "Resume", "Tailored resume"],
  ["analysis", "Analysis", "Analysis"], // phones/tablets only; desktop shows it in the sidebar
  ["job", "Posting", "Job posting"],
  ["cover", "Letter", "Cover letter"],
];

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** Borderless input that's as wide as its text (company name next to the location on one line). */
function FitInput({
  value, placeholder, onChange, className = "",
}: { value: string; placeholder: string; onChange: (v: string) => void; className?: string }) {
  return (
    <span className={`inline-grid min-w-0 ${className}`}>
      <span aria-hidden className="invisible whitespace-pre col-start-1 row-start-1 px-1 py-0.5 border border-transparent overflow-hidden">
        {value || placeholder}
      </span>
      <input
        size={1}
        className="ghost-input col-start-1 row-start-1 w-full min-w-0"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [job, setJob] = useState<Job | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const doc = useHistory<Resume>();
  const resume = doc.value;
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
  const [flash, setFlash] = useState("");
  const [reveal, setReveal] = useState<{ id: string; n: number } | null>(null);
  const [viewingSubmitted, setViewingSubmitted] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** What's typed in each answer box (by question id). Lives here so a re-analysis can carry it over. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const autoRan = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The job row as last written, so autosave only sends the fields that changed (and can't clobber other tabs). */
  const lastSaved = useRef<Job | null>(null);
  /** Optional columns (migrations 0002/0003) this database doesn't have: never write them. */
  const missingCols = useRef<Set<string>>(new Set());
  const hintShown = useRef(false);
  /** The analysis object the server already stored (so the analysis autosave doesn't write it again). */
  const serverSaved = useRef<Analysis | null>(null);

  const fail = useCallback((e: unknown, fallback: string) => {
    console.warn(fallback, e);
    setError(friendlyError(e, fallback));
  }, []);

  useEffect(() => {
    (async () => {
      const [{ data: j, error: e1 }, { data: r, error: eR }, { data: m, error: eM }] = await Promise.all([
        supabase.from("jobs").select("*").eq("id", id).maybeSingle(),
        supabase.from("resumes").select("id, content").eq("job_id", id).maybeSingle(),
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
      const loaded: Job = { ...(j as Job), analysis: j.analysis ? normalizeAnalysis(j.analysis) : null };
      for (const c of OPTIONAL_JOB_COLUMNS) if (!(c in j)) missingCols.current.add(c);
      lastSaved.current = loaded;
      serverSaved.current = loaded.analysis;
      setMaster(masterResume);
      setJob(loaded);
      setDrafts(loaded.analysis?.answers ?? {});

      const open = async (row: { id: string; content: unknown }) => {
        setResumeId(row.id);
        const base = readBaseline(row.content);
        const tailored: Resume = { ...normalizeResume(row.content), ...(base ? { baseline: base } : {}) };
        let start: Resume;
        if (!isEmptyResume(tailored)) {
          const ensured = masterEmpty ? { resume: tailored, added: false } : ensureBaseline(tailored, masterResume);
          start = ensured.resume;
          // Copies made before baselines existed start tracking master changes from now.
          if (ensured.added) {
            const { error: eB } = await supabase.from("resumes").update({ content: start }).eq("id", row.id);
            if (eB) console.warn("Couldn't store the tailored copy's baseline:", eB.message);
          }
        } else {
          if (masterEmpty) return setNeedsMaster(true);
          // Self-heal: this copy was made before the master had content. Start it over from the master.
          start = cloneForJob(masterResume);
          const { error: e3 } = await supabase.from("resumes").update({ content: start }).eq("id", row.id);
          if (e3) return loadFail(e3, "Couldn't set up this job's tailored copy.");
        }
        setLoadedTexts(bulletTextMap(start));
        doc.reset(start);
      };

      if (r) return open(r);
      // Never create a tailored copy from an empty master; that copy would be a dead end.
      if (masterEmpty) return setNeedsMaster(true);
      // First visit: this job's tailored copy starts as a clone of the master (same bullet ids, so changes can be tracked).
      const { data: created, error: e2 } = await supabase
        .from("resumes")
        .insert({ job_id: id, name: `${j.company} ${j.title}`.trim(), content: cloneForJob(masterResume) })
        .select("id, content")
        .single();
      if (created && !e2) return open(created);
      if (!isUniqueViolation(e2)) return loadFail(e2, "Couldn't create this job's tailored copy.");
      // Another tab (or a double render) created it first: use that one.
      const { data: again, error: e4 } = await supabase.from("resumes").select("id, content").eq("job_id", id).single();
      if (e4 || !again) return loadFail(e4, "Couldn't load this job's tailored copy.");
      return open(again);
    })().catch((e) => {
      setLoadFailed(true);
      fail(e, "Couldn't load this job.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const saveResume = useCallback(
    async (r: Resume) => {
      if (!resumeId) return;
      const { error } = await supabase.from("resumes").update({ content: r }).eq("id", resumeId);
      if (error) throw error;
    },
    [resumeId, supabase],
  );
  const resumeSave = useAutosaveWithRetry(resume, saveResume);

  const saveJob = useCallback(
    async (j: Job) => {
      const prev = lastSaved.current;
      if (!prev) return;
      // Only what changed here since the last save: another tab's edits to other fields survive.
      const patch = diffFields(prev, j, JOB_FIELDS);
      const showHint = () => {
        if (hintShown.current) return;
        hintShown.current = true;
        setMigrationHint(true);
      };
      // A missing optional column (migration not run) is dropped from the write; the rest still saves.
      for (let attempt = 0; attempt <= OPTIONAL_JOB_COLUMNS.length; attempt++) {
        const write = omitKeys(patch, [...missingCols.current]);
        if (Object.keys(write).length < Object.keys(patch).length) showHint();
        if (!Object.keys(write).length) break;
        const { error } = await supabase.from("jobs").update(write).eq("id", j.id);
        if (!error) break;
        const left = OPTIONAL_JOB_COLUMNS.filter((c) => !missingCols.current.has(c) && c in write);
        if (!isMissingColumn(error) || !left.length) throw error;
        for (const c of missingOptionalColumns(error.message, left)) missingCols.current.add(c);
      }
      lastSaved.current = { ...prev, ...patch };
    },
    [supabase],
  );
  const jobSave = useAutosaveWithRetry(job, saveJob);

  // The analysis (answers, rejected suggestions, results the server couldn't store) saves on its own, with retries.
  const jobLoaded = job !== null;
  const jobAnalysis = job?.analysis ?? null;
  const analysisValue = useMemo(() => (jobLoaded ? { a: jobAnalysis } : null), [jobLoaded, jobAnalysis]);
  const saveAnalysis = useCallback(
    async ({ a }: { a: Analysis | null }) => {
      if (a === serverSaved.current) return;
      const { error } = await supabase.from("jobs").update({ analysis: a }).eq("id", id);
      if (error) throw error;
      serverSaved.current = a;
    },
    [supabase, id],
  );
  const analysisSave = useAutosaveWithRetry(analysisValue, saveAnalysis, 300);

  const saveState = worstStatus(jobSave.status, resumeSave.status, analysisSave.status);
  const { retry: retryJob } = jobSave;
  const { retry: retryResume } = resumeSave;
  const { retry: retryAnalysis } = analysisSave;
  const retrySaves = useCallback(() => {
    retryJob();
    retryResume();
    retryAnalysis();
  }, [retryJob, retryResume, retryAnalysis]);

  const analysis = job?.analysis ?? null;
  const fit = fitOf(analysis);
  const feedback = useMemo(() => bulletFeedback(analysis, resume, loadedTexts), [analysis, resume, loadedTexts]);
  // Document order, for "Review" and "Accept all". Stale or rejected suggestions are already left out.
  const pending = useMemo(() => {
    if (!resume) return [];
    return [...bulletTextMap(resume).keys()].filter((bid) => feedback[bid]?.suggestion).map((bid) => ({ id: bid, rewrite: feedback[bid].suggestion }));
  }, [resume, feedback]);
  const baseline = resume?.baseline;
  const compareTo = useMemo(() => compareMap(baseline, master), [baseline, master]);
  const changedCount = useMemo(() => (resume && compareTo ? countChangedBullets(resume, compareTo) : 0), [resume, compareTo]);
  const pull = useMemo(() => planPull(resume, master), [resume, master]);
  const placeholderCount = useMemo(() => (resume ? countPlaceholders(resumeTexts(resume)) : 0), [resume]);
  const missingFacts = useMemo(
    () => (analysis && master ? missingAnswerFacts(analysis.questions, analysis.answers, master.facts) : []),
    [analysis, master],
  );

  // The latest values, for async work that finishes later (an analysis takes 20-60s; drafts typed meanwhile count).
  const latest = useRef({ analysis, drafts });
  latest.current = { analysis, drafts };

  const analyze = useCallback(async () => {
    if (!resume) return;
    setAnalyzing(true);
    setAnalyzeError("");
    try {
      await saveResume(resume); // analyze exactly what's on screen
    } catch {
      /* the analyze route reads the last saved copy */
    }
    const { data, error } = await postApi<{ analysis: Analysis; saved?: boolean }>("/api/analyze", { jobId: id });
    setAnalyzing(false);
    if (error || !data?.analysis) return setAnalyzeError(error ?? "The analysis didn't come back. Try again.");
    // Keep answers and drafts typed on this page; match them to the new questions by text.
    const carried = carryClientState(latest.current.analysis, normalizeAnalysis(data.analysis), latest.current.drafts);
    // Stored by the server and nothing added here: no need to write it again. Otherwise the analysis autosave stores it.
    serverSaved.current = data.saved !== false && !carried.changed ? carried.analysis : serverSaved.current;
    setDrafts(carried.drafts);
    setJob((j) => (j ? { ...j, analysis: carried.analysis } : j));
    setError("");
  }, [resume, saveResume, id]);

  // Run the first analysis automatically so the tailored copy has suggestions right away.
  // (Never with an empty master: there's no tailored copy then, so `resume` stays null.)
  useEffect(() => {
    if (autoRan.current || !job || !resume) return;
    autoRan.current = true;
    if (!job.analysis && job.description.trim() && !isEmptyResume(resume)) analyze();
  }, [job, resume, analyze]);

  /** A successful action: say so briefly (as a toast) and clear any earlier error. */
  function showFlash(msg: string, ms = 3500) {
    setError("");
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(""), ms);
  }

  function selectTab(t: Tab) {
    setTab(t);
    setError("");
  }

  const setAnalysis = (fn: (a: Analysis) => Analysis) => setJob((j) => (j?.analysis ? { ...j, analysis: fn(j.analysis) } : j));

  function rejectSuggestion(bulletId: string) {
    setAnalysis((a) => ({ ...a, dismissed: [...(a.dismissed ?? []), bulletId] }));
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

  /** Put an answer in place of its placeholder in the tailored bullet, then show the bullet for editing. */
  function fillAnswer(q: Question, value: string) {
    const text = fillTarget(q);
    if (!resume || text === null || !q.bullet_id || !q.placeholder) return;
    const next = planFill(text, feedback[q.bullet_id]?.suggestion ?? "", q.placeholder, value);
    if (next === null) return;
    doc.set(replaceBullet(resume, q.bullet_id, next), true);
    selectTab("resume");
    setReveal({ id: q.bullet_id, n: Date.now() });
    showFlash(`Filled ${q.placeholder}. Edit the bullet if it reads oddly.`, 5000);
  }

  async function writeCoverLetter() {
    if (job?.cover_letter && !confirm("Replace the current cover letter?")) return;
    setWriting(true);
    setCoverError("");
    if (resume) await saveResume(resume).catch(() => {});
    const { data, error } = await postApi<{ cover_letter: string }>("/api/cover-letter", { jobId: id });
    setWriting(false);
    if (error || typeof data?.cover_letter !== "string") return setCoverError(error ?? "The letter didn't come back. Try again.");
    setJob((j) => (j ? { ...j, cover_letter: data.cover_letter } : j));
    setError("");
  }

  /** Facts first (on the master), then the answers on this job; see saveAnswersInOrder. */
  async function saveAnswers(answers: Record<string, string>): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
    const current = latest.current.analysis;
    if (!current) return { ok: false, error: "Run the analysis first." };
    const res = await saveAnswersInOrder({
      analysis: current,
      answers,
      writeMaster: (mutate) => updateMaster(supabase, mutate),
      // Queued on the analysis autosave (retries by itself); only answers change, on the analysis as it is now.
      persist: (next) => setAnalysis((a) => ({ ...a, answers: next.answers })),
    });
    if (!res.ok) {
      console.warn("Saving answers failed at", res.stage, res.error);
      return {
        ok: false,
        error: friendlyError(res.error, "Couldn't add them to your master resume's facts. Check your connection, then tap Retry."),
      };
    }
    setMaster(res.master);
    setError("");
    return { ok: true, added: res.added };
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

  async function makeMaster() {
    if (!resume) return;
    if (
      !confirm(
        "Replace your master resume with this tailored copy? Your facts stay on the master resume, and other jobs keep their own tailored copies.",
      )
    )
      return;
    const body = stripBaseline(resume);
    // Keep the master's facts: they live only on the master.
    const res = await updateMaster(supabase, (current) => ({ ...body, ...(current.facts ? { facts: current.facts } : {}) }));
    if (!res.ok) return fail(res.error, "Couldn't update your master resume. Try again.");
    setMaster(res.content);
    doc.set({ ...resume, baseline: makeBaseline(res.content) }, true); // nothing differs from the master anymore
    showFlash("Master resume updated");
  }

  async function changeStatus(next: JobStatus) {
    if (!job) return;
    const p = await applyStatusChange({
      job,
      next,
      sentResume: resume, // exactly what's on screen
      master,
      confirm: async (message) => window.confirm(message),
    });
    if (!p) return; // cancelled
    setError("");
    setJob((j) => (j ? { ...j, ...p } : j));
  }

  function replaceSnapshot() {
    if (!resume) return;
    if (!confirm("Replace the saved copy of what you sent with this job's current tailored copy? Only do this if you sent the updated version.")) return;
    if (!confirmPlaceholders(placeholderCount, "Your tailored copy", "Replace")) return;
    setJob((j) => (j ? { ...j, ...snapshotPatch(stripBaseline(resume), master) } : j));
    showFlash("Saved copy of what you sent updated");
  }

  async function deleteJob() {
    if (!confirm("Delete this job and its tailored copy?")) return;
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
          <Link href="/" className="btn min-h-10 sm:min-h-0">Back to tracker</Link>
        </div>
      </div>
    );
  }
  if (!job) return <p className="text-muted">Loading…</p>;
  const patch = (p: Partial<Job>) => setJob((j) => (j ? { ...j, ...p } : j));
  const coverPlaceholders = countPlaceholders([job.cover_letter]);

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
    />
  );

  return (
    <div className="space-y-2 sm:space-y-3">
      {/* Job header */}
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="w-full lg:flex-1 lg:min-w-64">
          <input
            className="ghost-input w-full text-lg sm:text-xl font-semibold"
            value={job.title}
            placeholder="Job title"
            aria-label="Job title"
            onChange={(e) => patch({ title: e.target.value })}
          />
          <div className="flex items-center gap-0.5 text-base sm:text-sm text-muted min-w-0">
            <FitInput className="max-w-[55%] shrink-0" value={job.company} placeholder="Company" onChange={(v) => patch({ company: v })} />
            <span aria-hidden>·</span>
            <FitInput className="flex-1 sm:flex-none" value={job.location} placeholder="Location" onChange={(v) => patch({ location: v })} />
            {job.url && (
              <a href={job.url} target="_blank" rel="noreferrer" className="shrink-0 px-1 py-0.5 text-sm underline hover:text-fg">
                Posting ↗
              </a>
            )}
          </div>
        </div>
        <div className="flex w-full lg:w-auto flex-wrap items-center gap-x-3 gap-y-2">
          <StatusSelect value={job.status} onChange={changeStatus} />
          <button
            type="button"
            className="sm:hidden btn btn-sm min-h-10"
            aria-expanded={detailsOpen}
            aria-controls="job-details"
            onClick={() => setDetailsOpen((o) => !o)}
          >
            Details {detailsOpen ? "▴" : "▾"}
          </button>
          <span className="ml-auto lg:ml-0">
            <SaveStatus status={saveState} />
          </span>
          {/* Phones: inside the "Details" disclosure. Desktop: inline. */}
          <div
            id="job-details"
            className={`${detailsOpen ? "flex" : "hidden"} sm:flex w-full sm:w-auto flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface p-2 sm:border-0 sm:bg-transparent sm:p-0`}
          >
            <label className="text-xs text-muted flex items-center gap-1.5">
              Follow up
              <input
                type="date"
                className="ghost-input text-xs border-border sm:border-transparent"
                value={job.follow_up_date ?? ""}
                onChange={(e) => patch({ follow_up_date: e.target.value || null })}
              />
            </label>
            <DeadlineField compact value={job.deadline ?? null} status={job.status} onChange={(v) => patch({ deadline: v })} />
            <button type="button" className="text-xs text-muted hover:text-bad py-1 min-h-10 sm:min-h-0 ml-auto sm:ml-0" onClick={deleteJob}>
              Delete job
            </button>
          </div>
        </div>
      </div>

      {job.submitted_at && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm sm:rounded-lg sm:border sm:border-border sm:bg-surface sm:px-3 sm:py-1.5">
          <span>
            <span className="text-good">✓</span> Applied {formatSubmitted(job.submitted_at)}
          </span>
          {job.submitted_resume && (
            <>
              <span className="text-muted" aria-hidden>·</span>
              <button type="button" className="text-accent underline underline-offset-2 sm:py-1" onClick={() => setViewingSubmitted(true)}>
                View what you sent
              </button>
            </>
          )}
        </div>
      )}

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
            {key === "analysis" && analyzeError && <span className="text-bad" aria-label="Analysis failed">!</span>}
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
                  {pending.length > 0 ? (
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
                  <PlaceholderCount count={placeholderCount} onClick={goToPlaceholder} />
                  <span className="hidden sm:inline-flex"><Toggle on={showFeedback} onChange={setShowFeedback} label="Feedback" /></span>
                  {showFeedback && (analysis || changedCount > 0) && (
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
                      <MenuItem className="sm:hidden" onSelect={() => setShowFeedback((v) => !v)}>
                        {showFeedback ? "Hide feedback and changes" : "Show feedback and changes"}
                      </MenuItem>
                      <MenuItem onSelect={makeMaster} hint="Replaces your master resume with this tailored copy (facts are kept)">
                        Save this tailored copy as my master resume…
                      </MenuItem>
                      <MenuItem onSelect={resetFromMaster} hint="Discards this job's tailored edits" danger>
                        Start over from master resume…
                      </MenuItem>
                    </Menu>
                  </div>
                </DocToolbar>
                <PullBanner
                  plan={pull}
                  onPull={pullFromMaster}
                  onAdd={addOne}
                  onAddAll={addAll}
                  onDismissAdditions={leaveOut}
                  onRemoval={onRemoval}
                />
                <ResumeDocument
                  value={resume}
                  onChange={doc.set}
                  feedback={feedback}
                  showHighlights={showFeedback}
                  baseline={compareTo}
                  showChanges={showFeedback}
                  onReject={rejectSuggestion}
                  onMeasure={setMeasure}
                  actionsSlot={slot}
                  reveal={reveal}
                />
              </>
            )}
          </div>

          {tab === "job" && (
            <div className="card p-4 space-y-3">
              <input
                className="input w-full text-sm"
                value={job.url}
                placeholder="Posting URL"
                aria-label="Posting URL"
                onChange={(e) => patch({ url: e.target.value })}
              />
              <textarea
                className="input w-full min-h-[60vh] text-sm leading-relaxed"
                value={job.description}
                aria-label="Job description"
                placeholder="Paste the job description here."
                onChange={(e) => patch({ description: e.target.value })}
              />
              <textarea
                className="input w-full h-24 text-sm"
                value={job.notes}
                placeholder="Notes: referral, recruiter name…"
                aria-label="Notes"
                onChange={(e) => patch({ notes: e.target.value })}
              />
            </div>
          )}
          {tab === "cover" && (
            <div className="card p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-muted flex-1 min-w-48">Only send one if the application asks. Replace every [placeholder] first.</p>
                {coverPlaceholders > 0 && (
                  <span className="chip border-[#e0b100] bg-[#fff6d6] text-[#5c4300]">
                    {plural(coverPlaceholders, "placeholder")} left
                  </span>
                )}
                {job.cover_letter && (
                  <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={copyCoverLetter}>
                    Copy as text
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm btn-primary min-h-10 sm:min-h-0"
                  onClick={writeCoverLetter}
                  disabled={writing || !resume}
                >
                  {writing ? "Writing…" : job.cover_letter ? "Regenerate" : "Draft cover letter"}
                </button>
              </div>
              {coverError && !writing && (
                <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-bad/40 bg-bad-bg px-3 py-2 text-sm">
                  <span className="flex-1 min-w-48 text-bad">{coverError}</span>
                  <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={writeCoverLetter}>Retry</button>
                </div>
              )}
              <PlaceholderTextarea
                boxClassName="input w-full min-h-[50vh] text-sm leading-relaxed"
                value={job.cover_letter}
                placeholder="Draft a cover letter, or write your own here."
                aria-label="Cover letter"
                onChange={(e) => patch({ cover_letter: e.target.value })}
              />
            </div>
          )}
        </div>

        <aside
          className={`${tab === "analysis" ? "" : "hidden"} lg:block lg:sticky lg:top-[4.5rem] lg:self-start lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto`}
        >
          {panel}
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

      <FlashToast message={flash} raised={saveState === "error"} onClose={() => setFlash("")} />
      <SaveErrorToast status={saveState} onRetry={retrySaves} />
    </div>
  );
}
