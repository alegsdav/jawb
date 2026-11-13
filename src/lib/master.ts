import type { SupabaseClient } from "@supabase/supabase-js";
import type { Bullet, Item, Resume, Section } from "./types";
import { normalizeResume } from "./resume";
import { dbErrorMessage } from "./db";

/**
 * Conflict-safe writes to the master resume.
 *
 * Several places write the master's whole JSON (the master page's autosave, "add these answers to my
 * facts" and "save this version as my master" on a job). A plain update would let a stale copy in
 * one tab or device silently wipe what another just saved. Every write here is conditional on the
 * row's `updated_at` (bumped by a trigger on each update): if 0 rows match, someone else saved in
 * between, so we re-read and either re-apply (updateMaster) or three-way merge (saveMasterDocument).
 */

/** Retries after the first attempt when another save lands in between. */
export const MASTER_RETRIES = 3;

type Row = { id: string; content: unknown; updated_at: string };

/**
 * Read the master, apply `mutate` to its (normalized) content and write it back only if nobody saved
 * in between; on a conflict re-read and re-apply `mutate`, up to 3 more times. `mutate` must be pure
 * (it can run more than once). Returning the same object from `mutate` skips the write.
 * Errors are plain sentences, safe to show.
 */
export async function updateMaster(
  supabase: SupabaseClient,
  mutate: (current: Resume) => Resume,
): Promise<{ ok: true; content: Resume } | { ok: false; error: string }> {
  for (let attempt = 0; attempt <= MASTER_RETRIES; attempt++) {
    const { data, error } = await supabase
      .from("resumes")
      .select("id, content, updated_at")
      .eq("is_master", true)
      .maybeSingle();
    if (error) return { ok: false, error: dbErrorMessage(error, "load") };
    if (!data) return { ok: false, error: "No master resume yet. Open Master resume and import yours first." };
    const row = data as Row;
    const current = normalizeResume(row.content);
    const next = mutate(current);
    if (next === current) return { ok: true, content: current };
    const { data: rows, error: e2 } = await supabase
      .from("resumes")
      .update({ content: next })
      .eq("id", row.id)
      .eq("updated_at", row.updated_at)
      .select("updated_at");
    if (e2) return { ok: false, error: dbErrorMessage(e2, "save") };
    if (rows?.length) return { ok: true, content: next };
    // 0 rows: the master changed since we read it. Loop: re-read and re-apply.
  }
  return { ok: false, error: "Your master resume kept changing while saving (another tab?). Try again." };
}

// ---------- three-way merge ----------

/** One spot that both sides changed differently. `local` is what the merged result holds for it. */
export type MergeConflict = {
  /** Human label, e.g. `Bullet in "Acme Corp"` or `Name`. */
  where: string;
  local: string;
  server: string;
};

export type MergeResult = { merged: Resume; conflicts: MergeConflict[] };

/** Structural equality for plain JSON values (key order doesn't matter). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => sameJson(x, bb[i]));
  }
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return (
    ka.length === kb.length &&
    ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

const normFact = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
const short = (t: string, n = 40) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/**
 * Three-way merge of a scalar. Whichever side changed relative to `base` wins; if both changed it to
 * different values it's a conflict and the merged value is the local one.
 */
function mergeScalar(
  b: string | undefined,
  l: string,
  s: string,
  where: string,
  conflicts: MergeConflict[],
): string {
  if (l === s) return l;
  if (b !== undefined && l === b) return s;
  if (b !== undefined && s === b) return l;
  conflicts.push({ where, local: l, server: s });
  return l;
}

/** Ids (in order) of `side` that are also in `other`. */
const commonOrder = (side: { id: string }[], other: Set<string>) => side.filter((x) => other.has(x.id)).map((x) => x.id);

/**
 * Merge two edited copies of a list of nodes keyed by id.
 * - In both: merged field by field (`mergeNode`).
 * - Added on one side (not in base): kept.
 * - Deleted on one side: gone, unless the other side edited that node (then the edited node is kept).
 * - Deleted on both: gone.
 * Order: the local order, unless only the server reordered; nodes only the other side has are
 * inserted after their nearest preceding neighbour there.
 */
