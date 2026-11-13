import type { Analysis, Fit, Resume } from "./types";
import { fitFromScore } from "./fit";
import { bulletTextMap } from "./resume";
import { addFacts, PLACEHOLDER_RE } from "./facts";

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const FITS: readonly Fit[] = ["strong", "possible", "stretch"];

function fitOfRaw(r: Record<string, unknown>): Fit {
  const f = str(r.fit).trim().toLowerCase();
  if ((FITS as string[]).includes(f)) return f as Fit;
  // Older analyses (and occasionally the model) give a 0-100 number instead of a bucket.
  const raw = r.fit_score;
  const score = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(score) ? fitFromScore(score) : "possible";
}

/** Coerce whatever the model (or an old stored row) returned into a complete Analysis so the UI never crashes on a missing field. */
export function normalizeAnalysis(raw: unknown): Analysis {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const kw = (r.keywords && typeof r.keywords === "object" ? r.keywords : {}) as Record<string, unknown>;
  const rating = (v: unknown): "strong" | "ok" | "weak" => (v === "strong" || v === "weak" ? v : "ok");
  const bulletId = (v: unknown) => str(v).trim().replace(/^\[?b:/, "").replace(/\]$/, "");
  const sev = (v: unknown): "high" | "medium" | "low" => (v === "high" || v === "low" ? v : "medium");
  const out: Analysis = {
    fit: fitOfRaw(r),
    verdict: str(r.verdict),
    keywords: { matched: arr<unknown>(kw.matched).map(str).filter(Boolean), missing: arr<unknown>(kw.missing).map(str).filter(Boolean) },
    strengths: arr<unknown>(r.strengths).map(str).filter(Boolean),
    gaps: arr<Record<string, unknown>>(r.gaps).map((g) => ({ issue: str(g?.issue), severity: sev(g?.severity), fix: str(g?.fix) })),
    bullets: arr<Record<string, unknown>>(r.bullets)
      .map((b) => ({
        bullet_id: bulletId(b?.bullet_id),
        rating: rating(b?.rating),
        note: str(b?.note),
        rewrite: str(b?.rewrite),
        ...(typeof b?.original === "string" ? { original: b.original } : {}),
      }))
      .filter((b) => b.bullet_id),
    questions: arr<Record<string, unknown>>(r.questions)
      .map((q, i) => {
        const bid = bulletId(q?.bullet_id);
        const ph = str(q?.placeholder).trim();
        return {
          id: str(q?.id) || `q${i}`,
          question: str(q?.question),
          why: str(q?.why),
          // Only meaningful together: "fill this placeholder in this bullet".
          ...(bid && ph ? { bullet_id: bid, placeholder: ph.startsWith("[") ? ph : `[${ph}]` } : {}),
        };
      })
      .filter((q) => q.question),
  };
  // Stored analyses carry user state; keep it when re-normalizing a saved row.
  if (r.answers && typeof r.answers === "object" && !Array.isArray(r.answers)) {
    out.answers = Object.fromEntries(Object.entries(r.answers as Record<string, unknown>).map(([k, v]) => [k, str(v)]));
  }
  if (Array.isArray(r.dismissed)) out.dismissed = r.dismissed.map(str).filter(Boolean);
  if (typeof r.analyzed_at === "string") out.analyzed_at = r.analyzed_at;
  return out;
}

/**
 * Combine a fresh model result with the job's previous analysis: questions the user already answered
 * (and their answers) carry over so they keep informing future runs, new questions get unique ids,
 * rejected rewrites are forgotten (the bullets were re-rated), and the run is timestamped.
 */
