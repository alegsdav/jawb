import type { Fact, Resume } from "./types";
import { guardNumbers, knownNumbers } from "./analysis";
import { factIsActive, freshFacts, hasPlaceholder, type NewFact } from "./facts";

/**
 * Coaching logic that runs on the server and in tests (no React, no Supabase): checking what the AI
 * returns before any of it is saved or shown.
 */

const MAX_EXTRACTED = 6;

/**
 * The extracted facts worth saving from a model reply (`{ facts: string[] }`): strings only, trimmed,
 * at most 6, no duplicates, no [placeholders], and no fact the number guard would change when the
 * student's answer is its only source (a number, or number word, the answer doesn't state). `dropped`
 * counts facts thrown away by the guard.
 */
export function checkExtractedFacts(raw: unknown, answer: string): { kept: string[]; dropped: number } {
  const r = raw as { facts?: unknown } | unknown[] | null;
  const list = Array.isArray(r) ? r : Array.isArray((r as { facts?: unknown } | null)?.facts) ? ((r as { facts: unknown[] }).facts) : [];
  const known = knownNumbers([answer]);
  const kept: string[] = [];
  let dropped = 0;
  for (const item of list) {
    if (typeof item !== "string") continue;
    const t = item.replace(/\s+/g, " ").trim();
    if (!t || hasPlaceholder(t)) continue;
    if (guardNumbers(t, known).text !== t) {
      dropped++;
      continue;
    }
    kept.push(t);
  }
  return { kept: freshFacts(kept.map((text) => ({ text })), []).map((f) => f.text).slice(0, MAX_EXTRACTED), dropped };
}

// ---------- coaching examples ----------

/** Parts of a strong bullet, shown under each example. */
export type AnatomyPart = "verb" | "scope" | "tool" | "result";
const PARTS: readonly AnatomyPart[] = ["verb", "scope", "tool", "result"];

/** A metric left blank in an example: the student decides what goes there before it touches the resume. */
export type Blank = {
  /** "b1": matches `{{b1}}` in the example text. */
  key: string;
  /** What to measure ("students tutored per week"). Also the [placeholder] text if they leave it blank. */
  label: string;
  /** A typical honest range for a student, phrased as a hint. */
  hint: string;
  /** An illustrative value. Ephemeral: never saved or sent anywhere unless the student picks it. */
  example_value: string;
  /** How to find the real number, with an estimation tip. */
  question: string;
  /** A value one of the student's own facts supplies ("from your facts"). */
  prefill?: { value: string; fact: string };
};

/**
 * An AI example bullet. Lives only in the page's state: the text (with `{{b1}}` blanks) and example
 * values never go into facts, the database or any prompt. Only the bullet the student builds from it,
 * with every blank resolved, does (resolveBlanks).
 */
export type CoachExample = {
  id: string;
  text: string;
  anatomy: { part: AnatomyPart; span: string }[];
  /** One line on why a recruiter for this kind of role cares (no statistics). */
  why: string;
  blanks: Blank[];
};

export const MAX_EXAMPLES = 3;
const BLANK_RE = /\{\{\s*(b\d{1,2})\s*\}\}/gi;
const s = (v: unknown, max = 300) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * Check a model reply (`{ examples: [...] }`) before the page sees it:
 * - every metric must be a `{{bN}}` blank: with blanks masked, the text goes through guardNumbers with
 *   only the student's real sources (`sources`: the bullet's text, their active facts); any example the
 *   guard would change (a stray number outside a blank) is dropped, and so is one with [brackets];
 * - blanks and tokens must match one to one (an example with a token but no blank is dropped; a blank
 *   with no token is ignored);
 * - "why" lines with a number are emptied (no invented statistics); anatomy spans must be in the text;
 * - a blank whose value one of `facts` states (the model names the fact and the value, and the value is
 *   really in that fact) gets `prefill`.
 */
