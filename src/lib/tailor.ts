import type { Item, Resume, Section } from "./types";
import { bulletTextMap } from "./resume";

/**
 * Helpers for a job's tailored copy of the master resume.
 *
 * A tailored copy carries `baseline`: the master's wording and structure when the copy was made (or
 * last pulled), keyed by bullet id, HEADER_NAME / HEADER_CONTACT, and "section:ID" / "item:ID" for
 * sections and entries. Comparing the copy, its baseline and the current master tells apart "the
 * user edited (or deleted) this here" from "the master changed (or added/removed it) since".
 */

export const HEADER_NAME = "header.name";
export const HEADER_CONTACT = "header.contact";
/** Baseline keys for sections and entries (value: their title). Bullets are keyed by their bare id. */
const SECTION_KEY = "section:";
const ITEM_KEY = "item:";

/** The master's current wording and structure, as stored in a tailored copy's `baseline`. */
export function makeBaseline(master: Resume): Record<string, string> {
  const out: Record<string, string> = {
    ...Object.fromEntries(bulletTextMap(master)),
    [HEADER_NAME]: master.header.name,
    [HEADER_CONTACT]: master.header.contact,
  };
  for (const s of master.sections) {
    out[SECTION_KEY + s.id] = s.title;
    for (const it of s.items) out[ITEM_KEY + it.id] = it.title;
  }
  return out;
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

/** `baseline` from stored row content (normalizeResume doesn't keep it). */
export function readBaseline(raw: unknown): Record<string, string> | undefined {
  const b = (raw as { baseline?: unknown } | null)?.baseline;
  if (!b || typeof b !== "object" || Array.isArray(b)) return undefined;
  return Object.fromEntries(Object.entries(b as Record<string, unknown>).filter(([, v]) => typeof v === "string")) as Record<
    string,
    string
  >;
}

/** Copies made before baselines existed start tracking from the current master. */
export function ensureBaseline(copy: Resume, master: Resume): { resume: Resume; added: boolean } {
  if (copy.baseline) return { resume: copy, added: false };
  return { resume: { ...copy, baseline: makeBaseline(master) }, added: true };
}

/** Bullet texts to mark "changed" against: the baseline when there is one, else the master. */
export function compareMap(baseline: Record<string, string> | undefined, master: Resume | null): Map<string, string> | null {
  if (baseline) return new Map(Object.entries(baseline));
  return master ? bulletTextMap(master) : null;
}

// ---------- pulling master changes into a tailored copy ----------

/** Something the master has that this copy lacks (added to the master after the baseline). */
export type PullAddition =
  | { kind: "bullet"; id: string; itemId: string; text: string; where: string }
  | { kind: "item"; id: string; sectionId: string; label: string; where: string; bullets: number }
  | { kind: "section"; id: string; label: string; items: number };

/** Something this copy still has that the master removed since the baseline. Never removed automatically. */
export type PullRemoval = { kind: "bullet" | "item" | "section"; id: string; label: string };

export type PullPlan = {
  /** The master's name/contact changed since the baseline and the copy still has the old one (three-way). */
  header: boolean;
  /** The master's name/contact changed, but the copy edited it too: the copy's version is kept. */
  headerKept: boolean;
  /** Bullets still worded like the old master that will take the new master wording. */
  bullets: number;
  /** Bullets the master changed but the user also edited in this copy (left alone). */
  skipped: number;
  /** Automatic updates "Pull" applies: header (as one) + bullets. */
  total: number;
  /** New master bullets, entries and sections this copy lacks (each offered with "Add"). */
  additions: PullAddition[];
  /** Things the master removed that this copy still has ("remove here too?"). */
  removals: PullRemoval[];
};

const NONE: PullPlan = { header: false, headerKept: false, bullets: 0, skipped: 0, total: 0, additions: [], removals: [] };

/** True when anything about the master differs from this copy's baseline in a way worth showing. */
export const hasPullChanges = (p: PullPlan) => p.total > 0 || p.additions.length > 0 || p.removals.length > 0;

const short = (t: string, n = 90) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const itemLabel = (it: Item) => [it.title, it.subtitle].map((x) => x.trim()).filter(Boolean).join(" — ") || "Untitled entry";
const sectionLabel = (s: Section) => s.title.trim() || "Untitled section";

/** Old baselines (before round 3) only recorded bullets and the header, not sections/entries. */
const hasStructure = (base: Record<string, string>) =>
  Object.keys(base).some((k) => k.startsWith(SECTION_KEY) || k.startsWith(ITEM_KEY));

function headerField(copyV: string, baseV: string | undefined, masterV: string): "take" | "kept" | "none" {
  if (baseV === undefined || masterV === baseV || copyV === masterV) return "none";
  return copyV === baseV ? "take" : "kept";
}

/** Every baseline key for a section/entry/bullet and everything inside it. */
function subtreeKeys(r: Resume, kind: PullAddition["kind"], id: string): string[] {
  if (kind === "bullet") return [id];
  for (const s of r.sections) {
    if (kind === "section" && s.id === id) {
      return [SECTION_KEY + s.id, ...s.items.flatMap((it) => [ITEM_KEY + it.id, ...it.bullets.map((b) => b.id)])];
    }
    for (const it of s.items) if (kind === "item" && it.id === id) return [ITEM_KEY + it.id, ...it.bullets.map((b) => b.id)];
  }
  return [];
}

/** What pulling the master's changes into this copy would do. */
export function planPull(copy: Resume | null, master: Resume | null): PullPlan {
  const base = copy?.baseline;
  if (!copy || !master || !base) return NONE;

  const hName = headerField(copy.header.name, base[HEADER_NAME], master.header.name);
  const hContact = headerField(copy.header.contact, base[HEADER_CONTACT], master.header.contact);
  const header = hName === "take" || hContact === "take";
  const headerKept = hName === "kept" || hContact === "kept";

  const m = bulletTextMap(master);
  let bullets = 0;
  let skipped = 0;
  for (const [id, text] of bulletTextMap(copy)) {
    const old = base[id];
    const now = m.get(id);
    if (old === undefined || now === undefined || now === old || text === now) continue;
    if (text === old) bullets++;
    else skipped++;
  }

  const structured = hasStructure(base);
  const copySections = new Set(copy.sections.map((s) => s.id));
  const copyItems = new Set(copy.sections.flatMap((s) => s.items.map((it) => it.id)));
  const copyBullets = new Set(bulletTextMap(copy).keys());
  // In the baseline = the master had it when the copy was made, so if the copy lacks it the user deleted it here.
  const sectionInBase = (s: Section) =>
    structured ? SECTION_KEY + s.id in base : s.items.some((it) => it.bullets.some((b) => b.id in base));
  const itemInBase = (it: Item) => (structured ? ITEM_KEY + it.id in base : it.bullets.some((b) => b.id in base));

  const additions: PullAddition[] = [];
  for (const s of master.sections) {
    if (!copySections.has(s.id)) {
      if (!sectionInBase(s)) additions.push({ kind: "section", id: s.id, label: sectionLabel(s), items: s.items.length });
      continue;
    }
    for (const it of s.items) {
      if (!copyItems.has(it.id)) {
        if (!itemInBase(it)) {
          additions.push({ kind: "item", id: it.id, sectionId: s.id, label: itemLabel(it), where: sectionLabel(s), bullets: it.bullets.length });
        }
        continue;
      }
      for (const b of it.bullets) {
        if (!copyBullets.has(b.id) && !(b.id in base) && b.text.trim()) {
          additions.push({ kind: "bullet", id: b.id, itemId: it.id, text: b.text, where: itemLabel(it) });
        }
      }
    }
  }

  const removals: PullRemoval[] = [];
  const masterSections = new Set(master.sections.map((s) => s.id));
  const masterItems = new Set(master.sections.flatMap((s) => s.items.map((it) => it.id)));
  for (const s of copy.sections) {
    if (structured && SECTION_KEY + s.id in base && !masterSections.has(s.id)) {
      removals.push({ kind: "section", id: s.id, label: sectionLabel(s) });
      continue;
    }
    for (const it of s.items) {
      if (structured && ITEM_KEY + it.id in base && !masterItems.has(it.id)) {
        removals.push({ kind: "item", id: it.id, label: itemLabel(it) });
        continue;
      }
      for (const b of it.bullets) {
        if (b.id in base && !m.has(b.id)) removals.push({ kind: "bullet", id: b.id, label: short(b.text || base[b.id]) });
      }
    }
  }

  return { header, headerKept, bullets, skipped, total: (header ? 1 : 0) + bullets, additions, removals };
}

/**
 * The baseline after a pull: the current master, except that additions not taken yet stay out (so
 * they're still offered) and things the master removed keep their old entry (so they're still listed).
 */
function rebase(copy: Resume, master: Resume, plan: PullPlan): Record<string, string> {
  const old = copy.baseline ?? {};
  const next = makeBaseline(master);
  for (const a of plan.additions) for (const k of subtreeKeys(master, a.kind, a.id)) delete next[k];
  for (const r of plan.removals) for (const k of subtreeKeys(copy, r.kind, r.id)) if (k in old) next[k] = old[k];
  return next;
}

/**
 * Bring master changes into the copy: name and contact take the master's version only where the copy
 * still matches the baseline (a line edited here is kept), and bullets the user hasn't edited here take
 * the master's new wording. Additions and removals are not applied (see addFromMaster/resolveRemoval).
 */
export function applyPull(copy: Resume, master: Resume): { resume: Resume } & PullPlan {
  const plan = planPull(copy, master);
  const base = copy.baseline ?? {};
  const m = bulletTextMap(master);
  const take = (id: string, text: string) => {
    const old = base[id];
    const now = m.get(id);
    return old !== undefined && now !== undefined && now !== old && text === old ? now : text;
  };
  const h = (field: "name" | "contact", key: string) =>
    headerField(copy.header[field], base[key], master.header[field]) === "take" ? master.header[field] : copy.header[field];
  const resume: Resume = {
    ...copy,
    header: { name: h("name", HEADER_NAME), contact: h("contact", HEADER_CONTACT) },
    sections: copy.sections.map((s) => ({
      ...s,
      items: s.items.map((it) => ({ ...it, bullets: it.bullets.map((b) => ({ ...b, text: take(b.id, b.text) })) })),
    })),
    baseline: rebase(copy, master, plan),
  };
  return { resume, ...plan };
}

/** Index to insert at: right after the nearest earlier master sibling the copy has, else the start. */
function insertAt<T extends { id: string }>(masterList: T[], index: number, copyList: { id: string }[]): number {
  for (let i = index - 1; i >= 0; i--) {
    const at = copyList.findIndex((x) => x.id === masterList[i].id);
    if (at >= 0) return at + 1;
  }
  return 0;
}

function withKeys(copy: Resume, master: Resume, kind: PullAddition["kind"], id: string): Record<string, string> {
  const all = makeBaseline(master);
  const next = { ...(copy.baseline ?? {}) };
  for (const k of subtreeKeys(master, kind, id)) if (k in all) next[k] = all[k];
  return next;
}

/** Add one new master bullet/entry/section to the copy, in the master's position. Unchanged if it's gone. */
export function addFromMaster(copy: Resume, master: Resume, add: Pick<PullAddition, "kind" | "id">): Resume {
  const insert = <T,>(list: T[], at: number, x: T) => [...list.slice(0, at), x, ...list.slice(at)];
  if (add.kind === "section") {
    const si = master.sections.findIndex((s) => s.id === add.id);
    if (si < 0 || copy.sections.some((s) => s.id === add.id)) return copy;
    const sections = insert(copy.sections, insertAt(master.sections, si, copy.sections), structuredClone(master.sections[si]));
    return { ...copy, sections, baseline: withKeys(copy, master, "section", add.id) };
  }
  for (const ms of master.sections) {
    if (add.kind === "item") {
      const ii = ms.items.findIndex((it) => it.id === add.id);
      if (ii < 0) continue;
      const cs = copy.sections.find((s) => s.id === ms.id);
      if (!cs || cs.items.some((it) => it.id === add.id)) return copy;
      const item = structuredClone(ms.items[ii]);
      return {
        ...copy,
        sections: copy.sections.map((s) => (s === cs ? { ...s, items: insert(s.items, insertAt(ms.items, ii, s.items), item) } : s)),
        baseline: withKeys(copy, master, "item", add.id),
      };
    }
    for (const mit of ms.items) {
      const bi = mit.bullets.findIndex((b) => b.id === add.id);
      if (bi < 0) continue;
      if (bulletTextMap(copy).has(add.id)) return copy;
      let found = false;
      const sections = copy.sections.map((s) => ({
        ...s,
        items: s.items.map((it) => {
          if (it.id !== mit.id || found) return it;
          found = true;
          return { ...it, bullets: insert(it.bullets, insertAt(mit.bullets, bi, it.bullets), { ...mit.bullets[bi] }) };
        }),
      }));
      return found ? { ...copy, sections, baseline: withKeys(copy, master, "bullet", add.id) } : copy;
    }
  }
  return copy;
}

/** Add every new master bullet, entry and section the copy lacks. */
export function addAllFromMaster(copy: Resume, master: Resume): Resume {
  return planPull(copy, master).additions.reduce((r, a) => addFromMaster(r, master, a), copy);
}

/** Stop offering these additions here (they count as deliberately left out of this copy). */
export function dismissAdditions(copy: Resume, master: Resume, adds: Pick<PullAddition, "kind" | "id">[]): Resume {
  return adds.reduce((r, a) => ({ ...r, baseline: withKeys(r, master, a.kind, a.id) }), copy);
}

/**
 * Answer "Removed from master: remove here too?". "remove" deletes it from the copy; "keep" keeps it
 * as something added in this copy. Either way it stops being listed.
 */
export function resolveRemoval(copy: Resume, removal: Pick<PullRemoval, "kind" | "id">, choice: "remove" | "keep"): Resume {
  const baseline = { ...(copy.baseline ?? {}) };
  for (const k of subtreeKeys(copy, removal.kind, removal.id)) delete baseline[k];
  if (choice === "keep") return { ...copy, baseline };
  const { kind, id } = removal;
  const sections =
    kind === "section"
      ? copy.sections.filter((s) => s.id !== id)
      : copy.sections.map((s) => ({
          ...s,
          items:
            kind === "item"
              ? s.items.filter((it) => it.id !== id)
              : s.items.map((it) => ({ ...it, bullets: it.bullets.filter((b) => b.id !== id) })),
        }));
  return { ...copy, sections, baseline };
}

/** The resume with one bullet's text replaced (accepting a suggestion, filling a placeholder). */
export function replaceBullet(r: Resume, bulletId: string, text: string): Resume {
  return {
    ...r,
    sections: r.sections.map((s) => ({
      ...s,
      items: s.items.map((it) => ({ ...it, bullets: it.bullets.map((b) => (b.id === bulletId ? { ...b, text } : b)) })),
    })),
  };
}

/** Columns the job page autosaves (analysis is written separately). */
export const JOB_FIELDS = [
  "company", "title", "location", "url", "description", "status", "date_applied", "follow_up_date", "notes",
  "cover_letter", "deadline", "submitted_resume", "submitted_at", "submitted_tailored", "reached_interview",
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
