"use client";

import { useState } from "react";
import type { Analysis } from "@/lib/types";
import { fitOf } from "@/lib/fit";
import { FitBadge } from "./StatusSelect";

type Props = {
  analysis: Analysis | null;
  analyzing: boolean;
  onAnalyze: () => void;
  /** When set, analysis can't run yet; shown in place of the usual blurb and the button is disabled. */
  disabledReason?: string;
  /**
   * Store the answers on the analysis and append them to the master resume's facts.
   * Resolves true when facts were written to the master; rejects on failure.
   */
  onSaveAnswers: (answers: Record<string, string>) => Promise<boolean>;
  pendingCount: number;
  onReview: () => void;
  onAcceptAll: () => void;
};

const SEVERITY: Record<string, string> = { high: "text-bad", medium: "text-ok", low: "text-muted" };

export function AnalysisPanel(p: Props) {
  const a = p.analysis;
  const fit = fitOf(a);
  const [answers, setAnswers] = useState<Record<string, string>>(a?.answers ?? {});
  const [savedNote, setSavedNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastAnalyzed, setLastAnalyzed] = useState(a?.analyzed_at);
  if (a?.analyzed_at !== lastAnalyzed) {
    // New analysis arrived: sync the answer drafts with what's stored.
    setLastAnalyzed(a?.analyzed_at);
    setAnswers(a?.answers ?? {});
  }

  const unanswered = a?.questions.filter((q) => !a.answers?.[q.id]?.trim()) ?? [];
  const answered = a?.questions.filter((q) => a.answers?.[q.id]?.trim()) ?? [];
  const dirty = JSON.stringify(answers) !== JSON.stringify(a?.answers ?? {});

  async function save() {
    setSaving(true);
    try {
      const toFacts = await p.onSaveAnswers(answers);
      setSavedNote(toFacts ? "Saved to your master resume's facts. Re-analyze to use them." : "Saved.");
    } catch (e) {
      setSavedNote(`Couldn't save: ${e instanceof Error ? e.message : "try again"}`);
    }
    setSaving(false);
    setTimeout(() => setSavedNote(""), 6000);
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="font-semibold">Analysis</h2>
          {fit && <FitBadge fit={fit} />}
          <button className="btn btn-primary btn-sm ml-auto" onClick={p.onAnalyze} disabled={p.analyzing || !!p.disabledReason}>
            {p.analyzing ? "Analyzing…" : a ? "Re-analyze" : "Analyze fit"}
          </button>
        </div>
        {p.disabledReason ? (
          <p className="text-sm text-muted">{p.disabledReason}</p>
        ) : (
          !a &&
          !p.analyzing && (
            <p className="text-sm text-muted">
              Compares this tailored copy against the job: overall fit, missing keywords, a rating for every bullet with
              suggested rewrites, and questions for anything it needs from you. Usually takes 20–60 seconds.
            </p>
          )
        )}
        {a && <p className="text-sm">{a.verdict}</p>}
        {a && p.pendingCount > 0 && (
          <div className="rounded-lg bg-accent/5 border border-accent/30 p-3 space-y-2">
            <p className="text-sm">
              <strong>{p.pendingCount} suggested edit{p.pendingCount > 1 ? "s" : ""}</strong> to tailor your resume for this job.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button className="btn btn-sm" onClick={p.onReview}>Review one by one</button>
              <button className="btn btn-sm btn-primary" onClick={p.onAcceptAll}>Accept all</button>
            </div>
          </div>
        )}
        {a?.analyzed_at && (
          <p className="text-xs text-muted">Last run {new Date(a.analyzed_at).toLocaleString()}. Edits since then aren&apos;t reflected until you re-analyze.</p>
        )}
      </div>

      {a && (
        <>
          {unanswered.length > 0 && (
            <div className="card p-4 space-y-3 border-accent">
              <h3 className="label text-accent">Questions for you</h3>
              {unanswered.map((q) => (
                <div key={q.id} className="space-y-1">
                  <p className="text-sm font-medium">{q.question}</p>
                  <p className="text-xs text-muted">{q.why}</p>
                  <textarea
                    className="input w-full h-16 text-sm"
                    value={answers[q.id] ?? ""}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    placeholder="Your answer (rough is fine; numbers help)"
                  />
                </div>
              ))}
              <p className="text-xs text-muted">Answers are added to your master resume&apos;s facts, so other jobs can use them too.</p>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn btn-sm" disabled={!dirty || saving} onClick={save}>
                  {saving ? "Saving…" : "Save answers"}
                </button>
              </div>
            </div>
          )}
          {/* Outside the questions card: once everything is answered that card goes away. */}
          {savedNote && (
            <p role="status" className={`card px-4 py-3 text-sm ${savedNote.startsWith("Couldn't") ? "text-bad" : "text-good"}`}>
              {savedNote}
            </p>
          )}

          <div className="card p-4 space-y-2">
            <h3 className="label">Keywords</h3>
            <div className="flex flex-wrap gap-1">
              {a.keywords.missing.map((k) => (
                <span key={k} className="chip border-bad/40 text-bad" title="In the posting, missing from your resume">{k}</span>
              ))}
              {a.keywords.matched.map((k) => (
                <span key={k} className="chip border-good/40 text-good" title="Matched">{k}</span>
              ))}
            </div>
            <p className="text-xs text-muted">Red = in the posting but not on your resume. Only add ones that are true.</p>
          </div>

          {a.gaps.length > 0 && (
            <div className="card p-4 space-y-2">
              <h3 className="label">Gaps to fix</h3>
              <ul className="space-y-2 text-sm">
                {a.gaps.map((g, i) => (
                  <li key={i}>
                    <span className={`text-xs font-semibold uppercase ${SEVERITY[g.severity]}`}>{g.severity}</span>{" "}
                    {g.issue}
                    <div className="text-muted text-xs mt-0.5">→ {g.fix}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {a.strengths.length > 0 && (
            <div className="card p-4 space-y-2">
              <h3 className="label">Strengths for this job</h3>
              <ul className="list-disc pl-5 text-sm space-y-1">
                {a.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {answered.length > 0 && (
            <details className="card p-4 text-sm">
              <summary className="label cursor-pointer">Your answers ({answered.length})</summary>
              <ul className="mt-2 space-y-2">
                {answered.map((q) => (
                  <li key={q.id}>
                    <p className="text-muted">{q.question}</p>
                    <p>{a.answers?.[q.id]}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