export function validateExamples(raw: unknown, opts: { sources: string[]; facts: string[]; round?: number }): CoachExample[] {
  const list = (raw as { examples?: unknown } | null)?.examples;
  if (!Array.isArray(list)) return [];
  const known = knownNumbers(opts.sources);
  const facts = new Map(opts.facts.map((f) => [f.toLowerCase().replace(/\s+/g, " ").trim(), f]));
  const out: CoachExample[] = [];
  for (const item of list) {
    if (out.length >= MAX_EXAMPLES) break;
    const ex = (item ?? {}) as Record<string, unknown>;
    const text = s(ex.text, 400).replace(BLANK_RE, (_, k: string) => `{{${k.toLowerCase()}}}`);
    if (!text || hasPlaceholder(text)) continue;
    const tokens = [...new Set([...text.matchAll(BLANK_RE)].map((m) => m[1].toLowerCase()))];
    const blanks: Blank[] = [];
    for (const b of Array.isArray(ex.blanks) ? ex.blanks : []) {
      const r = (b ?? {}) as Record<string, unknown>;
      const key = s(r.key, 8).replace(/[{}\s]/g, "").toLowerCase();
      const label = s(r.label, 60).replace(/[[\]]/g, "");
      if (!tokens.includes(key) || !label || blanks.some((x) => x.key === key)) continue;
      const blank: Blank = { key, label, hint: s(r.hint, 200), example_value: s(r.example_value, 40), question: s(r.question, 300) };
      const fact = facts.get(s(r.from_fact, 400).toLowerCase());
      const value = s(r.fact_value, 40);
      if (fact && value && fact.toLowerCase().includes(value.toLowerCase())) blank.prefill = { value, fact };
      blanks.push(blank);
    }
    if (tokens.some((t) => !blanks.some((b) => b.key === t))) continue;
    const masked = text.replace(BLANK_RE, (_, k: string) => `[${k}]`);
    if (guardNumbers(masked, known).text !== masked) continue;
    const why = s(ex.why, 240);
    const anatomy = (Array.isArray(ex.anatomy) ? ex.anatomy : [])
      .map((a) => ({ part: s((a as Record<string, unknown>)?.part, 10).toLowerCase() as AnatomyPart, span: s((a as Record<string, unknown>)?.span, 200) }))
      .filter((a) => PARTS.includes(a.part) && a.span && text.toLowerCase().includes(a.span.toLowerCase()));
    out.push({
      id: `ex${opts.round ?? 1}_${out.length}`,
      text,
      anatomy,
      why: guardNumbers(why, []).text === why ? why : "",
      blanks,
    });
  }
  return out;
}

// ---------- resolving blanks ----------

/** What the student picked for one blank. Nothing is preselected (except a value from their own facts). */
export type BlankChoice =
  | { kind: "example" }
  | { kind: "own"; value: string }
  | { kind: "placeholder" }
  | { kind: "fact" };

export type Resolution = {
  /** The bullet as it would go on the resume. */
  text: string;
  /** Some blanks became [placeholders]: the fact saved with it is a draft until they're filled. */
  hasPlaceholders: boolean;
  /** Every blank has a choice (and "write my own" isn't empty): the bullet can be added. */
  complete: boolean;
  /** Keys still needing a choice. */
  missing: string[];
};

/**
 * Build the final bullet from an example and the student's choices: each `{{bN}}` becomes the example
 * value, their own value, the value from their facts, or `[label]`. A blank without a usable choice
 * shows as `[label]` in the preview and makes the result incomplete.
 */
export function resolveBlanks(example: Pick<CoachExample, "text" | "blanks">, choices: Record<string, BlankChoice | undefined>): Resolution {
  const missing: string[] = [];
  let placeholders = false;
  const byKey = new Map(example.blanks.map((b) => [b.key, b]));
  const text = example.text
    .replace(BLANK_RE, (_, raw: string) => {
      const key = raw.toLowerCase();
      const b = byKey.get(key);
      const c = choices[key];
      const label = `[${b?.label || key}]`;
      if (!b || !c) {
        if (!missing.includes(key)) missing.push(key);
        placeholders = true;
        return label;
      }
      if (c.kind === "placeholder") {
        placeholders = true;
        return label;
      }
      const value = (c.kind === "own" ? c.value : c.kind === "fact" ? (b.prefill?.value ?? "") : b.example_value).trim();
      if (!value) {
        if (!missing.includes(key)) missing.push(key);
        placeholders = true;
        return label;
      }
      return value;
    })
    .replace(/\s+/g, " ")
    .trim();
  return { text, hasPlaceholders: placeholders || hasPlaceholder(text), complete: missing.length === 0, missing };
}

