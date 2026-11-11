"use client";

import { useState } from "react";
import type { Analysis, BankBullet, Resume } from "@/lib/types";
import { FitBadge } from "./StatusSelect";

type Props = {
  analysis: Analysis | null;
  analyzing: boolean;
  onAnalyze: () => void;
  onSaveAnswers: (answers: Record<string, string>) => Promise<void>;
  onAnswerToBank: (question: string, answer: string) => Promise<void>;
  bank: BankBullet[];
  resume: Resume;
  onInsertBullet: (itemId: string, text: string) => void;
};

const SEVERITY: Record<string, string> = { high: "text-bad", medium: "text-ok", low: "text-muted" };

export function AnalysisPanel(p: Props) {
  const a = p.analysis;
  const [answers, setAnswers] = useState<Record<string, string>>(a?.answers ?? {});
  const [savedNote, setSavedNote] = useState("");
  const [lastAnalyzed, setLastAnalyzed] = useState(a?.analyzed_at);
  if (a?.analyzed_at !== lastAnalyzed) {
    // New analysis arrived: sync the answer drafts with what's stored.
    setLastAnalyzed(a?.analyzed_at);
    setAnswers(a?.answers ?? {});
  }

  const items = p.resume.sections.flatMap((s) =>
    s.items.filter((it) => it.bullets.length || it.dates).map((it) => ({ id: it.id, label: `${s.title}: ${it.title || it.subtitle}` })),
  );
  const unanswered = a?.questions.filter((q) => !a.answers?.[q.id]?.trim()) ?? [];
  const answered = a?.questions.filter((q) => a.answers?.[q.id]?.trim()) ?? [];
  const dirty = JSON.stringify(answers) !== JSON.stringify(a?.answers ?? {});

  async function save() {
    await p.onSaveAnswers(answers);
    setSavedNote("Saved. Re-analyze to use your answers.");
    setTimeout(() => setSavedNote(""), 4000);
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">Analysis</h2>
          {a && <FitBadge score={a.fit_score} />}
          <button className="btn btn-primary btn-sm ml-auto" onClick={p.onAnalyze} disabled={p.analyzing}>
            {p.analyzing ? "Analyzing…" : a ? "Re-analyze" : "Analyze fit"}
          </button>
        </div>
        {!a && !p.analyzing && (
          <p className="text-sm text-muted">
            Compares this tailored resume against the job: fit score, missing keywords, a rating for every bullet with
            suggested rewrites, and questions for anything it needs from you.
          </p>
        )}
        {a && <p className="text-sm">{a.verdict}</p>}
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
                  {answers[q.id]?.trim() && (
                    <button className="text-xs text-muted hover:text-fg" onClick={() => p.onAnswerToBank(q.question, answers[q.id])}>
                      Also save to bullet bank
                    </button>
                  )}
                </div>
              ))}
              <div className="flex items-center gap-2">
                <button className="btn btn-sm" disabled={!dirty} onClick={save}>Save answers</button>
                {savedNote && <span className="text-xs text-muted">{savedNote}</span>}
              </div>
            </div>
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

          {a.bank_suggestions.length > 0 && (
            <div className="card p-4 space-y-3">
              <h3 className="label">From your bullet bank</h3>
              {a.bank_suggestions.map((s) => {
                const b = p.bank.find((x) => x.id === s.bank_id);
                if (!b) return null;
                return <BankSuggestion key={s.bank_id} text={b.text} reason={s.reason} items={items} onInsert={p.onInsertBullet} />;
              })}
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

function BankSuggestion({
  text, reason, items, onInsert,
}: {
  text: string;
  reason: string;
  items: { id: string; label: string }[];
  onInsert: (itemId: string, text: string) => void;
}) {
  const [target, setTarget] = useState(items[0]?.id ?? "");
  const [done, setDone] = useState(false);
  return (
    <div className="text-sm space-y-1">
      <p>{text}</p>
      <p className="text-xs text-muted">{reason}</p>
      <div className="flex gap-1.5">
        <select className="input py-1 text-xs flex-1 min-w-0" value={target} onChange={(e) => setTarget(e.target.value)}>
          {items.map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
        </select>
        <button
          className="btn btn-sm"
          disabled={!target || done}
          onClick={() => {
            onInsert(target, text);
            setDone(true);
          }}
        >
          {done ? "Added" : "Add"}
        </button>
      </div>
    </div>
  );
}
