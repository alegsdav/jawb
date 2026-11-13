import type { Analysis, Fit, Resume } from "./types";
import { fitFromScore } from "./fit";
import { bulletTextMap } from "./resume";
import { addFacts, hasPlaceholder, PLACEHOLDER_RE } from "./facts";

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

const normText = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/** The fact format used before answers became self-contained facts ("300 (re: How many users?)"). Still recognized, never written. */
export const legacyAnswerFact = (question: string, answer: string) => `${answer.trim()} (re: ${question.trim()})`;

const PRONOUNS: [RegExp, string][] = [
  [/\b(?:did|do|does)\s+you\b/gi, "I"],
  [/\b(?:have|has)\s+you\b/gi, "I have"],
  [/\bhad\s+you\b/gi, "I had"],
  [/\b(?:were|was)\s+you\b/gi, "I was"],
  [/\bare\s+you\b/gi, "I am"],
  [/\b(?:can|could|would|will)\s+you\b/gi, "I can"],
  [/\byourself\b/gi, "myself"],
  [/\byours\b/gi, "mine"],
  [/\byour\b/gi, "my"],
  [/\byou\b/gi, "I"],
];

/**
 * A question condensed to the topic it asks about, so "Q: … A: …" reads as "<topic>: <answer>":
 * "By roughly what percent did the automation cut prep time?" -> "Automation cut prep time";
 * "Have you used SQL in any class?" -> "Used SQL in any class"; "How many researchers used it?" ->
 * "Researchers used it". Deterministic (no AI call). Falls back to the question itself.
 */
