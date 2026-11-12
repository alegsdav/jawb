"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { bulletTextMap, emptyResume, isEmptyResume, normalizeResume, uid } from "@/lib/resume";
import type { Analysis, BankBullet, Job, Resume } from "@/lib/types";
import { postApi } from "@/lib/api";
import { ResumeDocument } from "@/components/ResumeDocument";
import { ResumeActions } from "@/components/ResumeActions";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { StatusSelect, applyDates, FitBadge } from "@/components/StatusSelect";
import { DocToolbar, PageCount, Toggle, UndoRedo } from "@/components/DocToolbar";
import { SaveStatus, useAutosave } from "@/lib/useAutosave";
import { useHistory } from "@/lib/useHistory";

type Tab = "resume" | "analysis" | "job" | "cover";

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [job, setJob] = useState<Job | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const doc = useHistory<Resume>();
  const resume = doc.value;
  const [master, setMaster] = useState<Map<string, string> | null>(null);
  const [bank, setBank] = useState<BankBullet[]>([]);
  const [tab, setTab] = useState<Tab>("resume");
  const [analyzing, setAnalyzing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [showHighlights, setShowHighlights] = useState(true);
  const [showChanges, setShowChanges] = useState(true);
  const [measure, setMeasure] = useState({ pages: 1, overflowLines: 0 });
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
  const autoRan = useRef(false);
  const [promoted, setPromoted] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: j, error: e1 }, { data: r }, { data: b }, { data: m }] = await Promise.all([
        supabase.from("jobs").select("*").eq("id", id).single(),
        supabase.from("resumes").select("id, content").eq("job_id", id).maybeSingle(),
        supabase.from("bullets").select("*").order("created_at"),
        supabase.from("resumes").select("content").eq("is_master", true).maybeSingle(),
      ]);
      if (e1 || !j) return setError(e1?.message ?? "Job not found");
      const masterResume = m ? normalizeResume(m.content) : emptyResume();
      setMaster(bulletTextMap(masterResume));
      setJob(j as Job);
      setBank((b as BankBullet[]) ?? []);
      if (r) {
        setResumeId(r.id);
        doc.reset(normalizeResume(r.content));
        return;
      }
      // First visit: this job's tailored copy starts as a clone of the master (same bullet ids, so changes can be tracked).
      const { data: created, error: e2 } = await supabase
        .from("resumes")
        .insert({ job_id: id, name: `${j.company} ${j.title}`.trim(), content: masterResume })
        .select("id")
        .single();
      if (e2) return setError(e2.message);
      setResumeId(created.id);
      doc.reset(masterResume);
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
          cover_letter: j.cover_letter,
        })
        .eq("id", j.id);
      if (error) throw error;
    },
    [supabase],
  );
  const jobStatus = useAutosave(job, saveJob);

  const analysis = job?.analysis ?? null;
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
    if (!resume || !master) return 0;
    let n = 0;
    for (const [bid, text] of bulletTextMap(resume)) if (master.get(bid) !== text) n++;
    return n;
  }, [resume, master]);

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
  useEffect(() => {
    if (autoRan.current || !job || !resume) return;
    autoRan.current = true;
    if (!job.analysis && job.description.trim() && !isEmptyResume(resume)) analyze();
  }, [job, resume, analyze]);

  async function persistAnalysis(next: Analysis) {
    setJob((j) => (j ? { ...j, analysis: next } : j));
    await supabase.from("jobs").update({ analysis: next }).eq("id", id);
  }

  function rejectSuggestion(bulletId: string) {
    if (!analysis) return;
    persistAnalysis({ ...analysis, dismissed: [...(analysis.dismissed ?? []), bulletId] });
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
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLTextAreaElement>(`[data-bullet="${next.id}"]`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.focus({ preventScroll: true });
    });
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

  async function saveAnswers(answers: Record<string, string>) {
    if (analysis) await persistAnalysis({ ...analysis, answers });
  }

  async function answerToBank(question: string, answer: string) {
    const source = job ? `${job.company} application notes` : "Application notes";
    const { data } = await supabase
      .from("bullets")
      .insert({ source, text: `${answer.trim()}  (re: ${question})`, tags: ["from-question"] })
      .select()
      .single();
    if (data) setBank((b) => [...b, data as BankBullet]);
  }

  function insertBullet(itemId: string, text: string) {
    doc.set(
      (r) => ({
        ...r,
        sections: r.sections.map((s) => ({
          ...s,
          items: s.items.map((it) => (it.id === itemId ? { ...it, bullets: [...it.bullets, { id: uid(), text }] } : it)),
        })),
      }),
      true,
    );
  }

  async function resetFromMaster() {
    if (!confirm("Replace this tailored resume with a fresh copy of your master resume?")) return;
    const { data: m } = await supabase.from("resumes").select("content").eq("is_master", true).maybeSingle();
    if (m) {
      const fresh = normalizeResume(m.content);
      setMaster(bulletTextMap(fresh));
      doc.set(fresh, true);
    }
  }

  async function makeMaster() {
    if (!resume) return;
    if (!confirm("Replace your master resume with this tailored version? Other jobs keep their own copies.")) return;
    const content = resume;
    const { data: m } = await supabase.from("resumes").select("id").eq("is_master", true).maybeSingle();
    const { error } = m
      ? await supabase.from("resumes").update({ content }).eq("id", m.id)
      : await supabase.from("resumes").insert({ is_master: true, name: "Master resume", content });
    if (error) return setError(error.message);
    setMaster(bulletTextMap(content)); // nothing differs from the master anymore
    setPromoted(true);
    setTimeout(() => setPromoted(false), 2500);
  }

  async function deleteJob() {
    if (!confirm("Delete this job and its tailored resume?")) return;
    await supabase.from("jobs").delete().eq("id", id);
    router.push("/");
  }

  if (error && !job) return <p className="text-bad">{error}</p>;
  if (!job || !resume) return <p className="text-muted">Loading…</p>;
  const patch = (p: Partial<Job>) => setJob({ ...job, ...p });

  const panel = (
    <AnalysisPanel
      analysis={analysis}
      analyzing={analyzing}
      onAnalyze={analyze}
      onSaveAnswers={saveAnswers}
      onAnswerToBank={answerToBank}
      bank={bank}
      resume={resume}
      onInsertBullet={insertBullet}
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
            onChange={(e) => patch({ title: e.target.value })}
          />
          <div className="flex flex-wrap gap-1 text-sm text-muted">
            <input className="ghost-input" value={job.company} placeholder="Company" onChange={(e) => patch({ company: e.target.value })} />
            <input className="ghost-input" value={job.location} placeholder="Location" onChange={(e) => patch({ location: e.target.value })} />
            {job.url && (
              <a href={job.url} target="_blank" rel="noreferrer" className="px-1 py-0.5 underline hover:text-fg">Posting ↗</a>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SaveStatus status={jobStatus === "saved" ? resumeStatus : jobStatus} />
          <StatusSelect
            value={job.status}
            onChange={(status) => patch({ status, ...(status === "applied" && !job.date_applied ? applyDates() : {}) })}
          />
          <label className="text-xs text-muted flex items-center gap-1">
            Follow up
            <input
              type="date"
              className="input py-1 text-xs"
              value={job.follow_up_date ?? ""}
              onChange={(e) => patch({ follow_up_date: e.target.value || null })}
            />
          </label>
          <button className="text-xs text-muted hover:text-bad" onClick={deleteJob}>Delete</button>
        </div>
      </div>

      {error && <p className="text-sm text-bad">{error}</p>}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
        {(
          [
            ["resume", "Tailored resume"],
            ["analysis", "Analysis"],
            ["job", "Job description"],
            ["cover", "Cover letter"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`shrink-0 px-3 py-2 text-sm -mb-px border-b-2 flex items-center gap-1.5 ${key === "analysis" ? "lg:hidden" : ""} ${
              tab === key ? "border-accent text-fg font-medium" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {label}
            {key === "analysis" && analysis && <FitBadge score={analysis.fit_score} />}
            {key === "resume" && pending.length > 0 && (
              <span className="chip border-0 bg-accent text-[var(--accent-fg)] px-1.5">{pending.length}</span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className={`min-w-0 space-y-3 ${tab === "analysis" ? "hidden lg:block" : ""}`}>
          {(tab === "resume" || tab === "analysis") && (
            <>
              <DocToolbar onSlot={setSlot}>
                <UndoRedo undo={doc.undo} redo={doc.redo} canUndo={doc.canUndo} canRedo={doc.canRedo} />
                {pending.length > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-accent">{pending.length} suggestion{pending.length > 1 ? "s" : ""}</span>
                    <button className="btn btn-sm" onClick={reviewNext}>Review</button>
                    <button className="btn btn-sm btn-primary" onClick={acceptAll}>Accept all</button>
                  </div>
                ) : analyzing ? (
                  <span className="text-xs text-muted">Analyzing against the job…</span>
                ) : analysis ? (
                  <span className="text-xs text-muted">No pending suggestions</span>
                ) : null}
                <Toggle on={showHighlights} onChange={setShowHighlights} label="Highlights" />
                <Toggle on={showChanges} onChange={setShowChanges} label={`Changes vs master${changedCount ? ` (${changedCount})` : ""}`} />
                <span className="hidden md:inline"><PageCount {...measure} /></span>
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <button className="btn btn-sm" onClick={resetFromMaster} title="Replace this copy with your master">Reset</button>
                  <button className="btn btn-sm" onClick={makeMaster} title="Replace your master with this copy">
                    {promoted ? "Master updated ✓" : "Set as master"}
                  </button>
                  <ResumeActions resume={resume} fileName={`${resume.header.name} Resume ${job.company}`} />
                </div>
              </DocToolbar>
              {showHighlights && analysis && (
                <p className="text-xs text-muted px-1 flex flex-wrap gap-x-3 gap-y-1">
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#1f8a4c]" /> strong</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#c98a12]" /> okay</span>
                  <span><span className="inline-block h-2 w-2 rounded-full bg-[#c53030]" /> weak</span>
                  <span><span className="inline-block h-2.5 w-[3px] rounded bg-[#2f5bd3]" /> changed from master</span>
                  <span>Click a bullet to see feedback and suggested edits.</span>
                </p>
              )}
              <ResumeDocument
                value={resume}
                onChange={doc.set}
                feedback={feedback}
                showHighlights={showHighlights}
                baseline={master}
                showChanges={showChanges}
                rejected={rejected}
                onReject={rejectSuggestion}
                onMeasure={setMeasure}
                actionsSlot={slot}
              />
            </>
          )}
          {tab === "job" && (
            <div className="card p-4 space-y-3">
              <input className="input w-full text-sm" value={job.url} placeholder="Posting URL" onChange={(e) => patch({ url: e.target.value })} />
              <textarea
                className="input w-full min-h-[60vh] text-sm leading-relaxed"
                value={job.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
              <textarea
                className="input w-full h-24 text-sm"
                value={job.notes}
                placeholder="Notes: referral, recruiter name, deadline…"
                onChange={(e) => patch({ notes: e.target.value })}
              />
            </div>
          )}
          {tab === "cover" && (
            <div className="card p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-muted flex-1 min-w-48">Only send one if the application asks. Replace every [placeholder] first.</p>
                {job.cover_letter && (
                  <button className="btn btn-sm" onClick={() => navigator.clipboard.writeText(job.cover_letter)}>Copy</button>
                )}
                <button className="btn btn-sm btn-primary" onClick={writeCoverLetter} disabled={writing}>
                  {writing ? "Writing…" : job.cover_letter ? "Regenerate" : "Draft cover letter"}
                </button>
              </div>
              <textarea
                className="input w-full min-h-[50vh] text-sm leading-relaxed"
                value={job.cover_letter}
                placeholder="Draft a cover letter, or write your own here."
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
    </div>
  );
}