function mergeList<T extends { id: string }>(
  base: T[],
  local: T[],
  server: T[],
  mergeNode: (b: T | undefined, l: T, s: T) => T,
): T[] {
  const B = new Map(base.map((x) => [x.id, x]));
  const L = new Map(local.map((x) => [x.id, x]));
  const S = new Map(server.map((x) => [x.id, x]));
  const keep = new Map<string, T>();
  for (const id of new Set([...L.keys(), ...S.keys()])) {
    const b = B.get(id);
    const l = L.get(id);
    const s = S.get(id);
    if (l && s) keep.set(id, mergeNode(b, l, s));
    else if (l) {
      if (!b || !sameJson(b, l)) keep.set(id, l); // local addition, or local edit beats the server's deletion
    } else if (s) {
      if (!b || !sameJson(b, s)) keep.set(id, s);
    }
  }

  const baseIds = new Set(B.keys());
  const reordered = (side: T[], sideIds: Set<string>) =>
    !sameJson(commonOrder(base, sideIds), commonOrder(side, baseIds));
  const localMoved = reordered(local, new Set(L.keys()));
  const serverMoved = reordered(server, new Set(S.keys()));
  const [primary, other] = serverMoved && !localMoved ? [server, local] : [local, server];

  const order = primary.filter((x) => keep.has(x.id)).map((x) => x.id);
  const placed = new Set(order);
  other.forEach((x, i) => {
    if (!keep.has(x.id) || placed.has(x.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(other[j].id);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    order.splice(at, 0, x.id);
    placed.add(x.id);
  });
  return order.map((id) => keep.get(id)!);
}

/** Facts merge as sets (case/whitespace-insensitive): additions from both sides, deletions from either stick. */
export function mergeFacts(base: string[] | undefined, local: string[] | undefined, server: string[] | undefined) {
  if (!local && !server) return undefined;
  const keys = (xs: string[] | undefined) => new Set((xs ?? []).map(normFact));
  const bk = keys(base);
  const lk = keys(local);
  const sk = keys(server);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of [...(local ?? []), ...(server ?? [])]) {
    const k = normFact(f);
    if (!k || seen.has(k)) continue;
    if (bk.has(k) && (!lk.has(k) || !sk.has(k))) continue; // deleted on one side
    seen.add(k);
    out.push(f);
  }
  return out;
}

/**
 * Three-way merge of the master resume. `base` is what this page last loaded or saved, `local` is
 * what's on screen, `server` is the row as it is now. Bullets, entry fields, header fields and
 * section titles are matched by id: whichever side changed something relative to base wins;
 * additions from either side are kept; a deletion wins only if the other side didn't edit that
 * node; facts merge as sets. Where both sides changed the same thing differently, it's listed in
 * `conflicts` and `merged` holds the local value (so `merged` is "keep mine" for conflicts and
 * "take theirs" for everything only they changed).
 */
export function mergeResumes(base: Resume, local: Resume, server: Resume): MergeResult {
  if (sameJson(local, server) || sameJson(server, base)) return { merged: local, conflicts: [] };
  if (sameJson(local, base)) return { merged: server, conflicts: [] };

  const conflicts: MergeConflict[] = [];

  const mergeBullet = (where: string) => (b: Bullet | undefined, l: Bullet, s: Bullet): Bullet => {
    const text = mergeScalar(b?.text, l.text, s.text, where, conflicts);
    return text === l.text ? l : { ...l, text };
  };

  const mergeItem = (b: Item | undefined, l: Item, s: Item): Item => {
    const name = short(l.title || s.title || l.subtitle || s.subtitle || "an entry");
    const field = (k: "title" | "subtitle" | "location" | "dates", label: string) =>
      mergeScalar(b?.[k], l[k], s[k], `${label} of "${name}"`, conflicts);
    return {
      ...l,
      title: field("title", "Title"),
      subtitle: field("subtitle", "Second line"),
      location: field("location", "Location"),
      dates: field("dates", "Dates"),
      bullets: mergeList(b?.bullets ?? [], l.bullets, s.bullets, mergeBullet(`Bullet in "${name}"`)),
    };
  };

  const mergeSection = (b: Section | undefined, l: Section, s: Section): Section => ({
    ...l,
    title: mergeScalar(b?.title, l.title, s.title, `Section title "${short(l.title || s.title)}"`, conflicts),
    items: mergeList(b?.items ?? [], l.items, s.items, mergeItem),
  });

  const sections = mergeList(base.sections, local.sections, server.sections, mergeSection);
  const merged: Resume = {
    ...local,
    version: Math.max(local.version ?? 0, server.version ?? 0) || local.version,
    header: {
      name: mergeScalar(base.header.name, local.header.name, server.header.name, "Name", conflicts),
      contact: mergeScalar(base.header.contact, local.header.contact, server.header.contact, "Contact line", conflicts),
    },
    sections: dedupeIds(sections, conflicts),
  };
  const facts = mergeFacts(base.facts, local.facts, server.facts);
  if (facts) merged.facts = facts;
  else delete merged.facts;
  return { merged, conflicts };
}

/**
 * A line moved to another entry on one side and edited on the other can end up twice. Keep the
 * first copy and report it, so it's never silently duplicated or dropped.
 */
function dedupeIds(sections: Section[], conflicts: MergeConflict[]): Section[] {
  const seen = { s: new Set<string>(), i: new Set<string>(), b: new Set<string>() };
  let dup = false;
  const out = sections
    .filter((s) => (seen.s.has(s.id) ? ((dup = true), false) : (seen.s.add(s.id), true)))
    .map((s) => ({
      ...s,
      items: s.items
        .filter((it) => (seen.i.has(it.id) ? ((dup = true), false) : (seen.i.add(it.id), true)))
        .map((it) => ({
          ...it,
          bullets: it.bullets.filter((b) => (seen.b.has(b.id) ? ((dup = true), false) : (seen.b.add(b.id), true))),
        })),
    }));
  if (!dup) return sections;
  conflicts.push({ where: "A line moved on one device and edited on the other", local: "", server: "" });
  return out;
}

// ---------- master page autosave ----------

export type MasterSaveResult =
  | {
      kind: "saved";
      /** What is now on the server. A different object from `local` when changes from elsewhere were merged in. */
      content: Resume;
      updatedAt: string;
      merged: boolean;
    }
  | {
      kind: "conflict";
      /** The row as it is now, and its `updated_at`. */
      server: Resume;
      serverUpdatedAt: string;
      conflicts: MergeConflict[];
    };

/**
 * The master page's autosave: write the local document, conditional on the `updated_at` the page
 * last saw. If the row changed elsewhere in between, three-way merge (base = what the page last
 * loaded or saved, local = on screen, server = the row now) and save the merged result; if both
 * sides changed the same thing, stop and return the conflict without writing anything.
 *
 * Throws (with a plain sentence) on database or network errors, so autosave retries.
 */
export async function saveMasterDocument(
  supabase: SupabaseClient,
  id: string,
  local: Resume,
  base: { content: Resume; updatedAt: string },
): Promise<MasterSaveResult> {
  let content = local;
  let baseContent = base.content;
  let known = base.updatedAt;
  for (let attempt = 0; attempt <= MASTER_RETRIES; attempt++) {
    const { data: rows, error } = await supabase
      .from("resumes")
      .update({ content })
      .eq("id", id)
      .eq("updated_at", known)
      .select("updated_at");
    if (error) throw new Error(dbErrorMessage(error, "autosave"));
    if (rows?.length) {
      return { kind: "saved", content, updatedAt: (rows[0] as { updated_at: string }).updated_at, merged: content !== local };
    }

    const { data: row, error: e2 } = await supabase
      .from("resumes")
      .select("content, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (e2) throw new Error(dbErrorMessage(e2, "autosave"));
    if (!row) throw new Error("Your master resume was deleted elsewhere. Reload the page.");
    const s = row as Omit<Row, "id">;
    const server = normalizeResume(s.content);
    const { merged, conflicts } = mergeResumes(baseContent, content, server);
    if (conflicts.length) return { kind: "conflict", server, serverUpdatedAt: s.updated_at, conflicts };
    // Nothing of ours left to add: the server already has it.
    if (sameJson(merged, server)) return { kind: "saved", content: server, updatedAt: s.updated_at, merged: !sameJson(server, local) };
    // Next round (if someone saves again before our write): base = this server copy, local = our merge.
    baseContent = server;
    content = merged;
    known = s.updated_at;
  }
  throw new Error("Your master resume kept changing while saving (another tab?). Reload the page.");
}