export function mergeAnalysis(prev: Analysis | null, fresh: Analysis, now: Date): Analysis {
  const answers = Object.fromEntries(Object.entries(prev?.answers ?? {}).filter(([, v]) => v?.trim()));
  const oldAnswered = (prev?.questions ?? []).filter((q) => answers[q.id]);
  const asked = new Set(oldAnswered.map((q) => q.question.trim().toLowerCase()));
  const stamp = now.getTime();
  return {
    ...fresh,
    questions: [
      ...oldAnswered,
      ...fresh.questions
        .filter((q) => !asked.has(q.question.trim().toLowerCase()))
        .map((q, i) => ({ ...q, id: `q${stamp}_${i}` })),
    ],
    answers,
    dismissed: [],
    analyzed_at: now.toISOString(),
  };
}

/** Record the text each bullet had when it was rated, so the UI can tell when feedback no longer applies. */
export function attachOriginals(a: Analysis, resume: Resume): Analysis {
  const texts = bulletTextMap(resume);
  return {
    ...a,
    bullets: a.bullets.map((b) => (texts.has(b.bullet_id) ? { ...b, original: texts.get(b.bullet_id)! } : b)),
  };
}

export type Rating = Analysis["bullets"][number]["rating"];

/**
 * What the UI shows for one bullet's AI feedback, given the bullet's current text:
 * - "current": the bullet still reads as it did when rated: show the rating, note and suggestion.
 * - "updated": the user accepted the suggested rewrite, so the old rating no longer applies.
 * - "stale": the bullet was edited since it was rated: hide the rating and suggestion.
 */
export type BulletFeedback = {
  state: "current" | "updated" | "stale";
  rating: Rating;
  note: string;
  /** Suggested rewrite still waiting for accept/reject ("" if none). */
  suggestion: string;
};

const same = (a: string, b: string) => a.trim() === b.trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True when `text` is `rewrite` as written, or with its [placeholders] filled in. */
export function matchesRewrite(text: string, rewrite: string): boolean {
  const t = text.trim();
  const r = rewrite.trim();
  if (!r) return false;
  if (t === r) return true;
  const parts = r.split(/\[[^\]\n]+\]/g);
  if (parts.length < 2) return false;
  return new RegExp(`^${parts.map(escapeRe).join(".+?")}$`, "s").test(t);
}

/**
 * Per-bullet feedback for the current resume. `loaded` (bullet texts at page load) stands in for
 * `original` on analyses saved before originals were recorded: a suggestion is only offered (and
 * counted for "Accept all") while the bullet still reads like the text it was written for.
 */
export function bulletFeedback(
  analysis: Analysis | null | undefined,
  resume: Resume | null | undefined,
  loaded?: Map<string, string> | null,
): Record<string, BulletFeedback> {
  const out: Record<string, BulletFeedback> = {};
  if (!analysis || !resume) return out;
  const dismissed = new Set(analysis.dismissed ?? []);
  const byId = new Map(analysis.bullets.map((b) => [b.bullet_id, b]));
  for (const [id, text] of bulletTextMap(resume)) {
    const fb = byId.get(id);
    if (!fb) continue;
    const rewrite = fb.rewrite.trim();
    // Accepted (possibly with its placeholders filled in since): the old rating was for the old wording.
    const accepted = matchesRewrite(text, rewrite) && (fb.original === undefined || !matchesRewrite(fb.original, rewrite));
    const state: BulletFeedback["state"] = accepted
      ? "updated"
      : fb.original !== undefined && !same(text, fb.original)
        ? "stale"
        : "current";
    const ref = fb.original ?? loaded?.get(id);
    const suggestion =
      state === "current" && rewrite && !same(text, rewrite) && !dismissed.has(id) && (ref === undefined || same(text, ref))
        ? fb.rewrite
        : "";
    out[id] = { state, rating: fb.rating, note: fb.note, suggestion };
  }
  return out;
}

