"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { emptyResume, normalizeResume, uid } from "@/lib/resume";
import type { Analysis, BankBullet, Job, Resume } from "@/lib/types";
import { ResumeEditor } from "@/components/ResumeEditor";
import { ResumeActions } from "@/components/ResumeActions";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { StatusSelect, applyDates } from "@/components/StatusSelect";
import { SaveStatus, useAutosave } from "@/lib/useAutosave";

type Tab = "resume" | "job" | "cover" | "analysis";

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();

  const [job, setJob] = useState<Job | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [resume, setResume] = useState<Resume | null>(null);
  const [bank, setBank] = useState<BankBullet[]>([]);
  const [tab, setTab] = useState<Tab>("resume");
  const [analyzing, setAnalyzing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const [{ data: j, error: e1 }, { data: r }, { data: b }] = await Promise.all([
        supabase.from("jobs").select("*").eq("id", id).single(),
        supabase.from("resumes").select("id, content").eq("job_id", id).maybeSingle(),
        supabase.from("bullets").select("*").order("created_at"),
      ]);
      if (e1 || !j) return setError(e1?.message ?? "Job not found");
      setJob(j as Job);
      setBank((b as BankBullet[]) ?? []);
      if (r) {
        setResumeId(r.id);
        setResume(normalizeResume(r.content));
        return;
      }
      // First visit: clone the master resume into a tailored copy for this job.
      const { data: master } = await supabase.from("resumes").select("content").eq("is_master", true).maybeSingle();
      const content = master ? normalizeResume(master.content) : emptyResume();
      const { data: created, error: e2 } = await supabase
        .from("resumes")
        .insert({ job_id: id, name: `${j.company} ${j.title}`.trim(), content })
        .select("id")
        .single();
      if (e2) return setError(e2.message);
      setResumeId(created.id);
      setResume(content);
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

  const feedback = useMemo(() => {
    const map: Record<string, Analysis["bullets"][number]> = {};
    for (const b of job?.analysis?.bullets ?? []) if (!dismissed.has(b.bullet_id)) map[b.bullet_id] = b;
    return map;
  }, [job?.analysis, dismissed]);

  async function analyze() {
    if (!resume) return;
    setAnalyzing(true);
    setError("");
    await saveResume(resume); // analyze what's on screen
    const res = await fetch("/api/analyze", { method: "POST", body: JSON.stringify({ jobId: id }) });
    const json = await res.json();
    setAnalyzing(false);
    if (!res.ok) return setError(json.error);
    setDismissed(new Set());
    setJob((j) => (j ? { ...j, analysis: json.analysis } : j));
  }

  async function writeCoverLetter() {
    if (job?.cover_letter && !confirm("Replace the current cover letter?")) return;
    setWriting(true);
    setError("");
    if (resume) await saveResume(resume);
    const res = await fetch("/api/cover-letter", { method: "POST", body: JSON.stringify({ jobId: id }) });
    const json = await res.json();
    setWriting(false);
    if (!res.ok) return setError(json.error);
    setJob((j) => (j ? { ...j, cover_letter: json.cover_letter } : j));
  }

  async function saveAnswers(answers: Record<string, string>) {
    if (!job?.analysis) return;
    const analysis = { ...job.analysis, answers };
    setJob({ ...job, analysis });
    await supabase.from("jobs").update({ analysis }).eq("id", id);
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
    setResume((r) =>
      r && {
        ...r,
        sections: r.sections.map((s) => ({
          ...s,
          items: s.items.map((it) => (it.id === itemId ? { ...it, bullets: [...it.bullets, { id: uid(), text }] } : it)),
        })),
      },
    );
  }

  async function resetFromMaster() {
    if (!confirm("Replace this tailored resume with a fresh copy of your master resume?")) return;
    const { data: master } = await supabase.from("resumes").select("content").eq("is_master", true).maybeSingle();
    if (master) setResume(normalizeResume(master.content));
  }

  async function deleteJob() {
    if (!confirm("Delete this job and its tailored resume?")) return;
    await supabase.from("jobs").delete().eq("id", id);
    router.push("/");
  }

  if (error && !job) return <p className="text-bad">{error}</p>;
  if (!job || !resume) return <p className="text-muted">Loading…</p>;
  const patch = (p: Partial<Job>) => setJob({ ...job, ...p });

  return (
    <div className="space-y-4">
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
              <a href={job.url} target="_blank" rel="noreferrer" className="px-1 py-0.5 underline hover:text-fg">
                Posting ↗
              </a>
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

      <div className="flex gap-1 border-b border-border overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
        {(
          [
            ["resume", "Tailored resume"],
            ["job", "Job description"],
            ["cover", "Cover letter"],
            ["analysis", "Analysis"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`shrink-0 px-3 py-2 text-sm -mb-px border-b-2 ${key === "analysis" ? "lg:hidden" : ""} ${tab === key ? "border-accent text-fg font-medium" : "border-transparent text-muted hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className={`min-w-0 space-y-3 ${tab === "analysis" ? "hidden lg:block" : ""}`}>
          {(tab === "resume" || tab === "analysis") && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-xs text-muted flex-1">
                  Edits here only change this job&apos;s copy. Bullets get colored after you analyze.
                </p>
                <button className="btn btn-sm" onClick={resetFromMaster}>Reset from master</button>
                <ResumeActions resume={resume} fileName={`${resume.header.name} Resume ${job.company}`} />
              </div>
              <ResumeEditor
                value={resume}
                onChange={setResume}
                feedback={feedback}
                onDismissFeedback={(bid) => setDismissed((d) => new Set(d).add(bid))}
              />
            </>
          )}
          {tab === "job" && (
            <div className="card p-4 space-y-3">
              <input
                className="input w-full text-sm"
                value={job.url}
                placeholder="Posting URL"
                onChange={(e) => patch({ url: e.target.value })}
              />
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
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted flex-1">
                  Only send one if the application asks. Replace every [placeholder] before sending.
                </p>
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

        <aside className={`${tab === "analysis" ? "" : "hidden"} lg:block lg:sticky lg:top-[4.5rem] lg:self-start lg:max-h-[calc(100vh-5.5rem)] lg:overflow-y-auto`}>
          <AnalysisPanel
            analysis={job.analysis}
            analyzing={analyzing}
            onAnalyze={analyze}
            onSaveAnswers={saveAnswers}
            onAnswerToBank={answerToBank}
            bank={bank}
            resume={resume}
            onInsertBullet={insertBullet}
          />
        </aside>
      </div>
    </div>
  );
}
