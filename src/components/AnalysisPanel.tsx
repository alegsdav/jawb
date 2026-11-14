"use client";

import { useRef, useState } from "react";
import type { Analysis } from "@/lib/types";
import { fitOf } from "@/lib/fit";
import { suggestFill } from "@/lib/analysis";
import { FitBadge } from "./StatusSelect";

type Question = Analysis["questions"][number];

type Props = {
  analysis: Analysis | null;
  analyzing: boolean;
  onAnalyze: () => void;
  /** Why the last analysis failed (already user-friendly); shown in the panel with a Retry button. */
  error?: string;
  /** When set, analysis can't run yet; shown in place of the usual blurb and the button is disabled. */
  disabledReason?: string;
  /**
   * What's typed in each answer box, by question id (kept by the page so a re-analysis can't wipe it).
   * Starts as the stored answers.
   */
  drafts: Record<string, string>;
  onDraftsChange: (drafts: Record<string, string>) => void;
  /**
   * Write the answers' facts to the facts table, then store the answers on the analysis.
   * `error` is a plain-language sentence. Never rejects.
   */
  onSaveAnswers: (answers: Record<string, string>) => Promise<{ ok: true; added: number } | { ok: false; error: string }>;
  /** Ids of answered questions whose fact isn't saved yet (e.g. an earlier save failed there). */
  missingFacts: string[];
  /** Suggested edits still waiting (stale ones excluded). */
  pendingCount: number;
  onReview: () => void;
  onAcceptAll: () => void;
  /** Whether this question's placeholder can be filled in its bullet right now. */
  canFill?: (q: Question) => boolean;
  /** Put `value` in place of the question's placeholder in its bullet (and show the bullet). */
  onFill?: (q: Question, value: string) => void;
  /**
   * The job was marked Applied and "Keep editing" is off: show the verdict and keywords only (no
   * questions, suggested edits or re-analyze), since edits no longer change what was sent.
   */
  quiet?: boolean;
};

const SEVERITY: Record<string, string> = { high: "text-bad", medium: "text-ok", low: "text-muted" };

/** "Fill [N users] in the bullet with: [300 users] [Fill]", prefilled from the answer and editable. */
function FillRow({ q, answer, onFill }: { q: Question; answer: string; onFill: (q: Question, value: string) => void }) {
  const [edited, setEdited] = useState<string | null>(null);
  const value = edited ?? suggestFill(q.placeholder ?? "", answer);
  return (
    <div className="rounded-lg border border-[#e0b100]/60 bg-[#fff6d6] p-2 text-[#5c4300] space-y-1.5">
      <p className="text-xs">
        Fill <strong className="rounded bg-[#ffd84d] px-1 text-[#3d2c00]">{q.placeholder}</strong> in the bullet with:
      </p>
      <div className="flex gap-1.5">
        <input
          className="input min-w-0 flex-1 py-1 text-sm text-fg"
          value={value}
          onChange={(e) => setEdited(e.target.value)}
          aria-label={`Text to put in place of ${q.placeholder}`}
        />
        <button type="button" className="btn btn-sm btn-primary shrink-0 min-h-10 sm:min-h-0" disabled={!value.trim()} onClick={() => onFill(q, value)}>
          Fill
        </button>
      </div>
    </div>
  );
}