const normPh = (t: string) => t.replace(/^\[|\]$/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Where `placeholder` (e.g. "[N users]") appears in `text`, matched loosely on case and spacing. */
export function findPlaceholder(text: string, placeholder: string): { start: number; end: number } | null {
  const want = normPh(placeholder);
  if (!want) return null;
  for (const m of text.matchAll(PLACEHOLDER_RE)) {
    if (normPh(m[0]) === want) return { start: m.index!, end: m.index! + m[0].length };
  }
  return null;
}

/** Replace the placeholder in `text` with `value`; null when the placeholder isn't there or the value is blank. */
export function fillPlaceholder(text: string, placeholder: string, value: string): string | null {
  const at = findPlaceholder(text, placeholder);
  const v = value.trim().replace(/\.$/, "");
  if (!at || !v) return null;
  return text.slice(0, at.start) + v + text.slice(at.end);
}

/**
 * The bullet text after filling a placeholder: in the current wording if it has the placeholder,
 * otherwise in the pending suggested rewrite (filling it accepts that rewrite). Null if neither has it.
 */
export function planFill(current: string, suggestion: string, placeholder: string, value: string): string | null {
  if (findPlaceholder(current, placeholder)) return fillPlaceholder(current, placeholder, value);
  return suggestion ? fillPlaceholder(suggestion, placeholder, value) : null;
}

/**
 * A starting value for the fill box from the user's answer: a bare number keeps the placeholder's
 * unit ("[N users]" + "300" -> "300 users"); anything else is used as written.
 */
export function suggestFill(placeholder: string, answer: string): string {
  const a = answer.trim().replace(/\.$/, "");
  const unit = /^[A-Z#$%]{1,2}\+?\s+(.+)$/.exec(placeholder.replace(/^\[|\]$/g, "").trim())?.[1];
  if (unit && /^[~$]?[\d.,]+[%+kKmM]?\+?$/.test(a)) return `${a} ${unit}`;
  return a;
}

/** The fact recorded on the master resume for an answer. */
export const answerFact = (question: string, answer: string) => `${answer.trim()} (re: ${question.trim()})`;

const normText = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/** Drop facts (case/whitespace-insensitive) from a list. */
export function removeFacts(facts: string[] | undefined, remove: string[]): string[] {
  const gone = new Set(remove.map(normText));
  return (facts ?? []).filter((f) => !gone.has(normText(f)));
}

/**
 * Facts to add to and remove from the master so it matches `next`, judged against the master's CURRENT
 * facts (not against the previously saved answers), so running it again repairs any earlier failure:
 * - every non-empty answer's fact is added unless the master already has it;
 * - when an answer was edited or cleared, the fact for its previous wording (`prev`) is removed if present.
 */
export function answerFactPlan(
  questions: Analysis["questions"],
  prev: Record<string, string> | undefined,
  next: Record<string, string>,
  masterFacts: string[] | undefined,
): { add: string[]; remove: string[] } {
  const have = new Set((masterFacts ?? []).map(normText));
  const add: string[] = [];
  const remove: string[] = [];
  for (const q of questions) {
    const before = prev?.[q.id]?.trim() ?? "";
    const after = next[q.id]?.trim() ?? "";
    const want = after ? answerFact(q.question, after) : "";
    if (want && !have.has(normText(want))) add.push(want);
    const old = before ? answerFact(q.question, before) : "";
    if (old && normText(old) !== normText(want) && have.has(normText(old))) remove.push(old);
  }
  return { add, remove };
}

/** Question ids whose (stored or drafted) answer has no matching fact on the master yet. */
export function missingAnswerFacts(
  questions: Analysis["questions"],
  answers: Record<string, string> | undefined,
  masterFacts: string[] | undefined,
): string[] {
  const have = new Set((masterFacts ?? []).map(normText));
  return questions
    .filter((q) => answers?.[q.id]?.trim() && !have.has(normText(answerFact(q.question, answers[q.id]))))
    .map((q) => q.id);
}

/** The master with its answer facts brought in line with `next` (the same object when nothing changes). */
export function applyAnswerFacts(
  master: Resume,
  questions: Analysis["questions"],
  prev: Record<string, string> | undefined,
  next: Record<string, string>,
): Resume {
  const { add, remove } = answerFactPlan(questions, prev, next, master.facts);
  if (!add.length && !remove.length) return master;
  return addFacts({ ...master, facts: removeFacts(master.facts, remove) }, add);
}

type MasterWrite = (mutate: (m: Resume) => Resume) => Promise<{ ok: true; content: Resume } | { ok: false; error: string }>;

/**
 * Save analysis answers in the order that can't lose them: first the master's facts (conflict-safe
 * `writeMaster`, i.e. updateMaster), and only once that worked, the answers on the job (`persist`).
 * If the master write fails nothing is persisted, so the answers stay "unsaved" and a retry redoes it.
 */
export async function saveAnswersInOrder(opts: {
  analysis: Analysis;
  answers: Record<string, string>;
  writeMaster: MasterWrite;
  persist: (next: Analysis) => Promise<void> | void;
}): Promise<
  { ok: true; master: Resume; added: number; analysis: Analysis } | { ok: false; stage: "master" | "answers"; error: string }
> {
  const { analysis } = opts;
  const clean = Object.fromEntries(Object.entries(opts.answers).filter(([, v]) => v.trim()));
  let added = 0;
  let res: Awaited<ReturnType<MasterWrite>>;
  try {
    res = await opts.writeMaster((m) => {
      added = answerFactPlan(analysis.questions, analysis.answers, clean, m.facts).add.length;
      return applyAnswerFacts(m, analysis.questions, analysis.answers, clean);
    });
  } catch (e) {
    res = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) return { ok: false, stage: "master", error: res.error };
  const next: Analysis = { ...analysis, answers: clean };
  try {
    await opts.persist(next);
  } catch (e) {
    return { ok: false, stage: "answers", error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: true, master: res.content, added, analysis: next };
}

/**
 * Fold what only the page knows into a freshly returned analysis (the server merged with the row as
 * it was stored, which may lag behind the page): answers given on the page and answer drafts. Both are
 * matched to the new questions by question text; a draft or answer whose question wasn't asked again
 * keeps its old question, so nothing typed disappears. `changed` means the result differs from
 * `fresh`, so the page must save it itself.
 */
export function carryClientState(
  prev: Analysis | null,
  fresh: Analysis,
  drafts: Record<string, string>,
): { analysis: Analysis; drafts: Record<string, string>; changed: boolean } {
  const questions = [...fresh.questions];
  const answers: Record<string, string> = { ...(fresh.answers ?? {}) };
  const byText = new Map(questions.map((q) => [normText(q.question), q.id]));
  const ids = new Set(questions.map((q) => q.id));
  let changed = false;
  const target = (q: Analysis["questions"][number]): string => {
    const hit = byText.get(normText(q.question));
    if (hit) return hit;
    let id = q.id;
    while (ids.has(id)) id = `${id}_`;
    questions.push({ ...q, id });
    ids.add(id);
    byText.set(normText(q.question), id);
    changed = true;
    return id;
  };
  const outDrafts: Record<string, string> = {};
  for (const q of prev?.questions ?? []) {
    const saved = prev?.answers?.[q.id]?.trim() ? prev.answers[q.id] : "";
    const draft = drafts[q.id]?.trim() ? drafts[q.id] : "";
    if (!saved && !draft) continue;
    const id = target(q);
    if (saved && answers[id] !== saved) {
      answers[id] = saved;
      changed = true;
    }
    if (draft) outDrafts[id] = draft;
  }
  for (const [id, v] of Object.entries(answers)) if (!(id in outDrafts) && v.trim()) outDrafts[id] = v;
  return { analysis: { ...fresh, questions, answers }, drafts: outDrafts, changed };
}

// ---------- honesty guard: numbers the candidate never gave ----------

const SOURCE_NUM_RE = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?([kKmMbB](?![a-zA-Z]))?/g;
const TEXT_NUM_RE = /(\$\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?%|\s?percent\b|[kKmMbB](?![a-zA-Z])|x(?![a-zA-Z])|\+)?/g;
const MULT: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };
const numValue = (digits: string) => Number(digits.replace(/,/g, ""));
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Every number in the source texts, with K/M/B multiplied out too ("10K" counts as 10 and 10000). */
export function sourceNumbers(sources: string[]): Set<number> {
  const out = new Set<number>();
  for (const s of sources) {
    for (const m of (s ?? "").matchAll(SOURCE_NUM_RE)) {
      const v = numValue(m[1]);
      out.add(round(v));
      if (m[2]) out.add(round(v * MULT[m[2].toLowerCase()]));
    }
  }
  return out;
}

function placeholderFor(currency: boolean, suffix: string): string {
  const s = suffix.trim().toLowerCase();
  if (s === "%" || s === "percent") return "[X%]";
  if (currency) return "[$X]";
  if (s in MULT) return `[N${s.toUpperCase()}]`;
  if (s === "x") return "[N]x";
  if (s === "+") return "[N+]";
  return "[N]";
}

/**
 * Replace every number in `text` that doesn't appear in any of `sources` (the resume, facts, answers)
 * with a [placeholder]: "40%" -> "[X%]", "$5,000" -> "[$X]", "10K" -> "[NK]", "300" -> "[N]".
 * Existing [placeholders], and tokens glued to letters or other digits (EC2, B2B, 1st, 24/7, 3:30,
 * v1.2) are left alone.
 */
export function guardNumbers(text: string, sources: string[] | Set<number>): { text: string; placeholders: string[] } {
  const known = sources instanceof Set ? sources : sourceNumbers(sources);
  const placeholders: string[] = [];
  const parts = text.split(/(\[[^\]\n]+\])/g);
  const out = parts.map((part, i) => {
    if (i % 2) return part; // an existing [placeholder]
    return part.replace(TEXT_NUM_RE, (match: string, cur: string | undefined, digits: string, suffix: string | undefined, at: number) => {
      const before = part[at - 1] ?? "";
      const after = part[at + match.length] ?? "";
      if (/[A-Za-z0-9_./:]/.test(before) || /[A-Za-z0-9_/:]/.test(after)) return match;
      const v = numValue(digits);
      const s = (suffix ?? "").trim().toLowerCase();
      const scaled = s in MULT ? v * MULT[s] : v;
      if (known.has(round(v)) || known.has(round(scaled))) return match;
      const ph = placeholderFor(!!cur, suffix ?? "");
      placeholders.push(ph);
      return ph;
    });
  });
  return { text: out.join(""), placeholders };
}

/**
 * Server-side honesty check for a fresh analysis: any number in a suggested rewrite that isn't in the
 * resume, facts or answers becomes a [placeholder], with a question asking for the real value.
 */
export function guardAnalysisNumbers(a: Analysis, sources: string[]): Analysis {
  const known = sourceNumbers(sources);
  const questions = [...a.questions];
  const bullets = a.bullets.map((b) => {
    if (!b.rewrite.trim()) return b;
    const g = guardNumbers(b.rewrite, known);
    if (!g.placeholders.length) return b;
    const shown = g.text.length > 120 ? `${g.text.slice(0, 119).trimEnd()}…` : g.text;
    [...new Set(g.placeholders)].forEach((ph, i) => {
      questions.push({
        id: `num_${b.bullet_id}_${i}`,
        question: `What's the real number for ${ph} in "${shown}"?`,
        why: "The AI suggested a number that isn't in your resume, facts or answers, so it was left as a placeholder.",
        bullet_id: b.bullet_id,
        placeholder: ph,
      });
    });
    return { ...b, rewrite: g.text };
  });
  return { ...a, bullets, questions };
}

