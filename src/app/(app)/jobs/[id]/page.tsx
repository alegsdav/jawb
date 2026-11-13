"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { bulletTextMap, emptyResume, isEmptyResume, normalizeResume, resumeToPlainText } from "@/lib/resume";
import type { Analysis, Job, JobStatus, Resume } from "@/lib/types";
import { postApi } from "@/lib/api";
import { addFacts } from "@/lib/facts";
import { fitOf } from "@/lib/fit";
import { shouldSnapshot, snapshotPatch } from "@/lib/outcomes";
import { ResumeDocument } from "@/components/ResumeDocument";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { StatusSelect, applyDates, FitBadge } from "@/components/StatusSelect";
import { DocToolbar, PageCount, Toggle, UndoRedo } from "@/components/DocToolbar";
import { Menu, MenuItem } from "@/components/Menu";
import { SubmittedView, formatSubmitted } from "@/components/SubmittedView";
import { downloadResumePdf } from "@/components/pdfDownload";
import { SaveStatus, useAutosave } from "@/lib/useAutosave";
import { useHistory } from "@/lib/useHistory";

type Tab = "resume" | "analysis" | "job" | "cover";

const TABS: [Tab, string][] = [
  ["resume", "Resume"],
  ["analysis", "Analysis"], // phones only; desktop shows it in the sidebar
  ["job", "Job posting"],
  ["cover", "Cover letter"],
];

