import type { Resume } from "./types";
import { bulletTextMap } from "./resume";

/**
 * Helpers for a job's tailored copy of the master resume.
 *
 * A tailored copy carries `baseline`: the master's wording when the copy was made (or last pulled),
 * keyed by bullet id plus HEADER_NAME / HEADER_CONTACT. Comparing the copy, its baseline and the
 * current master tells apart "the user edited this bullet here" from "the master changed since".
 */

export const HEADER_NAME = "header.name";
export const HEADER_CONTACT = "header.contact";

/** The master's current wording, as stored in a tailored copy's `baseline`. */
export function makeBaseline(master: Resume): Record<string, string> {
  return {
    ...Object.fromEntries(bulletTextMap(master)),
    [HEADER_NAME]: master.header.name,
    [HEADER_CONTACT]: master.header.contact,
  };
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

export type PullPlan = {
  /** Master name/contact changed since the baseline and the copy doesn't match it yet. */
  header: boolean;
  /** Bullets still worded like the old master that will take the new master wording. */
  bullets: number;
  /** Bullets the master changed but the user also edited in this copy (left alone). */
  skipped: number;
  /** header (as one) + bullets. */
  total: number;
};

const NONE: PullPlan = { header: false, bullets: 0, skipped: 0, total: 0 };

/** What pulling the master's changes into this copy would do. */
export function planPull(copy: Resume | null, master: Resume | null): PullPlan {
  const base = copy?.baseline;
  if (!copy || !master || !base) return NONE;
  const headerChanged =
    (base[HEADER_NAME] !== undefined && base[HEADER_NAME] !== master.header.name) ||
    (base[HEADER_CONTACT] !== undefined && base[HEADER_CONTACT] !== master.header.contact);
  const header =
    headerChanged && (copy.header.name !== master.header.name || copy.header.contact !== master.header.contact);
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
  return { header, bullets, skipped, total: (header ? 1 : 0) + bullets };
}

/**
 * Bring master changes into the copy: the header always follows the master, and bullets the user
 * hasn't edited here take the master's new wording. Bullets edited in this copy are never touched.
 * The baseline moves to the current master, so the same change isn't offered again.
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
  const resume: Resume = {
    ...copy,
    header: { ...master.header },
    sections: copy.sections.map((s) => ({
      ...s,
      items: s.items.map((it) => ({ ...it, bullets: it.bullets.map((b) => ({ ...b, text: take(b.id, b.text) })) })),
    })),
    baseline: makeBaseline(master),
  };
  return { resume, ...plan };
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
  "cover_letter", "deadline", "submitted_resume", "submitted_at", "submitted_tailored",
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
