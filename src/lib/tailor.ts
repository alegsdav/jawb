import type { Item, Resume, Section } from "./types";
import { resumeDoc, withDoc } from "./resume";
import { flattenDoc, insertParagraphsAfter, removeParagraphs, setParagraphText, type FlatEntry } from "./doc/model";
import type { DocInline, DocJSON, DocList, DocParagraph, FlatParagraph } from "./doc/types";

/**
 * Helpers for a job's tailored copy of the master resume (the copy is a document, like the master).
 *
 * A tailored copy carries `baseline`: the master's text when the copy was made (or last pulled), per paragraph id.
 * The copy keeps the master's paragraph ids, which is what links the two. Comparing the copy, its baseline and the
 * current master tells apart "the user edited (or deleted) this here" from "the master changed (or added, removed)
 * it since".
 */

/** Every paragraph's text by id, in document order (empty paragraphs included). */
function textsOf(doc: DocJSON): Map<string, string> {
  return new Map(flattenDoc(doc).map((p) => [p.id, p.text]));
}

/** The master's current text per paragraph id, as stored in a tailored copy's `baseline`. */
export function makeBaseline(master: Resume): Record<string, string> {
  return Object.fromEntries(textsOf(resumeDoc(master)));
}

/** The resume without tailoring bookkeeping (what gets sent, snapshotted or saved as the master). */
export function stripBaseline(r: Resume): Resume {
  const { baseline: _b, ...rest } = r;
  void _b;
  return rest;
}

/** A job's tailored copy: the master without its facts (facts never go to employers), plus its baseline. */
export function cloneForJob(master: Resume): Resume {
  const { facts: _facts, baseline: _b, ...body } = master;
  void _facts;
  void _b;
  return { ...structuredClone(body), baseline: makeBaseline(master) };
}

/**
 * `baseline` from stored row content (normalizeResume doesn't keep it). Non-text values and the legacy
 * "header.name" / "header.contact" keys are dropped.
 */
export function readBaseline(raw: unknown): Record<string, string> | undefined {
  const b = (raw as { baseline?: unknown } | null)?.baseline;
  if (!b || typeof b !== "object" || Array.isArray(b)) return undefined;
  return Object.fromEntries(
    Object.entries(b as Record<string, unknown>).filter(([k, v]) => typeof v === "string" && !k.startsWith("header.")),
  ) as Record<string, string>;
}

/** Copies made before baselines existed start tracking from the current master. */
export function ensureBaseline(copy: Resume, master: Resume): { resume: Resume; added: boolean } {
  if (copy.baseline) return { resume: copy, added: false };
  return { resume: { ...copy, baseline: makeBaseline(master) }, added: true };
}

/** Paragraph texts to mark "changed" against: the baseline when there is one, else the master. */
export function compareMap(baseline: Record<string, string> | undefined, master: Resume | null): Map<string, string> | null {
  if (baseline) return new Map(Object.entries(baseline));
  return master ? textsOf(resumeDoc(master)) : null;
}

// ---------- pulling master changes into a tailored copy ----------

/**
 * A run of new or removed lines: a section, an entry or a bullet (or a loose line), as one unit to offer.
 * `id` is its first paragraph's id; `ids` are all its paragraphs in document order. `label` and `where` (the
 * section or entry it sits in) are for display.
 */
export type PullGroup = { kind: "section" | "item" | "bullet"; id: string; label: string; where: string; ids: string[] };
/** Something the master has that this copy lacks (added to the master after the baseline). */
export type PullAddition = PullGroup;
/** Something this copy still has that the master removed since the baseline. Never removed automatically. */
export type PullRemoval = PullGroup;

export type PullPlan = {
  /** Paragraphs (bullets and lines) the master reworded that this copy still has as they were: "Pull" takes the new wording. */
  bullets: number;
  /** Paragraphs the master reworded but the user also edited in this copy (left alone). */
  skipped: number;
  /** Automatic updates "Pull" applies (the same as `bullets`). */
  total: number;
  /** New master runs this copy lacks (each offered with "Add"). */
  additions: PullAddition[];
  /** Runs the master removed that this copy still has ("remove here too?"). */
  removals: PullRemoval[];
};

const NONE: PullPlan = { bullets: 0, skipped: 0, total: 0, additions: [], removals: [] };

/** True when anything about the master differs from this copy's baseline in a way worth showing. */
export const hasPullChanges = (p: PullPlan) => p.total > 0 || p.additions.length > 0 || p.removals.length > 0;

const short = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const itemLabel = (it: Item) => [it.title, it.subtitle].map((x) => x.trim()).filter(Boolean).join(" — ") || "Untitled entry";
const sectionLabel = (s: Section) => s.title.trim() || "Untitled section";