/** A job's tailored copy is the master without its facts (facts stay on the master and never go to employers). */
function cloneForJob(master: Resume): Resume {
  const { facts: _facts, ...body } = master;
  void _facts;
  return structuredClone(body);
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
  /** The master is empty, so there's nothing to tailor yet. */
  const [needsMaster, setNeedsMaster] = useState(false);
  const [tab, setTab] = useState<Tab>("resume");
  const [analyzing, setAnalyzing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [showFeedback, setShowFeedback] = useState(true);
  const [measure, setMeasure] = useState({ pages: 1, overflowLines: 0 });
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [reveal, setReveal] = useState<{ id: string; n: number } | null>(null);
  const [viewingSubmitted, setViewingSubmitted] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const autoRan = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: j, error: e1 }, { data: r }, { data: m }] = await Promise.all([
        supabase.from("jobs").select("*").eq("id", id).single(),
        supabase.from("resumes").select("id, content").eq("job_id", id).maybeSingle(),
        supabase.from("resumes").select("content").eq("is_master", true).maybeSingle(),
      ]);
      if (e1 || !j) return setError(e1?.message ?? "Job not found");
      const masterResume = m ? normalizeResume(m.content) : emptyResume();
      const masterEmpty = isEmptyResume(masterResume);
      setMaster(masterResume);
      setJob(j as Job);

      if (r) {
        setResumeId(r.id);
        const tailored = normalizeResume(r.content);
        if (!isEmptyResume(tailored)) return doc.reset(tailored);
        if (masterEmpty) return setNeedsMaster(true);
        // Self-heal: this copy was made before the master had content. Start it over from the master.
        const fresh = cloneForJob(masterResume);
        const { error: e3 } = await supabase.from("resumes").update({ content: fresh }).eq("id", r.id);
        if (e3) return setError(e3.message);
        return doc.reset(fresh);
      }
      // Never create a tailored copy from an empty master; that copy would be a dead end.
      if (masterEmpty) return setNeedsMaster(true);
      // First visit: this job's tailored copy starts as a clone of the master (same bullet ids, so changes can be tracked).
      const fresh = cloneForJob(masterResume);
      const { data: created, error: e2 } = await supabase
        .from("resumes")
        .insert({ job_id: id, name: `${j.company} ${j.title}`.trim(), content: fresh })
        .select("id")
        .single();
      if (e2) return setError(e2.message);
      setResumeId(created.id);
      doc.reset(fresh);
    })();
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
  const resumeStatus = useAutosave(resume, saveResume);

  const saveJob = useCallback(
    async (j: Job) => {
      const { error } = await supabase
        .from("jobs")
        .update({
          company: j.company, title: j.title, location: j.location, url: j.url, description: j.description,
          status: j.status, date_applied: j.date_applied, follow_up_date: j.follow_up_date, notes: j.notes,
          cover_letter: j.cover_letter, deadline: j.deadline,
          submitted_resume: j.submitted_resume, submitted_at: j.submitted_at, submitted_tailored: j.submitted_tailored,
        })
        .eq("id", j.id);
      if (error) throw error;
    },
    [supabase],
  );
  const jobStatus = useAutosave(job, saveJob);

  const analysis = job?.analysis ?? null;
  const fit = fitOf(analysis);
  const masterMap = useMemo(() => (master ? bulletTextMap(master) : null), [master]);
  const feedback = useMemo(() => {
    const map: Record<string, Analysis["bullets"][number]> = {};
    for (const b of analysis?.bullets ?? []) map[b.bullet_id] = b;
    return map;
  }, [analysis]);
  const rejected = useMemo(() => new Set(analysis?.dismissed ?? []), [analysis]);

  const pending = useMemo(() => {
    if (!resume) return [];
    const out: { id: string; rewrite: string }[] = [];
    for (const s of resume.sections)
      for (const it of s.items)
        for (const b of it.bullets) {
          const fb = feedback[b.id];
          if (fb?.rewrite && fb.rewrite.trim() !== b.text.trim() && !rejected.has(b.id)) out.push({ id: b.id, rewrite: fb.rewrite });
        }
    return out;
  }, [resume, feedback, rejected]);

  const changedCount = useMemo(() => {
    if (!resume || !masterMap) return 0;
    let n = 0;
    for (const [bid, text] of bulletTextMap(resume)) if (masterMap.get(bid) !== text) n++;
    return n;
  }, [resume, masterMap]);

  const analyze = useCallback(async () => {
    if (!resume) return;
    setAnalyzing(true);
    setError("");
    try {
      await saveResume(resume); // analyze exactly what's on screen
    } catch {
      /* the analyze route reads the last saved copy */
    }
    const { data, error } = await postApi<{ analysis: Analysis }>("/api/analyze", { jobId: id });
    setAnalyzing(false);
    if (error || !data) return setError(error ?? "Analysis failed.");
    setJob((j) => (j ? { ...j, analysis: data.analysis } : j));
  }, [resume, saveResume, id]);

  // Run the first analysis automatically so the tailored copy has suggestions right away.
  // (Never with an empty master: there's no tailored copy then, so `resume` stays null.)
  useEffect(() => {
    if (autoRan.current || !job || !resume) return;
    autoRan.current = true;
    if (!job.analysis && job.description.trim() && !isEmptyResume(resume)) analyze();
  }, [job, resume, analyze]);

  function showFlash(msg: string) {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(""), 3500);
  }

  async function persistAnalysis(next: Analysis) {
    setJob((j) => (j ? { ...j, analysis: next } : j));
    const { error } = await supabase.from("jobs").update({ analysis: next }).eq("id", id);
    if (error) throw error;
  }

  function rejectSuggestion(bulletId: string) {
    if (!analysis) return;
    persistAnalysis({ ...analysis, dismissed: [...(analysis.dismissed ?? []), bulletId] }).catch((e) => setError(e.message));
  }

  function acceptAll() {
    if (!resume || !pending.length) return;
    const map = new Map(pending.map((p) => [p.id, p.rewrite]));
    doc.set(
      {
        ...resume,
        sections: resume.sections.map((s) => ({
          ...s,
          items: s.items.map((it) => ({ ...it, bullets: it.bullets.map((b) => (map.has(b.id) ? { ...b, text: map.get(b.id)! } : b)) })),
        })),
      },
      true,
    );
  }

  function reviewNext() {
    const next = pending[0];
    if (!next) return;
    setTab("resume");
    setReveal({ id: next.id, n: Date.now() });
  }

  async function writeCoverLetter() {
    if (job?.cover_letter && !confirm("Replace the current cover letter?")) return;
    setWriting(true);
    setError("");
    if (resume) await saveResume(resume).catch(() => {});
    const { data, error } = await postApi<{ cover_letter: string }>("/api/cover-letter", { jobId: id });
    setWriting(false);
    if (error || !data) return setError(error ?? "Couldn't draft the letter.");
    setJob((j) => (j ? { ...j, cover_letter: data.cover_letter } : j));
  }

  /** Stores the answers on this analysis and appends them to the master's facts. True if facts were written. */
  async function saveAnswers(answers: Record<string, string>): Promise<boolean> {
    if (!analysis) return false;
    await persistAnalysis({ ...analysis, answers });
    const facts = analysis.questions.flatMap((q) => {
      const a = answers[q.id]?.trim();
      return a ? [`${a} (re: ${q.question.trim()})`] : [];
    });
    if (!facts.length) return false;
    const { data: m, error } = await supabase.from("resumes").select("id, content").eq("is_master", true).maybeSingle();
    if (error) throw error;
    if (!m) throw new Error("you don't have a master resume yet");
    const current = normalizeResume(m.content);
    const next = addFacts(current, facts);
    if (next !== current) {
      const { error: e2 } = await supabase.from("resumes").update({ content: next }).eq("id", m.id);
      if (e2) throw e2;
    }
    return true;
  }

  async function downloadPdf() {
    if (!resume || !job) return;
    setPdfBusy(true);
    try {
      await downloadResumePdf(resume, `${resume.header.name} Resume ${job.company}`);
    } catch {
      setError("Couldn't build the PDF. Try again.");
    } finally {
      setPdfBusy(false);
    }
  }

  function copyText() {
    if (!resume) return;
    navigator.clipboard.writeText(resumeToPlainText(resume)).then(
      () => showFlash("Copied as text"),
      () => setError("Couldn't copy to the clipboard."),
    );
  }

  async function resetFromMaster() {
    if (!confirm("This job's tailored edits will be discarded and replaced with your current master.")) return;
    const { data: m, error } = await supabase.from("resumes").select("content").eq("is_master", true).maybeSingle();
    if (error) return setError(error.message);
    const fresh = m ? normalizeResume(m.content) : emptyResume();
    if (isEmptyResume(fresh)) return setError("Your master resume is empty. Import it on the Master resume page first.");
    setMaster(fresh);
    doc.set(cloneForJob(fresh), true);
    showFlash("Replaced with your master (Undo to go back)");
  }

  async function makeMaster() {
    if (!resume) return;
    if (!confirm("Your master resume will be replaced by this job's version. Other jobs keep their own copies.")) return;
    const { data: m, error: e1 } = await supabase.from("resumes").select("id, content").eq("is_master", true).maybeSingle();
    if (e1) return setError(e1.message);
    // Keep the master's facts: they live only on the master.
    const facts = m ? normalizeResume(m.content).facts : undefined;
    const content: Resume = { ...cloneForJob(resume), ...(facts ? { facts } : {}) };
    const { error } = m
      ? await supabase.from("resumes").update({ content }).eq("id", m.id)
      : await supabase.from("resumes").insert({ is_master: true, name: "Master resume", content });
    if (error) return setError(error.message);
    setMaster(content); // nothing differs from the master anymore
    showFlash("Master resume updated");
  }

  function changeStatus(status: JobStatus) {
    if (!job) return;
    const p: Partial<Job> = { status };
    // Freeze exactly what was sent, the first time the job moves past "To apply" (someone may jump straight to Interview).
    const firstSubmit = shouldSnapshot(status, job.submitted_at);
    if (!job.date_applied && (firstSubmit || status === "applied")) Object.assign(p, applyDates());
    if (firstSubmit && resume) Object.assign(p, snapshotPatch(resume, master));
    setJob((j) => (j ? { ...j, ...p } : j));
  }

  function replaceSnapshot() {
    if (!resume) return;
    if (!confirm("Replace the saved submitted copy with this job's current resume? Only do this if you sent the updated version.")) return;
    setJob((j) => (j ? { ...j, ...snapshotPatch(resume, master) } : j));
    showFlash("Submitted copy updated");
  }

  async function deleteJob() {
    if (!confirm("Delete this job and its tailored resume?")) return;
    await supabase.from("jobs").delete().eq("id", id);
    router.push("/");
  }

  if (error && !job) return <p className="text-bad">{error}</p>;
  if (!job) return <p className="text-muted">Loading…</p>;
  const patch = (p: Partial<Job>) => setJob((j) => (j ? { ...j, ...p } : j));

  const panel = (
    <AnalysisPanel
      analysis={analysis}
      analyzing={analyzing}
      onAnalyze={analyze}
      disabledReason={needsMaster ? "Import your resume first, then the analysis runs automatically." : !resume ? "Loading your resume…" : undefined}
      onSaveAnswers={saveAnswers}
      pendingCount={pending.length}
      onReview={reviewNext}
      onAcceptAll={acceptAll}
    />
  );

  return (
    <div className="space-y-3">
      {/* Job header */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="w-full sm:flex-1 sm:min-w-64">
          <input
            className="ghost-input w-full text-lg sm:text-xl font-semibold"
            value={job.title}
            placeholder="Job title"
            aria-label="Job title"
            onChange={(e) => patch({ title: e.target.value })}
          />
          <div className="flex flex-wrap gap-1 text-sm text-muted">
            <input className="ghost-input min-w-0" value={job.company} placeholder="Company" aria-label="Company" onChange={(e) => patch({ company: e.target.value })} />
            <input className="ghost-input min-w-0" value={job.location} placeholder="Location" aria-label="Location" onChange={(e) => patch({ location: e.target.value })} />
            {job.url && (
              <a href={job.url} target="_blank" rel="noreferrer" className="px-1 py-0.5 underline hover:text-fg">Posting ↗</a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
          <SaveStatus status={jobStatus === "saved" ? resumeStatus : jobStatus} />
          <StatusSelect value={job.status} onChange={changeStatus} />
          <label className="text-xs text-muted flex items-center gap-1">
            Follow up
            <input
              type="date"
              className="input py-1 text-xs"
              value={job.follow_up_date ?? ""}
              onChange={(e) => patch({ follow_up_date: e.target.value || null })}
            />
          </label>
          <label className="text-xs text-muted flex items-center gap-1">
            Deadline
            <input
              type="date"
              className="input py-1 text-xs"
              value={job.deadline ?? ""}
              onChange={(e) => patch({ deadline: e.target.value || null })}
            />
          </label>
          <button type="button" className="text-xs text-muted hover:text-bad py-1" onClick={deleteJob}>Delete</button>
        </div>
      </div>

      {job.submitted_at && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
          <span>
            <span className="text-good">✓</span> Submitted {formatSubmitted(job.submitted_at)}
          </span>
          {job.submitted_resume && (
            <>
              <span className="text-muted" aria-hidden>·</span>
              <button type="button" className="text-accent underline underline-offset-2" onClick={() => setViewingSubmitted(true)}>
                View submitted version
              </button>
            </>
          )}
        </div>
      )}

      {error && <p className="text-sm text-bad">{error}</p>}

      {/* Tabs */}
      <div role="tablist" className="flex border-b border-border overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 sm:gap-1">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`shrink-0 px-2 sm:px-3 py-2 text-sm -mb-px border-b-2 flex items-center gap-1.5 ${key === "analysis" ? "lg:hidden" : ""} ${
              tab === key ? "border-accent text-fg font-medium" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {label}
            {/* No room for the chip at phone width; the Analysis tab itself shows it. */}
            {key === "analysis" && fit && <span className="hidden sm:inline-flex"><FitBadge fit={fit} /></span>}
            {key === "resume" && pending.length > 0 && (
              <span className="chip border-0 bg-accent text-[var(--accent-fg)] px-1.5">{pending.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className={`min-w-0 space-y-3 ${tab === "analysis" ? "hidden lg:block" : ""}`}>
          {/* Kept mounted across tabs so selection and "Review" requests survive tab switches. */}
          <div className={`space-y-3 ${tab === "resume" || tab === "analysis" ? "" : "hidden"}`}>
            {needsMaster ? (
              <div className="card p-6 sm:p-10 text-center space-y-3">
                <h2 className="text-lg font-semibold">Import your resume first</h2>
                <p className="text-sm text-muted max-w-md mx-auto">
                  Each job gets its own tailored copy of your master resume. Your master is empty, so there&apos;s nothing to
                  tailor yet. Upload your resume PDF (or paste it), then come back to this job.
                </p>
                <Link href="/resume" className="btn btn-primary">Import your resume</Link>
              </div>
            ) : !resume ? (
              <p className="text-sm text-muted">Loading resume…</p>
            ) : (
              <>
                <DocToolbar onSlot={setSlot}>
                  <UndoRedo undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
                  {pending.length > 0 ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-accent">{pending.length} suggestion{pending.length > 1 ? "s" : ""}</span>
                      <button type="button" className="btn btn-sm" onClick={reviewNext}>Review</button>
                      <button type="button" className="btn btn-sm btn-primary" onClick={acceptAll}>Accept all</button>
                    </div>
                  ) : analyzing ? (
                    <span className="text-xs text-muted">Analyzing against the job…</span>
                  ) : null}
                  <Toggle on={showFeedback} onChange={setShowFeedback} label="Show feedback" />
                  <span className="hidden md:inline"><PageCount {...measure} /></span>
                  <div className="ml-auto flex items-center gap-1.5">
                    {flash && <span role="status" className="text-xs text-good">{flash}</span>}
                    <button type="button" className="btn btn-sm btn-primary" onClick={downloadPdf} disabled={pdfBusy}>
                      {pdfBusy ? "Building…" : "Download PDF"}
                    </button>
                    <Menu label="More ▾">
                      <MenuItem onSelect={copyText}>Copy as text</MenuItem>
                      <MenuItem onSelect={makeMaster} hint="Replaces your master resume with this job's version">
                        Save this version as my master…
                      </MenuItem>
                      <MenuItem onSelect={resetFromMaster} hint="Discards this job's tailored edits" danger>
                        Start over from master…
                      </MenuItem>
                    </Menu>
                  </div>
                </DocToolbar>
                {showFeedback && (analysis || changedCount > 0) && (
                  <p className="text-xs text-muted px-1 flex flex-wrap gap-x-3 gap-y-1">
                    {analysis && (
                      <>
                        <span><span className="inline-block h-2 w-2 rounded-full bg-[#1f8a4c]" /> strong</span>
                        <span><span className="inline-block h-2 w-2 rounded-full bg-[#c98a12]" /> okay</span>
                        <span><span className="inline-block h-2 w-2 rounded-full bg-[#c53030]" /> weak</span>
                      </>
                    )}
                    <span>
                      <span className="inline-block h-2.5 w-[3px] rounded bg-[#2f5bd3]" /> changed from master
                      {changedCount ? ` (${changedCount})` : ""}
                    </span>
                    <span>Click a bullet to see feedback and suggested edits.</span>
                  </p>
                )}
                <ResumeDocument
                  value={resume}
                  onChange={doc.set}
                  feedback={feedback}
                  showHighlights={showFeedback}
                  baseline={masterMap}
                  showChanges={showFeedback}
                  rejected={rejected}
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
                {job.cover_letter && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      navigator.clipboard.writeText(job.cover_letter).then(
                        () => showFlash("Copied"),
                        () => setError("Couldn't copy to the clipboard."),
                      )
                    }
                  >
                    {flash === "Copied" ? "Copied" : "Copy"}
                  </button>
                )}
                <button type="button" className="btn btn-sm btn-primary" onClick={writeCoverLetter} disabled={writing || !resume}>
                  {writing ? "Writing…" : job.cover_letter ? "Regenerate" : "Draft cover letter"}
                </button>
              </div>
              <textarea
                className="input w-full min-h-[50vh] text-sm leading-relaxed"
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
    </div>
  );
}
