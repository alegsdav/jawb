"use client";

import { useRef, useState } from "react";
import type { Analysis } from "@/lib/types";
import { suggestFill } from "@/lib/analysis";

type Question = Analysis["questions"][number];

type Props = {
  /** Unanswered questions about the selected bullet. */
  questions: Question[];
  /** The job's analysis: its stored answers decide what's unsaved. */
  analysis: Analysis;
  /** What's typed in each answer box, by question id (kept by the page). */
  drafts: Record<string, string>;
  onDraftsChange: (drafts: Record<string, string>) => void;
  /** Write the answers' facts, then store the answers on the analysis. `error` is plain language; never rejects. */
  onSaveAnswers: (answers: Record<string, string>) => Promise<{ ok: true; added: number } | { ok: false; error: string }>;
  /** Ids of answered questions whose fact isn't saved yet (e.g. an earlier save failed there). */
  missingFacts: string[];
  /** Whether this question's placeholder can be filled in its bullet right now. */
  canFill: (q: Question) => boolean;
  /** Put `value` in place of the question's placeholder in its bullet. */
  onFill: (q: Question, value: string) => void;
};

/** "Fill [N users] in the bullet with: [300 users] [Fill]", prefilled from the answer and editable. */
function FillRow({ q, answer, onFill }: { q: Question; answer: string; onFill: (q: Question, value: string) => void }) {
  const [edited, setEdited] = useState<string | null>(null);
  const value = edited ?? suggestFill(q.placeholder ?? "", answer);
  return (
    <div className="space-y-1.5">
      <p className="text-xs">
        Fill <strong className="rounded border border-border bg-surface-2 px-1 text-fg">{q.placeholder}</strong> in the bullet with:
      </p>
      <div className="flex gap-1.5">
        <input
          className="input min-w-0 flex-1 py-1 text-[13px] text-fg"
          value={value}
          onChange={(e) => setEdited(e.target.value)}
          aria-label={`Text to put in place of ${q.placeholder}`}
        />
        <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[13px] font-medium text-fg hover:bg-surface-2 disabled:opacity-50 shrink-0" disabled={!value.trim()} onClick={() => onFill(q, value)}>
          Fill
        </button>
      </div>
    </div>
  );
}

/**
 * The analysis questions for the bullet the user selected, each with its answer box. Answers are saved to
 * the facts (so other jobs can use them). Any unsaved answer, on any bullet, gets the save row here.
 */
export function BulletQuestions({ questions, analysis, drafts, onDraftsChange, onSaveAnswers, missingFacts, canFill, onFill }: Props) {
  const [savedNote, setSavedNote] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const norm = (r: Record<string, string> | undefined) =>
    JSON.stringify(Object.entries(r ?? {}).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v).sort());
  const dirty = norm(drafts) !== norm(analysis.answers);
  // Saved on the job but not (yet) on the master: saving again repairs it.
  const missing = missingFacts.length;
  const canSave = (dirty || missing > 0) && !saving;

  async function save() {
    setSaving(true);
    const res = await onSaveAnswers(drafts);
    setSaving(false);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    if (!res.ok) {
      setSavedNote("");
      setSaveError(res.error); // stays until a save works
      return;
    }
    setSaveError("");
    setSavedNote(res.added ? "Saved to your facts." : "Saved.");
    noteTimer.current = setTimeout(() => setSavedNote(""), 6000);
  }

  function fill(q: Question, value: string) {
    onFill(q, value);
    if (dirty || missing) void save(); // keep the answer too, so other jobs can use it
  }

  if (!questions.length && !dirty && !missing && !saveError && !savedNote) return null;

  const button = "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50";

  return (
    <div className="space-y-8">
      {questions.map((q) => {
        const answer = drafts[q.id] ?? "";
        return (
          <div key={q.id} className="space-y-2">
            <p className="text-[15px] text-fg">{q.question}</p>
            {q.why && <p className="text-xs text-muted">{q.why}</p>}
            <textarea
              className="input h-20 w-full text-[13px]"
              value={answer}
              onChange={(e) => onDraftsChange({ ...drafts, [q.id]: e.target.value })}
              placeholder="Your answer (rough is fine; numbers help)"
              aria-label={q.question}
            />
            {answer.trim() && q.placeholder && canFill(q) && <FillRow q={q} answer={answer} onFill={fill} />}
          </div>
        );
      })}
      {questions.length > 0 && <p className="text-xs text-muted">Answers are saved to your facts, so other jobs can use them too.</p>}

      {(dirty || missing > 0) && !saving && !saveError && (
        <div className="flex flex-wrap items-center gap-2">
          <button className={button} disabled={!canSave} onClick={save}>
            Save answers
          </button>
          {dirty && <span className="text-xs text-muted">Unsaved answers</span>}
        </div>
      )}
      {saving && <p className="text-xs text-muted">Saving…</p>}
      {saveError && !saving && (
        <div role="alert" className="space-y-2 text-[13px]">
          <p className="text-bad">
            <strong>Your answers aren&apos;t saved yet.</strong> {saveError}
          </p>
          <p className="text-xs text-muted">They&apos;re still in the boxes above. Nothing is lost while this page is open.</p>
          <button type="button" className={button} onClick={save}>
            Retry
          </button>
        </div>
      )}
      {missing > 0 && !dirty && !saveError && !saving && (
        <p role="status" className="text-[13px]">
          {missing === 1 ? "1 answer isn't" : `${missing} answers aren't`} in your facts yet, so other jobs can&apos;t use{" "}
          {missing === 1 ? "it" : "them"}.
        </p>
      )}
      {savedNote && (
        <p role="status" className="text-[13px] text-good">
          {savedNote}
        </p>
      )}
    </div>
  );
}
