import type { Fact, FactSource, Resume } from "./types";


/** Append facts to a (master) resume, skipping blanks and case/whitespace-insensitive duplicates. */
export function addFacts(r: Resume, facts: string[]): Resume {
  const existing = r.facts ?? [];
  const seen = new Set(existing.map(normFact));
  const fresh: string[] = [];
  for (const f of facts.map((x) => x.trim()).filter(Boolean)) {
    const k = normFact(f);
    if (!seen.has(k)) {
      seen.add(k);
      fresh.push(f);
    }
  }
  return fresh.length ? { ...r, facts: [...existing, ...fresh] } : r;
}

/** Bracketed placeholders the AI leaves for numbers it doesn't know, e.g. "[X hrs]". */
export const PLACEHOLDER_RE = /\[[^\]\n]+\]/g;
export const hasPlaceholder = (text: string) => /\[[^\]\n]+\]/.test(text);
export const countPlaceholders = (texts: string[]) =>
  texts.reduce((n, t) => n + (t.match(PLACEHOLDER_RE)?.length ?? 0), 0);

/** "1 placeholder", "3 placeholders", "2 entries" (pass `many` for irregular plurals). */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- structured facts (migration 0005) ----------

/** The one normalized comparison for facts: case- and whitespace-insensitive. */
export const normFact = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/** A fact is a draft (not shown to the AI) while it still has a [placeholder]. */
export const factIsActive = (text: string) => !hasPlaceholder(text);

/** A fact to insert. Links are optional; `active` is derived from the text. */
export type NewFact = {
  text: string;
  source: FactSource;
  resume_id?: string | null;
  bullet_id?: string | null;
  entry_id?: string | null;
};

/** Short labels for the Facts panel. */
export const FACT_SOURCE_LABEL: Record<FactSource, string> = {
  resume: "From your resume",
  builder: "From the builder",
  answer: "Your answer",
  coaching: "Coaching",
  manual: "Added by you",
  extracted: "From your answer",
  legacy: "Saved earlier",
};

/**
 * The new facts worth inserting: trimmed, no blanks, and no case/whitespace duplicates of each other
 * or of an existing fact. Order is kept.
 */
export function freshFacts<T extends { text: string }>(candidates: T[], existing: { text: string }[]): T[] {
  const seen = new Set(existing.map((f) => normFact(f.text)));
  const out: T[] = [];
  for (const c of candidates) {
    const text = c.text.trim();
    const k = normFact(text);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ ...c, text });
  }
  return out;
}

/** The row to insert for a new fact (drafts with placeholders start inactive). */
export const factRow = (f: NewFact) => ({
  text: f.text.trim(),
  source: f.source,
  active: factIsActive(f.text),
  resume_id: f.resume_id ?? null,
  bullet_id: f.resume_id ? (f.bullet_id ?? null) : null,
  entry_id: f.entry_id ?? null,
});

export type FactPatch = Partial<Pick<Fact, "text" | "active" | "resume_id" | "bullet_id" | "entry_id">>;
export type MirrorUpdate = { id: string; patch: FactPatch };

/**
 * Keep facts linked to bullets of one resume (`resumeId`: the master or a job's tailored copy) in step
 * with that resume, as it is about to be (or was just) saved:
 * - the bullet's text changed: the fact takes the bullet's text (and becomes active once it has no
 *   [placeholders], or a draft again if it gained one);
 * - the bullet moved to another entry: entry_id follows it;
 * - the bullet was emptied or deleted: the link is cleared and the fact stays, with its last text;
 * - a fact linked only to an entry whose entry was deleted: the link is cleared.
 * Facts linked to other resumes are left alone. Returns only the facts that change.
 */