export function questionTopic(question: string): string {
  const q = question.trim().replace(/[?？]+$/, "").trim();
  let s = q
    .replace(
      /^(?:and\s+|so\s+|also\s+)?(?:by\s+)?(?:roughly\s+|approximately\s+|about\s+|around\s+)?(?:how\s+(?:many|much|long|often|big|large|fast)|what\s+(?:percent(?:age)?|share|fraction|number)(?:\s+of)?|what|which|who|when|where|why|how)\s+/i,
      "",
    )
    .replace(/^(?:did|do|does|have|has|had|were|was|are|is|can|could|would|will)\s+(?:you\s+)?/i, "")
    .replace(/^there\s+(?:any\s+)?/i, "")
    .replace(/^(?:the|a|an)\s+/i, "");
  for (const [re, to] of PRONOUNS) s = s.replace(re, to);
  s = s.replace(/\s+/g, " ").trim();
  if (!s) s = q;
  if (s.length > 90) s = `${s.slice(0, 89).replace(/\s+\S*$/, "")}…`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The fact for an answer to a general question: "<topic>: <answer>" (see questionTopic). */
export const answerFact = (question: string, answer: string) => `${questionTopic(question)}: ${answer.trim()}`;

type Question = Analysis["questions"][number];
type AnalysisBullets = Analysis["bullets"];

/**
 * The self-contained fact recorded on the master for each answered question (question id -> fact).
 * - A question about a [placeholder] in a bullet's suggestion: the bullet sentence with the answer
 *   filled in ("Automated survey cleaning in Python, cutting prep time by about 30%"). Questions about
 *   the same bullet share one sentence once all its placeholders are answered; until then (or when the
 *   bullet can't be found) each uses the general form.
 * - Any other question: "<topic>: <answer>" (answerFact).
 */
export function answerFacts(
  questions: Analysis["questions"],
  answers: Record<string, string> | undefined,
  bullets?: AnalysisBullets,
): Map<string, string> {
  const out = new Map<string, string>();
  const groups = new Map<string, { template: string; qs: Question[] }>();
  for (const q of questions) {
    const a = answers?.[q.id]?.trim();
    if (!a) continue;
    out.set(q.id, answerFact(q.question, a));
    if (!q.bullet_id || !q.placeholder || !bullets) continue;
    const b = bullets.find((x) => x.bullet_id === q.bullet_id);
    const template = [b?.rewrite, b?.original].find((t) => t && findPlaceholder(t, q.placeholder!));
    if (!template) continue;
    const g = groups.get(q.bullet_id) ?? { template, qs: [] };
    if (g.template !== template) continue;
    g.qs.push(q);
    groups.set(q.bullet_id, g);
  }
  for (const g of groups.values()) {
    let text: string | null = g.template;
    for (const q of g.qs) text = text && fillPlaceholder(text, q.placeholder!, suggestFill(q.placeholder!, answers![q.id]));
    if (!text || hasPlaceholder(text)) continue;
    for (const q of g.qs) out.set(q.id, text.trim());
  }
  return out;
}

/** Drop facts (case/whitespace-insensitive) from a list. */
export function removeFacts(facts: string[] | undefined, remove: string[]): string[] {
  const gone = new Set(remove.map(normText));
  return (facts ?? []).filter((f) => !gone.has(normText(f)));
}

/**
 * Facts to add to and remove from the master so it matches `next`, judged against the master's CURRENT
 * facts (not against the previously saved answers), so running it again repairs any earlier failure:
 * - every non-empty answer's fact (answerFacts) is added unless the master already has it, or still has
 *   the old-format fact for that same answer (old facts are kept as they are, not migrated);
 * - when an answer was edited or cleared, or a bullet's sentence now includes more answers, the fact for
 *   its previous state (`prev`, in either format) is removed if present.
 * Pass the analysis' `bullets` so placeholder answers become filled bullet sentences.
 */
export function answerFactPlan(
  questions: Analysis["questions"],
  prev: Record<string, string> | undefined,
  next: Record<string, string>,
  masterFacts: string[] | undefined,
  bullets?: AnalysisBullets,
): { add: string[]; remove: string[] } {
  const have = new Set((masterFacts ?? []).map(normText));
  const want = answerFacts(questions, next, bullets);
  const before = answerFacts(questions, prev, bullets);
  const wanted = new Set([...want.values()].map(normText));
  const add: string[] = [];
  const remove: string[] = [];
  const addOnce = (list: string[], f: string) => {
    if (!list.some((x) => normText(x) === normText(f))) list.push(f);
  };
  for (const q of questions) {
    const was = prev?.[q.id]?.trim() ?? "";
    const now = next[q.id]?.trim() ?? "";
    const f = want.get(q.id);
    if (f && !have.has(normText(f)) && !have.has(normText(legacyAnswerFact(q.question, now)))) addOnce(add, f);
    if (!was) continue;
    for (const old of [before.get(q.id), was !== now ? legacyAnswerFact(q.question, was) : ""]) {
      if (old && !wanted.has(normText(old)) && have.has(normText(old))) addOnce(remove, old);
    }
  }
  return { add, remove };
}

/**
 * Question ids whose (stored or drafted) answer has no matching fact on the master yet (either format).
 * Pass the analysis' `bullets` to check placeholder answers exactly; without them, a placeholder answer
 * counts as saved when some fact contains the filled-in value.
 */
export function missingAnswerFacts(
  questions: Analysis["questions"],
  answers: Record<string, string> | undefined,
  masterFacts: string[] | undefined,
  bullets?: AnalysisBullets,
): string[] {
  const have = new Set((masterFacts ?? []).map(normText));
  const facts = answerFacts(questions, answers, bullets);
  return questions
    .filter((q) => {
      const a = answers?.[q.id]?.trim();
      if (!a) return false;
      if (have.has(normText(facts.get(q.id) ?? "")) || have.has(normText(legacyAnswerFact(q.question, a)))) return false;
      if (!bullets && q.placeholder) {
        const value = normText(suggestFill(q.placeholder, a));
        if ([...have].some((f) => f.includes(value))) return false;
      }
      return true;
    })
    .map((q) => q.id);
}

/** The master with its answer facts brought in line with `next` (the same object when nothing changes). */
export function applyAnswerFacts(
  master: Resume,
  questions: Analysis["questions"],
  prev: Record<string, string> | undefined,
  next: Record<string, string>,
  bullets?: AnalysisBullets,
): Resume {
  const { add, remove } = answerFactPlan(questions, prev, next, master.facts, bullets);
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
      added = answerFactPlan(analysis.questions, analysis.answers, clean, m.facts, analysis.bullets).add.length;
      return applyAnswerFacts(m, analysis.questions, analysis.answers, clean, analysis.bullets);
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
//
// A number in AI text is kept only when the candidate stated the same quantity, with the same unit,
// in the sources allowed for that text. Everything else becomes a [placeholder] the user fills in.
// - Sources are bullet bodies, facts and answers. Names, contact lines, dates, GPAs, course codes,
//   phone numbers, links and versions ("Python 3") are not quantities and never count as sources.
// - Units must match: "40%" needs a 40% source, "$5K" a $5,000 source, "3x" a 3x source, "10K" a
//   10,000 source. A plain count never comes from a percentage, a price or a multiplier.
// - Number words ("five", "a dozen", "twice", "doubled", "half") are checked the same way.

/** Kinds of quantity. "count" is a plain number ("300 users", "1,200+"). */
type Unit = "pct" | "money" | "mult" | "count";

/** What some source texts state: quantities ("pct:40", "count:300"), number-word families and GPAs. */
export type KnownNumbers = { keys: Set<string>; words: Set<string>; gpas: Set<string> };

const MAGNITUDE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const keyOf = (unit: Unit, value: number) => `${unit}:${round6(value)}`;

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const YEAR = "(?:19|20)\\d\\d";
/** Spans that contain digits but aren't quantities. Never a source; left as written in AI text. */
const NOT_QUANTITY: RegExp[] = [
  // Dates and date ranges: "Jan 2026", "May 5, 2025", "Fall 2024", "2023 – Present", "since 2021", "05/2024", "2025-11-13".
  new RegExp(`\\b${MONTH}\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?(?:${YEAR}\\b|'\\d\\d\\b)`, "gi"),
  new RegExp(`\\b(?:spring|summer|fall|autumn|winter)\\s+(?:${YEAR}\\b|'\\d\\d\\b)`, "gi"),
  new RegExp(`\\b${YEAR}\\s*(?:-|–|—|to)\\s*(?:${YEAR}|\\d\\d|present|current|now|today)\\b`, "gi"),
  new RegExp(`\\b(?:in|since|during|until|circa|class of)\\s+${YEAR}\\b`, "gi"),
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(?:0?[1-9]|1[0-2])\/(?:19|20)\d\d\b|\b\d{4}-\d\d-\d\d\b/g,
  // Phone numbers: "(555) 010-2000", "555-010-2000", "+1 555 010 2000".
  /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}\b/g,
  // Course codes: "DS 3000", "CS2500", "MATH 1341".
  /\b[A-Z]{2,5}[ -]?\d{3,4}[A-Z]?\b/g,
  // Links and emails.
  /\bhttps?:\/\/\S+|\b[\w.+-]+@[\w-]+\.[\w.]+|\b[\w-]+\.(?:com|edu|org|io|net|dev|ai|app|co)(?:\/\S*)?/gi,
  // Versions: "Python 3.11", "iOS 17", "Web 2.0", "v2".
  /\b(?:python|java|ruby|php|perl|swift|kotlin|scala|es|html|css|ios|ipados|android|windows|macos|ubuntu|node(?:\.js)?|react|vue|angular|next\.js|rails|django|postgres(?:ql)?|mysql|excel|office|unity|web|version)\s?v?\d+(?:\.\d+)*\b|\bv\d+(?:\.\d+)*\b/gi,
];
/** GPAs: "GPA: 3.7/4.0", "3.85 GPA", "3.9/4.0". In AI text, kept only when the sources give the same GPA. */
const GPA_RE =
  /\bGPA\b\s*(?:of\s*)?[:-]?\s*(\d\.\d{1,3})(?:\s*\/\s*[45](?:\.0{1,2})?)?|\b(\d\.\d{1,3})\s*\/\s*[45](?:\.0{1,2})?\b(?:\s*GPA\b)?|\b(\d\.\d{1,3})\s+(?:cumulative\s+|overall\s+|major\s+)?GPA\b/gi;

/** A number with its unit: "$5,000", "40%", "40 percent", "10K", "2.5 million", "3x", "3 times", "1,200+". */
const QUANTITY_RE =
  /(\$\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?%|\s?percent\b|\s?(?:k|mm|m|bn|b)(?![a-z0-9])|\s(?:thousand|million|billion)\b|\s?[x×](?![a-z0-9])|\s(?:times)\b|\s(?:dollars|usd)\b|\+)?/gi;

const COUNT_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  million: 1e6, dozen: 12,
};
type WordKind = "count" | "mult" | "multVerb" | "half" | "halfVerb";
/** Number words with what they claim. Vague plurals ("hundreds of") are only OK when the sources use them too. */
const WORD_FAMILY: Record<string, { family: string; key?: string; kind: WordKind }> = {
  ...Object.fromEntries(
    Object.entries(COUNT_WORDS).map(([w, n]) => [w, { family: w, key: keyOf("count", n), kind: "count" as WordKind }]),
  ),
  dozens: { family: "dozens", kind: "count" },
  hundreds: { family: "hundreds", kind: "count" },
  thousands: { family: "thousands", kind: "count" },
  millions: { family: "millions", kind: "count" },
  twice: { family: "x2", key: keyOf("mult", 2), kind: "mult" },
  double: { family: "x2", key: keyOf("mult", 2), kind: "mult" },
  doubled: { family: "x2", key: keyOf("mult", 2), kind: "multVerb" },
  doubling: { family: "x2", key: keyOf("mult", 2), kind: "multVerb" },
  thrice: { family: "x3", key: keyOf("mult", 3), kind: "mult" },
  triple: { family: "x3", key: keyOf("mult", 3), kind: "mult" },
  tripled: { family: "x3", key: keyOf("mult", 3), kind: "multVerb" },
  tripling: { family: "x3", key: keyOf("mult", 3), kind: "multVerb" },
  quadruple: { family: "x4", key: keyOf("mult", 4), kind: "mult" },
  quadrupled: { family: "x4", key: keyOf("mult", 4), kind: "multVerb" },
  half: { family: "half", key: keyOf("pct", 50), kind: "half" },
  halved: { family: "half", key: keyOf("pct", 50), kind: "halfVerb" },
  halving: { family: "half", key: keyOf("pct", 50), kind: "halfVerb" },
};
const WORD_ALT = Object.keys(WORD_FAMILY)
  .sort((a, b) => b.length - a.length)
  .join("|");