/** What a run of paragraphs is, from the outline of `r` (the resume the paragraphs are in). */
function describeRun(r: Resume, run: FlatParagraph[]): PullGroup {
  const first = run[0];
  const ids = run.map((p) => p.id);
  for (const s of r.sections) {
    if (s.id === first.id) return { kind: "section", id: first.id, label: sectionLabel(s), where: "", ids };
    for (const it of s.items) {
      if (it.id === first.id) return { kind: "item", id: first.id, label: itemLabel(it), where: sectionLabel(s), ids };
      if (it.bullets.some((b) => b.id === first.id)) {
        return { kind: "bullet", id: first.id, label: short(first.text.trim()), where: itemLabel(it), ids };
      }
    }
  }
  return { kind: "bullet", id: first.id, label: short(first.text.trim()), where: "", ids };
}

/**
 * Runs of consecutive paragraphs that `pick` accepts, in document order. A run starts at a paragraph with text;
 * blank paragraphs only continue a run.
 */
function runsOf(paras: FlatParagraph[], pick: (p: FlatParagraph) => boolean): FlatParagraph[][] {
  const out: FlatParagraph[][] = [];
  let open = false;
  for (const p of paras) {
    if (!pick(p)) {
      open = false;
      continue;
    }
    if (!open) {
      if (!p.text.trim()) continue;
      out.push([]);
      open = true;
    }
    out[out.length - 1].push(p);
  }
  return out;
}

/** Master paragraphs the copy has never had and the baseline doesn't remember: lines to offer. */
function additionGroups(copy: Resume, master: Resume): PullGroup[] {
  const have = new Set(flattenDoc(resumeDoc(copy)).map((p) => p.id));
  const base = copy.baseline ?? {};
  const mflat = flattenDoc(resumeDoc(master));
  return runsOf(mflat, (p) => !have.has(p.id) && !(p.id in base)).map((run) => describeRun(master, run));
}

/** Copy paragraphs the master removed, where the copy still has the baseline wording. */
function removalGroups(copy: Resume, master: Resume): PullGroup[] {
  const base = copy.baseline ?? {};
  const inMaster = new Set(flattenDoc(resumeDoc(master)).map((p) => p.id));
  const cflat = flattenDoc(resumeDoc(copy));
  return runsOf(cflat, (p) => p.id in base && base[p.id] === p.text && !inMaster.has(p.id)).map((run) => describeRun(copy, run));
}

/**
 * Master paragraphs whose wording the copy takes (the master changed them, the copy still has the baseline text),
 * and how many paragraphs the master changed that the copy also edited (those are left alone).
 */
function textChanges(copy: Resume, master: Resume): { take: FlatParagraph[]; skipped: number } {
  const base = copy.baseline ?? {};
  const mById = new Map(flattenDoc(resumeDoc(master)).map((p) => [p.id, p] as const));
  const take: FlatParagraph[] = [];
  let skipped = 0;
  for (const p of flattenDoc(resumeDoc(copy))) {
    const old: string | undefined = base[p.id];
    const m = mById.get(p.id);
    if (old === undefined || !m || m.text === old || p.text === m.text) continue;
    if (p.text === old) take.push(m);
    else skipped++;
  }
  return { take, skipped };
}

/** What pulling the master's changes into this copy would do. */
export function planPull(copy: Resume | null, master: Resume | null): PullPlan {
  if (!copy || !master || !copy.baseline) return NONE;
  const { take, skipped } = textChanges(copy, master);
  return {
    bullets: take.length,
    skipped,
    total: take.length,
    additions: additionGroups(copy, master),
    removals: removalGroups(copy, master),
  };
}

/** The baseline with the master's text for these paragraphs. */
function takeTexts(base: Record<string, string> | undefined, master: Resume, ids: Iterable<string>): Record<string, string> {
  const all = makeBaseline(master);
  const out: Record<string, string> = { ...base };
  for (const id of ids) if (id in all) out[id] = all[id];
  return out;
}

/**
 * The baseline after a pull: the current master, except that additions not taken yet stay out (so they're still
 * offered) and removed paragraphs keep their old text (so they're still listed).
 */
function rebase(copy: Resume, master: Resume, plan: PullPlan): Record<string, string> {
  const old = copy.baseline ?? {};
  const next = makeBaseline(master);
  for (const a of plan.additions) for (const id of a.ids) delete next[id];
  for (const r of plan.removals) for (const id of r.ids) if (id in old) next[id] = old[id];
  return next;
}

/** A document node transform for every paragraph (list paragraphs included). */
function mapParagraphs(doc: DocJSON, fn: (p: DocParagraph) => DocParagraph): DocJSON {
  const mapList = (list: DocList): DocList =>
    ({
      ...list,
      content: list.content.map((li) => ({
        ...li,
        content: (li.content ?? []).map((c) => (c.type === "paragraph" ? fn(c) : mapList(c))),
      })),
    }) as DocList;
  return {
    ...doc,
    content: (doc.content ?? []).map((b) => (b.type === "paragraph" ? fn(b) : mapList(b))),
  };
}

/** The paragraph with its inline content replaced (its attrs stay). */
function withInline(p: DocParagraph, content: DocInline[] | undefined): DocParagraph {
  const out: DocParagraph = { ...p };
  delete out.content;
  if (content?.length) out.content = content;
  return out;
}