export function AnalysisPanel(p: Props) {
  const a = p.analysis;
  const fit = fitOf(a);
  const answers = p.drafts;
  const [savedNote, setSavedNote] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const unanswered = a?.questions.filter((q) => !a.answers?.[q.id]?.trim()) ?? [];
  const answered = a?.questions.filter((q) => a.answers?.[q.id]?.trim()) ?? [];
  const norm = (r: Record<string, string> | undefined) =>
    JSON.stringify(Object.entries(r ?? {}).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v).sort());
  const dirty = norm(answers) !== norm(a?.answers);
  // Saved on the job but not (yet) on the master: saving again repairs it.
  const missing = p.missingFacts.length;
  const canSave = (dirty || missing > 0) && !saving;

  async function save() {
    setSaving(true);
    const res = await p.onSaveAnswers(answers);
    setSaving(false);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    if (!res.ok) {
      setSavedNote("");
      setSaveError(res.error); // stays until a save works
      return;
    }
    setSaveError("");
    setSavedNote(res.added ? "Saved to your facts. Re-analyze to use them." : "Saved.");
    noteTimer.current = setTimeout(() => setSavedNote(""), 6000);
  }

  function fill(q: Question, value: string) {
    p.onFill?.(q, value);
    if (dirty || missing) void save(); // keep the answer too, so other jobs can use it
  }

  const field = (q: Question) => {
    const answer = answers[q.id] ?? "";
    return (
      <div key={q.id} className="space-y-1.5">
        <p className="text-sm font-medium">{q.question}</p>
        {q.why && <p className="text-xs text-muted">{q.why}</p>}
        <textarea
          className="input w-full h-16 text-sm"
          value={answer}
          onChange={(e) => p.onDraftsChange({ ...answers, [q.id]: e.target.value })}
          placeholder="Your answer (rough is fine; numbers help)"
          aria-label={q.question}
        />
        {answer.trim() && q.placeholder && p.onFill && p.canFill?.(q) && <FillRow q={q} answer={answer} onFill={fill} />}
      </div>
    );
  };

  const saveRow = (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn btn-sm min-h-10 sm:min-h-0" disabled={!canSave} onClick={save}>
        {saving ? "Saving…" : "Save answers"}
      </button>
      {dirty && !saving && <span className="text-xs text-muted">Unsaved answers</span>}
    </div>
  );

  const errorBox = saveError && !saving && (
    <div role="alert" className="card border-bad/40 bg-bad-bg p-3 text-sm space-y-2">
      <p className="text-bad">
        <strong>Your answers aren&apos;t saved yet.</strong> {saveError}
      </p>
      <p className="text-xs text-muted">They&apos;re still in the boxes below. Nothing is lost while this page is open.</p>
      <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={save}>
        Retry
      </button>
    </div>
  );

  const missingBox = missing > 0 && !dirty && !saveError && !saving && (
    <div role="status" className="card border-ok/40 bg-ok-bg p-3 text-sm space-y-2">
      <p>
        {missing === 1 ? "1 answer isn't" : `${missing} answers aren't`} in your facts yet, so other jobs can&apos;t use{" "}
        {missing === 1 ? "it" : "them"}.
      </p>
      <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={save}>
        Save answers
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="font-semibold">Analysis</h2>
          {fit && <FitBadge fit={fit} />}
          {!p.quiet && (
            <button className="btn btn-primary btn-sm ml-auto min-h-10 sm:min-h-0" onClick={p.onAnalyze} disabled={p.analyzing || !!p.disabledReason}>
              {p.analyzing ? "Analyzing…" : a ? "Re-analyze" : "Analyze fit"}
            </button>
          )}
        </div>
        {p.quiet && (
          <p className="text-xs text-muted">
            {a ? "From before you applied. " : "No analysis was run before you applied. "}Turn on &ldquo;Keep editing&rdquo; to tailor this copy
            again for a re-apply.
          </p>
        )}
        {p.error && !p.analyzing && !p.quiet && (
          <div role="alert" className="rounded-lg border border-bad/40 bg-bad-bg p-3 text-sm space-y-2">
            <p className="text-bad">{p.error}</p>
            <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={p.onAnalyze} disabled={!!p.disabledReason}>
              Retry
            </button>
          </div>
        )}
        {p.quiet ? null : p.disabledReason ? (
          <p className="text-sm text-muted">{p.disabledReason}</p>
        ) : (
          !a &&
          !p.analyzing &&
          !p.error && (
            <p className="text-sm text-muted">
              Compares this tailored copy against the job: overall fit, missing keywords, a rating for every bullet with
              suggested rewrites, and questions for anything it needs from you. Usually takes 20–60 seconds.
            </p>
          )
        )}
        {a && <p className="text-sm">{a.verdict}</p>}
        {a && !p.quiet && p.pendingCount > 0 && (
          <div className="rounded-lg bg-accent/5 border border-accent/30 p-3 space-y-2">
            <p className="text-sm">
              <strong>{p.pendingCount} suggested edit{p.pendingCount > 1 ? "s" : ""}</strong> to tailor your resume for this job.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button className="btn btn-sm min-h-10 sm:min-h-0" onClick={p.onReview}>Review one by one</button>
              <button className="btn btn-sm btn-primary min-h-10 sm:min-h-0" onClick={p.onAcceptAll}>Accept all</button>
            </div>
          </div>
        )}
        {a?.analyzed_at && (
          <p className="text-xs text-muted">
            Last run {new Date(a.analyzed_at).toLocaleString()}. Bullets you edit after that lose their rating until you re-analyze.
          </p>
        )}
      </div>

      {a && (
        <>
          {!p.quiet && errorBox}
          {!p.quiet && unanswered.length > 0 && (
            <div className="card p-4 space-y-3 border-accent">
              <h3 className="label text-accent">Questions for you</h3>
              {unanswered.map(field)}
              <p className="text-xs text-muted">Answers are saved to your facts, so other jobs can use them too.</p>
              {saveRow}
            </div>
          )}
          {/* Outside the questions card: once everything is answered that card goes away. */}
          {savedNote && (
            <p role="status" className="card px-4 py-3 text-sm text-good">
              {savedNote}
            </p>
          )}
          {!p.quiet && missingBox}

          {!p.quiet && answered.length > 0 && (
            <details className="card p-4 text-sm">
              <summary className="label cursor-pointer">Your answers ({answered.length}) · edit</summary>
              <div className="mt-3 space-y-3">
                {answered.map(field)}
                <p className="text-xs text-muted">Editing an answer replaces its fact.</p>
                {saveRow}
              </div>
            </details>
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
        </>
      )}
    </div>
  );
}