/** The starting choices: blanks your facts fill are set to that value; everything else is unset. */
export const initialChoices = (blanks: Blank[]): Record<string, BlankChoice | undefined> =>
  Object.fromEntries(blanks.filter((b) => b.prefill).map((b) => [b.key, { kind: "fact" as const }]));

// ---------- putting the bullet on the resume ----------

export type CoachTarget = { sectionId: string; entryId: string; bulletId?: string | null };

/**
 * The resume with a coached bullet added at the end of the entry ("add", as `newId`) or in place of
 * the selected bullet's text ("replace", same id so its links and change tracking stay).
 */
export function insertCoachedBullet(
  r: Resume,
  target: CoachTarget,
  text: string,
  mode: "add" | "replace",
  newId: string,
): { resume: Resume; bulletId: string } {
  const bulletId = mode === "replace" && target.bulletId ? target.bulletId : newId;
  const resume: Resume = {
    ...r,
    sections: r.sections.map((sec) => ({
      ...sec,
      items: sec.items.map((it) => {
        if (it.id !== target.entryId) return it;
        if (mode === "replace" && target.bulletId && it.bullets.some((b) => b.id === target.bulletId)) {
          return { ...it, bullets: it.bullets.map((b) => (b.id === target.bulletId ? { ...b, text } : b)) };
        }
        // Fill an empty last bullet rather than leaving it dangling.
        const last = it.bullets[it.bullets.length - 1];
        if (mode === "add" && last && !last.text.trim()) {
          return { ...it, bullets: [...it.bullets.slice(0, -1), { id: bulletId, text }] };
        }
        return { ...it, bullets: [...it.bullets, { id: bulletId, text }] };
      }),
    })),
  };
  return { resume, bulletId };
}

/**
 * The fact for a bullet the student just put on the resume (their numbers, so vouched for): update the
 * fact already linked to that bullet, if any, else insert one. A bullet with [placeholders] makes a
 * draft fact that turns active once they're filled (planMirror).
 */
export function coachedFactPlan(
  facts: Fact[],
  link: { resumeId: string; bulletId: string; entryId: string },
  text: string,
): { kind: "update"; id: string; patch: { text: string; active: boolean } } | { kind: "insert"; fact: NewFact } {
  const linked = facts.find((f) => f.resume_id === link.resumeId && f.bullet_id === link.bulletId);
  if (linked) return { kind: "update", id: linked.id, patch: { text, active: factIsActive(text) } };
  return { kind: "insert", fact: { text, source: "coaching", resume_id: link.resumeId, bullet_id: link.bulletId, entry_id: link.entryId } };
}

// ---------- coaching questions ----------

export type CoachQuestion = { id: string; question: string; why: string; tip: string };