/**
 * Bring master changes into the copy: lines the master reworded take the master's wording and marks, where the
 * copy still has the baseline wording (a line edited here is kept). Additions and removals are not applied
 * (see addFromMaster and resolveRemoval).
 */
export function applyPull(copy: Resume, master: Resume): { resume: Resume } & PullPlan {
  const plan = planPull(copy, master);
  const sources = new Map(textChanges(copy, master).take.map((m) => [m.id, m.node] as const));
  const doc = mapParagraphs(resumeDoc(copy), (p) => {
    const src = sources.get(p.attrs?.id ?? "");
    return src ? withInline(p, src.content) : p;
  });
  return { resume: withDoc({ ...copy, baseline: rebase(copy, master, plan) }, doc), ...plan };
}

/** A master paragraph as a document entry (with its list placement). */
const entryOf = (p: FlatParagraph): FlatEntry => ({
  node: p.node,
  listType: p.listType,
  listAttrs: p.listAttrs,
  depth: p.depth,
  bullet: p.bullet,
});

/** Add one new master section, entry or bullet (all its lines) to the copy, in the master's place. Unchanged if it's gone. */
export function addFromMaster(copy: Resume, master: Resume, add: Pick<PullAddition, "id">): Resume {
  const group = additionGroups(copy, master).find((g) => g.id === add.id);
  if (!group) return copy;
  const mflat = flattenDoc(resumeDoc(master));
  const wanted = new Set(group.ids);
  const entries = mflat.filter((p) => wanted.has(p.id)).map(entryOf);
  const have = new Set(flattenDoc(resumeDoc(copy)).map((p) => p.id));
  // After the nearest earlier master line the copy has; at the start when there is none.
  const before = mflat.slice(0, mflat.findIndex((p) => p.id === group.id)).reverse().find((p) => have.has(p.id));
  const doc = insertParagraphsAfter(resumeDoc(copy), before?.id ?? null, entries);
  return withDoc({ ...copy, baseline: takeTexts(copy.baseline, master, group.ids) }, doc);
}

/** Add every new master section, entry and bullet the copy lacks. */
export function addAllFromMaster(copy: Resume, master: Resume): Resume {
  return planPull(copy, master).additions.reduce((r, a) => addFromMaster(r, master, a), copy);
}

/** Stop offering these additions here (they count as deliberately left out of this copy). */
export function dismissAdditions(copy: Resume, master: Resume, adds: Pick<PullAddition, "id">[]): Resume {
  const groups = additionGroups(copy, master);
  const ids = adds.flatMap((a) => groups.find((g) => g.id === a.id)?.ids ?? []);
  return { ...copy, baseline: takeTexts(copy.baseline, master, ids) };
}

/**
 * Answer "Removed from master: remove here too?". "remove" deletes its lines from the copy; "keep" keeps them as
 * something added in this copy. Either way they stop being listed.
 */
export function resolveRemoval(copy: Resume, removal: Pick<PullRemoval, "ids">, choice: "remove" | "keep"): Resume {
  const baseline = { ...copy.baseline };
  for (const id of removal.ids) delete baseline[id];
  const doc = choice === "remove" ? removeParagraphs(resumeDoc(copy), removal.ids) : resumeDoc(copy);
  return withDoc({ ...copy, baseline }, doc);
}

/**
 * The resume with one bullet's text replaced (accepting a suggestion, filling a placeholder). The paragraph and its
 * formatting stay; the text takes the formatting of the old text's first run. Unknown id: unchanged.
 */
export function replaceBullet(r: Resume, bulletId: string, text: string): Resume {
  return withDoc(r, setParagraphText(resumeDoc(r), bulletId, text));
}

/** Columns the job page autosaves (analysis is written separately). */
export const JOB_FIELDS = [
  "company", "title", "location", "url", "description", "status", "date_applied", "follow_up_date", "notes",
  "cover_letter", "deadline", "submitted_resume", "submitted_at", "submitted_tailored", "reached_interview",
  "suggestions_total", "suggestions_pending",
] as const;

const eq = (a: unknown, b: unknown) =>
  a === b || ((a ?? null) === null && (b ?? null) === null) ||
  (typeof a === "object" && typeof b === "object" && a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

/** Only the fields that differ between the last saved row and the current one. */
export function diffFields<T extends object, K extends keyof T>(prev: T, next: T, keys: readonly K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (!eq(prev[k], next[k])) out[k] = next[k];
  return out;
}

/** A copy of `o` without `keys`. */
export function omitKeys<T extends object>(o: T, keys: readonly string[]): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k))) as Partial<T>;
}

/**
 * The optional (post-0001) job columns a write error says are missing, e.g. PostgREST's "Could not find
 * the 'reached_interview' column of 'jobs'". When the message names none of them, all are assumed missing.
 */
export function missingOptionalColumns(message: string | undefined, optional: readonly string[]): string[] {
  const named = optional.filter((c) => new RegExp(`['"\\s.]${c}['"\\s]|column ${c}\\b`, "i").test(` ${message ?? ""} `));
  return named.length ? named : [...optional];
}