export function planMirror(facts: Fact[], resumeId: string, resume: Resume): MirrorUpdate[] {
  const bullets = new Map<string, { text: string; itemId: string }>();
  const items = new Set<string>();
  for (const s of resume.sections) {
    for (const it of s.items) {
      items.add(it.id);
      for (const b of it.bullets) bullets.set(b.id, { text: b.text.trim(), itemId: it.id });
    }
  }
  const out: MirrorUpdate[] = [];
  for (const f of facts) {
    if (f.resume_id !== resumeId) continue;
    const patch: FactPatch = {};
    if (f.bullet_id) {
      const at = bullets.get(f.bullet_id);
      if (!at || !at.text) {
        patch.resume_id = null;
        patch.bullet_id = null;
        if (f.entry_id && !items.has(f.entry_id)) patch.entry_id = null;
      } else {
        if (at.text !== f.text) patch.text = at.text;
        const active = factIsActive(at.text);
        if (active !== f.active) patch.active = active;
        if (f.entry_id !== at.itemId) patch.entry_id = at.itemId;
      }
    } else if (f.entry_id && !items.has(f.entry_id)) {
      patch.resume_id = null;
      patch.entry_id = null;
    }
    if (Object.keys(patch).length) out.push({ id: f.id, patch });
  }
  return out;
}

/** Normalized texts of every bullet on a resume. */
const bulletNorms = (r: Resume | null | undefined) =>
  new Set((r?.sections ?? []).flatMap((s) => s.items.flatMap((it) => it.bullets.map((b) => normFact(b.text)))).filter(Boolean));

/**
 * The facts to put in an AI prompt for `resume` (analysis, cover letter, coaching): active ones only,
 * minus any that read exactly like a bullet already on that resume (it's in the prompt once already).
 */
export function factsForPrompt(facts: Fact[], resume: Resume | null | undefined): Fact[] {
  const onPage = bulletNorms(resume);
  return facts.filter((f) => f.active && !onPage.has(normFact(f.text)));
}

/**
 * The facts the number guard may take numbers from for every bullet's rewrite: the prompt facts minus
 * facts linked to a bullet of this same resume. Those describe one bullet, so (as before facts were
 * rows) their numbers only count for that bullet, through its own text.
 */
export function factsForGuard(facts: Fact[], resume: Resume | null | undefined): Fact[] {
  const ids = new Set((resume?.sections ?? []).flatMap((s) => s.items.flatMap((it) => it.bullets.map((b) => b.id))));
  return factsForPrompt(facts, resume).filter((f) => !(f.bullet_id && ids.has(f.bullet_id)));
}

/**
 * Facts relevant to one entry for a coaching prompt: those linked to the entry or its bullets first,
 * then the most recent others, at most `cap` in all. Active facts only.
 */
export function relevantFacts(facts: Fact[], entry: { id: string; bulletIds: string[] }, cap = 12): Fact[] {
  const mine = new Set(entry.bulletIds);
  const active = facts.filter((f) => f.active);
  const linked = active.filter((f) => f.entry_id === entry.id || (f.bullet_id && mine.has(f.bullet_id)));
  const others = active
    .filter((f) => !linked.includes(f))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return [...linked, ...others].slice(0, cap);
}

/**
 * The master resume's old `content.facts` list as migration 0005 copies it: strings only, trimmed,
 * no blanks, case/whitespace duplicates collapsed. Used only when the facts table is missing
 * (migration 0005 not run yet), so the AI keeps the facts it had.
 */
export function legacyFacts(content: unknown): string[] {
  const raw = (content as { facts?: unknown } | null)?.facts;
  if (!Array.isArray(raw)) return [];
  return freshFacts(
    raw.filter((f): f is string => typeof f === "string").map((text) => ({ text })),
    [],
  ).map((f) => f.text);
}

/** Texts added and removed between two fact lists (normalized comparison). */
export function diffFactTexts(before: string[], after: string[]): { add: string[]; remove: string[] } {
  const b = new Set(before.map(normFact));
  const a = new Set(after.map(normFact));
  return {
    add: freshFacts(after.filter((t) => !b.has(normFact(t))).map((text) => ({ text })), []).map((f) => f.text),
    remove: before.filter((t) => !a.has(normFact(t))),
  };
}

/** Facts for an import: every non-empty bullet that has no linked fact yet, linked to its master bullet. */
export function importedBulletFacts(resume: Resume, masterId: string, facts: Fact[]): NewFact[] {
  const linked = new Set(facts.filter((f) => f.resume_id === masterId && f.bullet_id).map((f) => f.bullet_id));
  return resume.sections.flatMap((s) =>
    s.items.flatMap((it) =>
      it.bullets
        .filter((b) => b.text.trim() && !linked.has(b.id))
        .map((b) => ({ text: b.text, source: "resume" as const, resume_id: masterId, bullet_id: b.id, entry_id: it.id })),
    ),
  );
}