/** 3 to 5 questions from a model reply (`{ questions: [...] }`); fewer than 1 usable means none. */
export function validateQuestions(raw: unknown): CoachQuestion[] {
  const list = (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return [];
  return list
    .map((q, i) => {
      const r = (q ?? {}) as Record<string, unknown>;
      return { id: `cq${i}`, question: s(r.question, 300), why: s(r.why, 240), tip: s(r.tip, 240) };
    })
    .filter((q) => q.question)
    .slice(0, 5);
}

// ---------- the job tab's priority list ----------

export type PriorityItem = { bulletId: string; entry: string; text: string; rewrite: string; rating: "weak" | "ok"; note: string };

/**
 * Suggested rewrites to review first on a job tab: weak bullets, then "okay" bullets that have a
 * rewrite, each with the full rewrite. Built from the page's bulletFeedback, so rejected, stale and
 * accepted suggestions are already gone. Document order within each group.
 */
export function priorityItems(
  resume: Resume,
  feedback: Record<string, { state: string; rating: "strong" | "ok" | "weak"; note: string; suggestion: string }>,
): PriorityItem[] {
  const out: PriorityItem[] = [];
  for (const sec of resume.sections) {
    for (const it of sec.items) {
      for (const b of it.bullets) {
        const fb = feedback[b.id];
        if (!fb?.suggestion || fb.rating === "strong") continue;
        out.push({ bulletId: b.id, entry: it.title || it.subtitle || sec.title, text: b.text, rewrite: fb.suggestion, rating: fb.rating, note: fb.note });
      }
    }
  }
  return [...out.filter((p) => p.rating === "weak"), ...out.filter((p) => p.rating === "ok")];
}

// ---------- coaching requests ----------

/**
 * What the page sends to /api/coach/examples and /api/coach/questions: the entry and its bullets as the
 * student wrote them, which bullet is selected, the job (on a job tab), and for "More examples" only a
 * round number. Never example text: examples are ephemeral and must not reach any prompt.
 */
export type CoachRequest = {
  jobId: string | null;
  resumeId: string | null;
  entryId: string;
  entry: { title: string; subtitle: string; location: string; dates: string };
  bullets: { id: string; text: string }[];
  bulletId: string | null;
  round: number;
};

/** The request body for an entry or bullet of `resume` (see CoachRequest). */
export function coachRequest(
  resume: Resume,
  target: CoachTarget,
  opts: { jobId?: string | null; resumeId?: string | null; round?: number } = {},
): CoachRequest | null {
  const item = resume.sections.find((x) => x.id === target.sectionId)?.items.find((it) => it.id === target.entryId)
    ?? resume.sections.flatMap((x) => x.items).find((it) => it.id === target.entryId);
  if (!item) return null;
  return {
    jobId: opts.jobId ?? null,
    resumeId: opts.resumeId ?? null,
    entryId: item.id,
    entry: { title: item.title, subtitle: item.subtitle, location: item.location, dates: item.dates },
    bullets: item.bullets.filter((b) => b.text.trim()).map((b) => ({ id: b.id, text: b.text })),
    bulletId: target.bulletId && item.bullets.some((b) => b.id === target.bulletId) ? target.bulletId : null,
    round: Math.max(1, Math.min(9, Math.round(opts.round ?? 1))),
  };
}

/** Read a CoachRequest from an untrusted body (lengths capped, junk dropped). Null if there's no entry. */
export function parseCoachRequest(body: unknown): CoachRequest | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const e = (b.entry ?? {}) as Record<string, unknown>;
  const entryId = s(b.entryId, 64);
  if (!entryId) return null;
  const bullets = (Array.isArray(b.bullets) ? b.bullets : [])
    .map((x) => ({ id: s((x as Record<string, unknown>)?.id, 64), text: s((x as Record<string, unknown>)?.text, 600) }))
    .filter((x) => x.id && x.text)
    .slice(0, 20);
  const bulletId = s(b.bulletId, 64);
  const round = Number(b.round);
  return {
    jobId: s(b.jobId, 64) || null,
    resumeId: s(b.resumeId, 64) || null,
    entryId,
    entry: { title: s(e.title, 200), subtitle: s(e.subtitle, 200), location: s(e.location, 120), dates: s(e.dates, 80) },
    bullets,
    bulletId: bullets.some((x) => x.id === bulletId) ? bulletId : null,
    round: Number.isFinite(round) ? Math.max(1, Math.min(9, Math.round(round))) : 1,
  };
}

/** "Acme Corp | Data Analyst Intern | Boston, MA | Jun 2025 – Aug 2025". */
export const entryLine = (e: CoachRequest["entry"]) => [e.title, e.subtitle, e.location, e.dates].filter(Boolean).join(" | ");

/** An example's text split into plain text and blanks, for display ("Led ", {blank: "b1"}, " sessions"). */
export function exampleSegments(text: string): ({ text: string } | { blank: string })[] {
  const out: ({ text: string } | { blank: string })[] = [];
  let at = 0;
  for (const m of text.matchAll(BLANK_RE)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index) });
    out.push({ blank: m[1].toLowerCase() });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
