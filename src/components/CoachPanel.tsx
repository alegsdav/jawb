"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Fact, Resume } from "@/lib/types";
import { postApi } from "@/lib/api";
import { answerFact } from "@/lib/analysis";
import { plural } from "@/lib/facts";
import {
  coachedFactPlan, coachRequest, exampleSegments, initialChoices, resolveBlanks, type AnatomyPart, type BlankChoice, type CoachExample,
  type CoachQuestion, type CoachTarget,
} from "@/lib/coaching";
import type { FactsApi } from "@/lib/useFacts";
import { markPlaceholders } from "./PlaceholderTextarea";
import { UndoToast } from "./UndoToast";
import { CHOICES, choiceClass, choiceOfStage, rowGapClass, type ChoiceMode } from "@/lib/coachChoice";

const PART_LABEL: Record<AnatomyPart, string> = { verb: "Verb", scope: "Scope", tool: "Tool", result: "Result" };
const PART_CLS: Record<AnatomyPart, string> = {
  verb: "border-accent/40 text-accent",
  scope: "border-good/40 text-good",
  tool: "border-border text-fg",
  result: "border-ok/50 text-ok",
};

type Stage =
  | { kind: "choose" }
  | { kind: "examples" }
  | { kind: "resolve"; example: CoachExample }
  | { kind: "questions" };


/** The entry (and bullet) the panel is about, from the current resume. */
function describe(resume: Resume, target: CoachTarget) {
  const item = resume.sections.flatMap((s) => s.items).find((it) => it.id === target.entryId);
  const bullet = item?.bullets.find((b) => b.id === target.bulletId);
  const name = item ? [item.title, item.subtitle].map((x) => x.trim()).filter(Boolean).join(" — ") : "";
  return { item, bullet: bullet?.text.trim() ? bullet : undefined, name: name || "This entry" };
}

