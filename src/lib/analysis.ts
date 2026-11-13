import type { Analysis, Fit, Resume } from "./types";
import { fitFromScore } from "./fit";
import { bulletTextMap } from "./resume";
import { PLACEHOLDER_RE } from "./facts";

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

/**
 * Facts to add and remove when answers change: a new or edited answer adds its fact, and an edited
 * or cleared answer removes the fact written for its previous wording.
 */
export function answerFactChanges(
  questions: Analysis["questions"],
  prev: Record<string, string> | undefined,
  next: Record<string, string>,
): { add: string[]; remove: string[] } {
  const add: string[] = [];
  const remove: string[] = [];
  for (const q of questions) {
    const before = prev?.[q.id]?.trim() ?? "";
    const after = next[q.id]?.trim() ?? "";
    if (before === after) continue;
    if (before) remove.push(answerFact(q.question, before));
    if (after) add.push(answerFact(q.question, after));
  }
  return { add, remove };
}

/** Drop facts (case/whitespace-insensitive) from a list. */
export function removeFacts(facts: string[] | undefined, remove: string[]): string[] {
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const gone = new Set(remove.map(norm));
  return (facts ?? []).filter((f) => !gone.has(norm(f)));
}