const ONE_WORD_RE = new RegExp(`\\b(?:${WORD_ALT})\\b`, "gi");
/** A run of number words ("a dozen", "five hundred", "dozens of", "twenty-five"). */
const NUMBER_WORDS_RE = new RegExp(
  `\\b(?:an?\\s+)?(?:${WORD_ALT})(?:(?:\\s+(?:and\\s+)?|-)(?:${WORD_ALT}))*\\b(?:\\s+of\\b)?`,
  "gi",
);
/** Number words inside fixed terms that aren't claims ("two-factor", "double-check", "first half of"). */
const WORD_TERM_AFTER =
  /^[\s-]?(?:factor|way|pointer|sided|tier|dimensional|step|phase|check|checked|checking|major|click|clicked|degree|count|space|spaced|digit)\b/i;
const WORD_TERM_BEFORE = /\b(?:first|second|other|back|front|top|bottom|latter|former|no)[\s-]+$/i;

type Range = [number, number];
const overlaps = (r: Range, list: Range[]) => list.some(([a, b]) => r[0] < b && a < r[1]);

function protectedRanges(s: string): Range[] {
  const out: Range[] = [];
  for (const re of NOT_QUANTITY) for (const m of s.matchAll(re)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

/** True when the number at [start, end) is glued to letters/digits (EC2, B2B, 1st, 24/7, 3:30, v1.2, #1). */
function glued(s: string, start: number, end: number): boolean {
  const before = s[start - 1] ?? "";
  const after = s[end] ?? "";
  if (/[A-Za-z0-9_.:#]/.test(before) || /[A-Za-z0-9_:]/.test(after)) return true;
  if (before === "/" && /\d/.test(s[start - 2] ?? "")) return true;
  if (after === "/" && /\d/.test(s[end + 1] ?? "")) return true;
  if (after === "." && /[A-Za-z0-9]/.test(s[end + 1] ?? "")) return true;
  return false;
}

type Quantity = { start: number; end: number; unit: Unit; value: number; suffix: string };

function unitOf(currency: boolean, suffix: string): { unit: Unit; scale: number } {
  const s = suffix.trim().toLowerCase();
  if (s === "%" || s === "percent") return { unit: "pct", scale: 1 };
  if (s === "x" || s === "×" || s === "times") return { unit: "mult", scale: 1 };
  const scale = MAGNITUDE[s] ?? 1;
  if (currency || s === "dollars" || s === "usd") return { unit: "money", scale };
  return { unit: "count", scale };
}

function quantities(s: string, skip: Range[]): Quantity[] {
  const out: Quantity[] = [];
  for (const m of s.matchAll(QUANTITY_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (overlaps([start, end], skip) || glued(s, start, end)) continue;
    const { unit, scale } = unitOf(!!m[1], m[3] ?? "");
    out.push({ start, end, unit, value: Number(m[2].replace(/,/g, "")) * scale, suffix: m[3] ?? "" });
  }
  return out;
}

type WordHit = { start: number; end: number; words: string[]; text: string };

function numberWords(s: string, skip: Range[]): WordHit[] {
  const out: WordHit[] = [];
  for (const m of s.matchAll(NUMBER_WORDS_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (overlaps([start, end], skip)) continue;
    if (/[A-Za-z0-9_]/.test(s[start - 1] ?? "") || (s[end] === "." && /[A-Za-z]/.test(s[end + 1] ?? ""))) continue;
    if (WORD_TERM_AFTER.test(s.slice(end)) || WORD_TERM_BEFORE.test(s.slice(0, start))) continue;
    const words = (m[0].match(ONE_WORD_RE) ?? []).map((w) => w.toLowerCase());
    if (!words.length) continue;
    // "a dozen", "a hundred" include the article; "a five-person team" keeps it.
    const article = /^an?\s+/i.exec(m[0]);
    if (article && !/^(?:dozen|hundred|thousand|million|half)$/.test(words[0])) {
      out.push({ start: start + article[0].length, end, words, text: m[0].slice(article[0].length) });
    } else out.push({ start, end, words, text: m[0] });
  }
  return out;
}

const emptyKnown = (): KnownNumbers => ({ keys: new Set(), words: new Set(), gpas: new Set() });

/** Merge several KnownNumbers into one. */
export function mergeKnown(...all: KnownNumbers[]): KnownNumbers {
  const out = emptyKnown();
  for (const k of all) {
    k.keys.forEach((x) => out.keys.add(x));
    k.words.forEach((x) => out.words.add(x));
    k.gpas.forEach((x) => out.gpas.add(x));
  }
  return out;
}

function wordsValue(words: string[]): number {
  let total = 0;
  let cur = 0;
  for (const w of words) {
    const n = COUNT_WORDS[w];
    if (n >= 1000) {
      total += (cur || 1) * n;
      cur = 0;
    } else if (n === 100) cur = (cur || 1) * 100;
    else cur += n;
  }
  return total + cur;
}

/**
 * What a list of source texts (bullet bodies, facts, answers) states. Dates, phone numbers, course
 * codes, links and versions are skipped, and an old answer fact's "(re: question)" tail is ignored.
 */
export function knownNumbers(sources: string[]): KnownNumbers {
  const out = emptyKnown();
  for (const raw of sources) {
    const s = (raw ?? "").replace(/\s*\(re: [^)]*\)\s*$/i, "");
    const skip = protectedRanges(s);
    for (const m of s.matchAll(GPA_RE)) {
      out.gpas.add(String(Number(m[1] ?? m[2] ?? m[3])));
      skip.push([m.index!, m.index! + m[0].length]);
    }
    for (const q of quantities(s, skip)) {
      out.keys.add(keyOf(q.unit, q.value));
      skip.push([q.start, q.end]);
    }
    for (const w of numberWords(s, skip)) {
      for (const word of w.words) {
        const f = WORD_FAMILY[word];
        out.words.add(f.family);
        if (f.key) out.keys.add(f.key);
      }
      if (w.words.length > 1) {
        out.words.add(w.words.join(" "));
        // "five hundred" / "twenty-five" also count as their value.
        if (w.words.every((x) => x in COUNT_WORDS)) out.keys.add(keyOf("count", wordsValue(w.words)));
      }
    }
  }
  return out;
}

/** The next free placeholder name in a text: [N], [N2], [X%], [X2%], [$X], [$X2], [NK]... */
function uniqueName(used: Set<string>, pre: string, post: string): string {
  for (let i = 1; ; i++) {
    const name = `[${pre}${i > 1 ? i : ""}${post}]`;
    if (!used.has(name.toLowerCase())) {
      used.add(name.toLowerCase());
      return name;
    }
  }
}

/** Placeholder for an unsupported number: name parts, and text that stays outside the brackets. */
function quantityPlaceholder(q: Quantity): { pre: string; post: string; outside: string } {
  const s = q.suffix.trim().toLowerCase();
  if (q.unit === "pct") return { pre: "X", post: "%", outside: "" };
  if (q.unit === "money") return { pre: "$X", post: "", outside: s === "dollars" || s === "usd" ? q.suffix : "" };
  if (q.unit === "mult") return { pre: "N", post: "", outside: s === "times" ? q.suffix : "x" };
  if (s in MAGNITUDE) return s.length <= 2 ? { pre: "N", post: s.toUpperCase(), outside: "" } : { pre: "N", post: "", outside: q.suffix };
  if (s === "+") return { pre: "N", post: "+", outside: "" };
  return { pre: "N", post: "", outside: "" };
}

const capitalizeLike = (s: string, like: string) => (/^[A-Z]/.test(like) ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** Where a verb's object stops ("Doubled weekly sign-ups | through campus outreach"). */
const OBJECT_RE =
  /^(.*?)(?=\s+(?:by|in|from|for|while|through|and|to|with|via|across|within|after|over|during|using|at|on)\b|[,;.!?)]|$)/i;

type Replacement = { start: number; end: number; text: string; placeholder: string };

/** The replacement for an unsupported run of number words. */
function wordReplacement(s: string, w: WordHit, used: Set<string>): Replacement {
  const kinds = w.words.map((x) => WORD_FAMILY[x].kind);
  if (kinds.length === 1 && (kinds[0] === "multVerb" || kinds[0] === "halfVerb")) {
    // "Doubled sign-ups" -> "Grew sign-ups [N]x"; "Halved prep time" -> "Cut prep time by [X%]".
    const half = kinds[0] === "halfVerb";
    const ph = half ? uniqueName(used, "X", "%") : uniqueName(used, "N", "");
    const ing = /ing$/.test(w.words[0]);
    const verb = half ? (ing ? "cutting" : "cut") : ing ? "growing" : "grew";
    const rest = s.slice(w.end);
    const gap = rest.length - rest.trimStart().length;
    const obj = OBJECT_RE.exec(rest.trimStart())?.[1]?.trim() ?? "";
    const n = obj.split(/\s+/).filter(Boolean).length;
    const useObj = n > 0 && n <= 6 && !hasPlaceholder(obj);
    const amount = half ? `by ${ph}` : `${ph}x`;
    const body = useObj ? `${verb} ${obj} ${amount}` : `${verb} ${amount}`;
    return { start: w.start, end: useObj ? w.end + gap + obj.length : w.end, text: capitalizeLike(body, w.text), placeholder: ph };
  }
  if (kinds.length === 1 && kinds[0] === "half") {
    // "cut prep time in half" -> "cut prep time by [X%]"; "half of the reports" / "half the time" -> "[X%] of ...".
    const ph = uniqueName(used, "X", "%");
    const before = /\b(?:in|by)\s+$/i.exec(s.slice(0, w.start));
    if (before) return { start: w.start - before[0].length, end: w.end, text: `by ${ph}`, placeholder: ph };
    return { start: w.start, end: w.end, text: `${ph} of`, placeholder: ph };
  }
  const ph = uniqueName(used, "N", "");
  // "twice as fast" / "double the output" -> "[N]x ...".
  if (kinds.every((k) => k === "mult")) return { start: w.start, end: w.end, text: `${ph}x`, placeholder: ph };
  // Counts: "five", "a dozen", "dozens of", "five hundred" -> [N]. "of" goes only after a vague plural
  // ("hundreds of users" -> "[N] users"; "five of the teams" -> "[N] of the teams").
  const of = /\s+of$/i.exec(w.text);
  const vague = w.words.some((x) => /s$/.test(x));
  return { start: w.start, end: of && !vague ? w.end - of[0].length : w.end, text: ph, placeholder: ph };
}

function wordSupported(w: WordHit, known: KnownNumbers): boolean {
  if (w.words.length > 1) {
    if (known.words.has(w.words.join(" "))) return true;
    if (w.words.every((x) => x in COUNT_WORDS)) return known.keys.has(keyOf("count", wordsValue(w.words)));
  }
  return w.words.every((x) => {
    const f = WORD_FAMILY[x];
    return known.words.has(f.family) || (!!f.key && known.keys.has(f.key));
  });
}

function guardWith(text: string, known: KnownNumbers, used: Set<string>): { text: string; placeholders: string[] } {
  const skip: Range[] = protectedRanges(text);
  for (const m of text.matchAll(PLACEHOLDER_RE)) skip.push([m.index!, m.index! + m[0].length]);

  const reps: Replacement[] = [];
  for (const m of text.matchAll(GPA_RE)) {
    const range: Range = [m.index!, m.index! + m[0].length];
    if (overlaps(range, skip)) continue;
    skip.push(range);
    const value = m[1] ?? m[2] ?? m[3];
    if (known.gpas.has(String(Number(value)))) continue;
    const at = m.index! + m[0].indexOf(value);
    const ph = uniqueName(used, "GPA", "");
    reps.push({ start: at, end: at + value.length, text: ph, placeholder: ph });
  }
  type Hit = { start: number; q?: Quantity; w?: WordHit };
  const qs = quantities(text, skip);
  const hits: Hit[] = [
    ...qs.map((q) => ({ start: q.start, q })),
    // "2 million" is one quantity, not a number plus the word "million".
    ...numberWords(text, [...skip, ...qs.map((q): Range => [q.start, q.end])]).map((w) => ({ start: w.start, w })),
  ].sort((a, b) => a.start - b.start);
  for (const h of hits) {
    if (h.q) {
      if (known.keys.has(keyOf(h.q.unit, h.q.value))) continue;
      const { pre, post, outside } = quantityPlaceholder(h.q);
      const ph = uniqueName(used, pre, post);
      reps.push({ start: h.q.start, end: h.q.end, text: ph + outside, placeholder: ph });
    } else if (h.w && !wordSupported(h.w, known)) {
      reps.push(wordReplacement(text, h.w, used));
    }
  }

  reps.sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  const placeholders: string[] = [];
  for (const r of reps) {
    if (r.start < at) continue; // overlaps an earlier replacement
    out += text.slice(at, r.start) + r.text;
    at = r.end;
    placeholders.push(r.placeholder);
  }
  return { text: out + text.slice(at), placeholders };
}

const usedPlaceholders = (text: string) => new Set((text.match(PLACEHOLDER_RE) ?? []).map((p) => p.toLowerCase()));

/**
 * Replace every quantity in `text` that the sources don't state (same value, same unit) with a
 * [placeholder]: "40%" -> "[X%]", "$5,000" -> "[$X]", "10K" -> "[NK]", "3x" -> "[N]x", "300" -> "[N]",
 * "a dozen" -> "[N]", "Doubled sign-ups" -> "Grew sign-ups [N]x", "in half" -> "by [X%]". Existing
 * [placeholders], dates, course codes, versions and tokens glued to letters or digits (EC2, B2B, 1st,
 * 24/7) are left alone. Placeholders are unique within the text ([N], [N2]...) so each can be filled
 * on its own. `placeholders` lists the bracketed names added, in order ("[N]" for "[N]x").
 * `sources` are texts (see knownNumbers) or their already-computed KnownNumbers.
 */
export function guardNumbers(text: string, sources: string[] | KnownNumbers): { text: string; placeholders: string[] } {
  const known = Array.isArray(sources) ? knownNumbers(sources) : sources;
  return guardWith(text, known, usedPlaceholders(text));
}

/**
 * Server-side honesty check for a fresh analysis. A number in a bullet's suggested rewrite is kept
 * only when it's in THAT bullet's own text (`original`, else `bulletTexts`), the facts or the answers
 * (`shared`); numbers from other bullets don't count. Anything else becomes a [placeholder], with a
 * question (`bullet_id` + `placeholder`) asking for the real value.
 */
export function guardAnalysisNumbers(a: Analysis, shared: string[], bulletTexts?: Map<string, string>): Analysis {
  const sharedKnown = knownNumbers(shared);
  const questions = [...a.questions];
  const bullets = a.bullets.map((b) => {
    if (!b.rewrite.trim()) return b;
    const own = b.original ?? bulletTexts?.get(b.bullet_id) ?? "";
    const g = guardNumbers(b.rewrite, mergeKnown(sharedKnown, knownNumbers([own])));
    if (!g.placeholders.length) return b;
    const shown = g.text.length > 120 ? `${g.text.slice(0, 119).trimEnd()}…` : g.text;
    g.placeholders.forEach((ph, i) => {
      questions.push({
        id: `num_${b.bullet_id}_${i}`,
        question: `What's the real number for ${ph} in "${shown}"?`,
        why: "The AI suggested a number that isn't in this bullet, your facts or your answers, so it was left as a placeholder.",
        bullet_id: b.bullet_id,
        placeholder: ph,
      });
    });
    return { ...b, rewrite: g.text };
  });
  return { ...a, bullets, questions };
}

/** A sentence with one of these is a claim about the candidate. */
const FIRST_PERSON = /\bI(?:['’](?:m|ve|d|ll))?\b|\b(?:me|my|mine|myself|we|our|ours|us)\b/i;

/**
 * Honesty check for a cover letter. Numbers about the candidate must come from the resume's bullets,
 * the facts or the answers (`candidate`). A number from the job posting is kept only in a sentence
 * that just restates the posting (no "I", "my", "we"...): "Your team of 12 analysts" stays, but
 * "I led 12 projects" becomes "I led [N] projects" even though the posting mentions 12.
 */
export function guardCoverLetter(letter: string, sources: { candidate: string[]; posting: string }): string {
  const candidate = knownNumbers(sources.candidate);
  const withPosting = mergeKnown(candidate, knownNumbers([sources.posting]));
  const used = usedPlaceholders(letter);
  // Sentences (and line breaks) with their separators kept, so the layout survives.
  const parts = letter.split(/((?<=[.!?])[ \t]+|\n+)/);
  return parts
    .map((part, i) => {
      if (i % 2 || !part.trim()) return part;
      const aboutMe = FIRST_PERSON.test(part.replace(PLACEHOLDER_RE, " "));
      return guardWith(part, aboutMe ? candidate : withPosting, used).text;
    })
    .join("");
}