/** An example with its blanks shown as labeled chips. */
function ExampleText({ example }: { example: CoachExample }) {
  const labels = new Map(example.blanks.map((b) => [b.key, b.label]));
  return (
    <p className="text-[13px] leading-relaxed">
      {exampleSegments(example.text).map((seg, i) =>
        "blank" in seg ? (
          <mark key={i} className="rounded bg-surface-2 px-1 font-medium text-fg" title="A number only you can fill in">
            {labels.get(seg.blank) ?? seg.blank}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  );
}

/**
 * "Use this bullet": for each blank the student picks one of three options (nothing preselected;
 * a value from their own facts is the one exception), sees the final bullet, then adds it to the entry
 * or replaces the selected bullet. Only that final text ever leaves the page.
 */
function BlankResolver({
  example, canReplace, onBack, onInsert,
}: {
  example: CoachExample;
  canReplace: boolean;
  onBack: () => void;
  onInsert: (text: string, mode: "add" | "replace", hasPlaceholders: boolean) => void;
}) {
  const [choices, setChoices] = useState<Record<string, BlankChoice | undefined>>(() => initialChoices(example.blanks));
  const res = resolveBlanks(example, choices);
  const base = useId();
  const firstRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => firstRef.current?.querySelector<HTMLInputElement>("input")?.focus(), []);
  const set = (key: string, c: BlankChoice) => setChoices((cur) => ({ ...cur, [key]: c }));

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[13px] font-semibold">Fill in the blanks</h3>
        <p className="text-[13px] text-muted">
          Pick what goes in each blank. Only use a number you can stand behind in an interview; a rough honest estimate is fine.
        </p>
      </div>
      {example.blanks.map((b, i) => {
        const c = choices[b.key];
        const name = `${base}-${b.key}`;
        return (
          <fieldset key={b.key} ref={i === 0 ? firstRef : undefined} className="rounded-lg border border-border p-3 space-y-2">
            <legend className="px-1 text-[13px] font-medium">{b.label}</legend>
            {b.question && <p className="text-xs text-muted">{b.question}</p>}
            {b.hint && <p className="text-xs text-muted">Hint: {b.hint}</p>}
            {b.prefill && (
              <label className="flex items-start gap-2 text-[13px]">
                <input type="radio" name={name} checked={c?.kind === "fact"} onChange={() => set(b.key, { kind: "fact" })} className="mt-1" />
                <span>
                  <strong>{b.prefill.value}</strong> <span className="chip text-[11px] text-good border-border">from your facts</span>
                  <span className="block text-xs text-muted">“{b.prefill.fact}”</span>
                </span>
              </label>
            )}
            <label className="flex items-start gap-2 text-[13px]">
              <input type="radio" name={name} checked={c?.kind === "example"} onChange={() => set(b.key, { kind: "example" })} className="mt-1" />
              <span>
                Use the example value <strong>{b.example_value || "(none)"}</strong>
                <span className="block text-xs text-muted">Only if it&apos;s true for you.</span>
              </span>
            </label>
            <div className="flex items-start gap-2 text-[13px]">
              <input
                id={`${name}-own`}
                type="radio"
                name={name}
                checked={c?.kind === "own"}
                onChange={() => set(b.key, { kind: "own", value: c?.kind === "own" ? c.value : "" })}
                className="mt-1"
              />
              <div className="flex-1 min-w-0 space-y-1">
                <label htmlFor={`${name}-own`}>Write my own</label>
                {c?.kind === "own" && (
                  <input
                    className="input w-full py-1"
                    value={c.value}
                    autoFocus
                    aria-label={`Your value for ${b.label}`}
                    placeholder={b.example_value ? `e.g. ${b.example_value}` : ""}
                    onChange={(e) => set(b.key, { kind: "own", value: e.target.value })}
                  />
                )}
              </div>
            </div>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="radio" name={name} checked={c?.kind === "placeholder"} onChange={() => set(b.key, { kind: "placeholder" })} className="mt-1" />
              <span>
                Leave a placeholder <span className="rounded border border-border bg-surface-2 px-1 text-fg">[{b.label}]</span>
                <span className="block text-xs text-muted">Fill it in on the resume later.</span>
              </span>
            </label>
          </fieldset>
        );
      })}

      <div className="rounded-lg border border-border p-3 space-y-1">
        <p className="label">Your bullet</p>
        <p className="text-[13px]" aria-live="polite">{markPlaceholders(res.text)}</p>
      </div>
      {!res.complete && <p className="text-xs text-muted">Choose an option for each blank to add it.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[13px] font-medium text-fg hover:bg-surface-2 disabled:opacity-50" disabled={!res.complete} onClick={() => onInsert(res.text, "add", res.hasPlaceholders)}>
          Add to entry
        </button>
        {canReplace && (
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50" disabled={!res.complete} onClick={() => onInsert(res.text, "replace", res.hasPlaceholders)}>
            Replace this bullet
          </button>
        )}
        <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50" onClick={onBack}>
          Back to examples
        </button>
      </div>
    </div>
  );
}

/**
 * The right panel's focus view for one entry or bullet: "Show me examples" or "Ask me questions first".
 * On a job tab (`jobId`) both are angled to the posting; on the master they aim at general strength.
 * Examples and their values are kept only in this component's state.
 */
export function CoachPanel({
  resume, resumeId, jobId, target, facts, onInsert, startWith, disabledReason,
}: {
  resume: Resume;
  /** The resume being coached (the master, or this job's tailored copy): new facts link to it. */
  resumeId: string | null;
  /** Set on a job tab: coaching is angled to that posting. */
  jobId?: string | null;
  target: CoachTarget;
  facts: FactsApi;
  /** Put the bullet on the resume; returns its id (null if the entry is gone). */
  onInsert: (target: CoachTarget, text: string, mode: "add" | "replace") => string | null;
  /** "Go deeper" from the builder opens the questions straight away (already zoomed). */
  startWith?: "questions";
  disabledReason?: string;
}) {
  const { item, bullet, name } = describe(resume, target);
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [zoom, setZoom] = useState<ChoiceMode | null>(startWith === "questions" ? "questions" : null);
  const [examples, setExamples] = useState<CoachExample[]>([]);
  const [round, setRound] = useState(0);
  const [questions, setQuestions] = useState<CoachQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answered, setAnswered] = useState(false);
  const [busy, setBusy] = useState<"" | "examples" | "questions" | "saving">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [undo, setUndo] = useState<{ message: string; ids: string[] } | null>(null);
  const started = useRef(false);

  const effectiveTarget = useMemo(() => ({ ...target, bulletId: bullet ? target.bulletId : null }), [target, bullet]);

  // Picking a choice zooms it in at once; if the request fails the zoom goes back to the stage's own choice
  // (or to the two side by side, before anything loaded), so the error sits where the user can retry.
  async function loadExamples(next: number, replace: boolean) {
    const body = coachRequest(resume, effectiveTarget, { jobId, resumeId, round: next });
    if (!body) return setError("This entry no longer exists.");
    const back = choiceOfStage(stage.kind);
    setZoom("examples");
    setBusy("examples");
    setError("");
    const { data, error: e } = await postApi<{ examples: CoachExample[] }>("/api/coach/examples", body);
    setBusy("");
    if (e || !data) {
      setZoom(back);
      return setError(e ?? "The examples didn't come back. Try again.");
    }
    setRound(next);
    setExamples((cur) => (replace ? data.examples : [...cur, ...data.examples]));
    setStage({ kind: "examples" });
  }

  async function loadQuestions() {
    const body = coachRequest(resume, effectiveTarget, { jobId, resumeId });
    if (!body) return setError("This entry no longer exists.");
    const back = choiceOfStage(stage.kind);
    setZoom("questions");
    setBusy("questions");
    setError("");
    const { data, error: e } = await postApi<{ questions: CoachQuestion[] }>("/api/coach/questions", body);
    setBusy("");
    if (e || !data) {
      setZoom(back);
      return setError(e ?? "The questions didn't come back. Try again.");
    }
    setQuestions(data.questions);
    setAnswers({});
    setAnswered(false);
    setStage({ kind: "questions" });
  }

  useEffect(() => {
    if (startWith === "questions" && !started.current && !disabledReason) {
      started.current = true;
      void loadQuestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWith]);

  /** Save the answers as facts (each answer, then the AI's atomic facts from them), with Undo. */
  async function saveAnswers() {
    const list = questions.filter((q) => answers[q.id]?.trim());
    if (!list.length) return setAnswered(true);
    setBusy("saving");
    setError("");
    const link = resumeId ? { resume_id: resumeId, entry_id: target.entryId } : {};
    const own = await facts.add(list.map((q) => ({ text: answerFact(q.question, answers[q.id]), source: "coaching" as const, ...link })));
    if (!own) {
      setBusy("");
      return setError(facts.error || "Couldn't save your answers. Try again.");
    }
    const context = [name, ...(item?.bullets ?? []).map((b) => b.text).filter((t) => t.trim())].join("\n");
    const { data } = await postApi<{ facts: Fact[] }>("/api/extract-facts", {
      answer: list.map((q) => answers[q.id].trim()).join("\n"),
      question: list.map((q) => q.question).join("\n"),
      context,
      resumeId,
      entryId: target.entryId,
    });
    if (data?.facts) facts.absorb(data.facts);
    const ids = [...own, ...(data?.facts ?? [])].map((f) => f.id);
    setBusy("");
    setAnswered(true);
    if (ids.length) setUndo({ message: `Saved ${plural(ids.length, "fact")}`, ids });
  }

  function insert(text: string, mode: "add" | "replace") {
    const bulletId = onInsert(effectiveTarget, text, mode);
    if (!bulletId) return setError("This entry no longer exists.");
    if (resumeId) {
      const plan = coachedFactPlan(facts.facts, { resumeId, bulletId, entryId: target.entryId }, text);
      if (plan.kind === "update") void facts.patch(plan.id, plan.patch);
      else void facts.add([plan.fact]);
    }
    setDone(mode === "replace" ? "Replaced the bullet. Undo with Ctrl/⌘+Z." : "Added the bullet to this entry. Undo with Ctrl/⌘+Z.");
    setStage({ kind: "examples" });
  }

  if (!item) return <p className="text-[13px] text-muted">That entry is gone.</p>;

  const busyText = CHOICES.find((m) => m.mode === busy)?.busyText;

  return (
    <section className="space-y-4" aria-label="Help with this bullet">
      {disabledReason ? (
        <p className="text-[13px] text-muted">{disabledReason}</p>
      ) : (
        <>
          {/* The two choices side by side. Picking one zooms it into a heading across the full row (the
              other fades out and collapses, its width and gap go to 0). The collapsed one stays mounted but
              invisible, so the "instead" links can zoom it back in. */}
          <div role="group" aria-label="What would help" className={rowGapClass(zoom)}>
            {CHOICES.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                disabled={zoom !== null || !!busy}
                onClick={() => (mode === "examples" ? loadExamples(1, true) : loadQuestions())}
                aria-pressed={zoom === mode || undefined}
                className={choiceClass(mode, zoom)}
              >
                {label}
              </button>
            ))}
          </div>

          {zoom && busy && busyText && <p className="ai-shimmer text-[14px]">{busyText}</p>}

          {done && (
            <p role="status" className="text-[13px] text-good">
              {done}
            </p>
          )}
          {error && (
            <div role="alert" className="text-[13px] text-bad">
              {error}
            </div>
          )}

          {stage.kind !== "choose" && (
          // Results fade in under the heading; keyed by stage so each new stage plays once.
          <div key={stage.kind} className="ai-fade">
          {stage.kind === "examples" && (
            <div className="space-y-3">
              {examples.map((ex) => (
                <article key={ex.id} className="rounded-lg border border-border p-3 space-y-2">
                  <ExampleText example={ex} />
                  {ex.anatomy.length > 0 && (
                    <ul className="flex flex-wrap gap-1" aria-label="What makes it work">
                      {ex.anatomy.map((a, i) => (
                        <li key={i} className={`chip text-[11px] ${PART_CLS[a.part]}`}>
                          <span className="font-semibold mr-1">{PART_LABEL[a.part]}:</span>
                          {exampleSegments(a.span).map((s) => ("blank" in s ? "…" : s.text)).join("")}
                        </li>
                      ))}
                    </ul>
                  )}
                  {ex.why && <p className="text-xs text-muted">Why it works: {ex.why}</p>}
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50" onClick={() => setStage({ kind: "resolve", example: ex })}>
                    Use this bullet
                  </button>
                </article>
              ))}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50" disabled={!!busy} onClick={() => loadExamples(round + 1, false)}>
                  {busy === "examples" ? "Writing…" : "More examples"}
                </button>
                <button type="button" className="rounded-md px-2 py-1 text-[13px] text-muted underline underline-offset-2 hover:text-fg disabled:opacity-50" disabled={!!busy} onClick={loadQuestions}>
                  Question me instead
                </button>
              </div>
            </div>
          )}

          {stage.kind === "resolve" && (
            <BlankResolver
              key={stage.example.id}
              example={stage.example}
              canReplace={!!bullet}
              onBack={() => setStage({ kind: "examples" })}
              onInsert={(text, mode) => insert(text, mode)}
            />
          )}

          {stage.kind === "questions" && (
            <div className="space-y-3">
              <p className="text-[13px] text-muted">Rough answers are fine. Skip any you can&apos;t answer.</p>
              {questions.map((q) => (
                <div key={q.id} className="space-y-1">
                  <label htmlFor={`coach-${q.id}`} className="text-[13px] font-medium block">{q.question}</label>
                  {q.why && <p className="text-xs text-muted">Why it matters: {q.why}</p>}
                  {q.tip && <p className="text-xs text-muted">Tip: {q.tip}</p>}
                  <textarea
                    id={`coach-${q.id}`}
                    className="input w-full h-16 text-[13px]"
                    value={answers[q.id] ?? ""}
                    disabled={answered}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    placeholder="e.g. about 20 a week"
                  />
                </div>
              ))}
              {!answered ? (
                <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[13px] font-medium text-fg hover:bg-surface-2 disabled:opacity-50" disabled={busy === "saving"} onClick={saveAnswers}>
                  {busy === "saving" ? "Saving…" : Object.values(answers).some((a) => a.trim()) ? "Save answers" : "Skip"}
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-[13px]">Saved to your facts. Now write the bullet with your real numbers.</p>
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[13px] font-medium text-fg hover:bg-surface-2 disabled:opacity-50" disabled={!!busy} onClick={() => loadExamples(1, true)}>
                    {busy === "examples" ? "Writing…" : "Write my bullet"}
                  </button>
                </div>
              )}
              <button type="button" className="rounded-md px-2 py-1 text-[13px] text-muted underline underline-offset-2 hover:text-fg disabled:opacity-50" disabled={!!busy} onClick={() => loadExamples(1, true)}>
                Show examples instead
              </button>
            </div>
          )}
          </div>
          )}
        </>
      )}

      {undo && (
        <UndoToast
          message={undo.message}
          onUndo={() => {
            void facts.remove(undo.ids);
            setUndo(null);
          }}
          onClose={() => setUndo(null)}
        />
      )}
    </section>
  );
}
