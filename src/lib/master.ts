import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resume } from "./types";
import type { DocJSON, FlatParagraph } from "./doc/types";
import { buildDoc, docEquals, flattenDoc } from "./doc/model";
import { normalizeResume, resumeDoc, setOpt, withDoc } from "./resume";
import { dbErrorMessage } from "./db";

/**
 * Conflict-safe writes to the master resume.
 *
 * Several places write the master's whole JSON (the master page's autosave and "save this version as
 * my master" on a job). A plain update would let a stale copy in
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
  /** Human label, e.g. `Line "Built a dashboard"`. */
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

const paragraphDoc = (p: FlatParagraph): DocJSON => ({ type: "doc", content: [p.node] });

/** Two paragraphs are the same when their text, formatting and list placement all match. */
export function sameParagraph(a: FlatParagraph, b: FlatParagraph): boolean {
  return (
    a.listType === b.listType && a.depth === b.depth && a.bullet === b.bullet && docEquals(paragraphDoc(a), paragraphDoc(b))
  );
}

const byId = (ps: FlatParagraph[]) => new Map(ps.map((p) => [p.id, p] as const));
const short = (t: string, n = 40) => {
  const s = t.replace(/\s+/g, " ").trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/**
 * What one paragraph id becomes, given its state in base, local and server (undefined = dropped).
 * - Changed on one side only (or identically on both): that side.
 * - Added on one side: kept.
 * - Deleted on one side and unchanged on the other: deleted.
 * - Deleted on one side and changed on the other, or changed differently on both: local is kept and the
 *   conflict is recorded. Same text on both sides with different formatting is not a conflict: local.
 */
function pickParagraph(
  b: FlatParagraph | undefined,
  l: FlatParagraph | undefined,
  s: FlatParagraph | undefined,
  conflicts: MergeConflict[],
): FlatParagraph | undefined {
  if (l && s) {
    if (sameParagraph(l, s)) return l;
    if (b && sameParagraph(l, b)) return s;
    if (b && sameParagraph(s, b)) return l;
    if (l.text !== s.text) conflicts.push({ where: `Line "${short(l.text)}"`, local: l.text, server: s.text });
    return l;
  }
  const only = l ?? s;
  if (!only) return undefined;
  if (!b) return only;
  if (sameParagraph(only, b)) return undefined;
  conflicts.push({ where: `Line "${short(only.text)}"`, local: l?.text ?? "", server: s?.text ?? "" });
  return only;
}

/**
 * `primary` (its ids in order, those in `keep` only), with the ids only `other` has inserted after their nearest
 * preceding neighbour that is already placed (first in front when there is none).
 */
export function placeInto(primary: string[], other: string[], keep: Set<string>): string[] {
  const order = primary.filter((id) => keep.has(id));
  const placed = new Set(order);
  other.forEach((id, i) => {
    if (!keep.has(id) || placed.has(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = order.indexOf(other[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    order.splice(at, 0, id);
    placed.add(id);
  });
  return order;
}

/**
 * The order of the kept paragraphs. Only one side can have moved paragraphs relative to base: that side's order is
 * primary, otherwise local's. The other side's additions are placed by placeInto.
 */
function mergeOrder(base: FlatParagraph[], local: FlatParagraph[], server: FlatParagraph[], keep: Set<string>): string[] {
  const ids = (ps: FlatParagraph[]) => ps.map((p) => p.id);
  const baseIds = new Set(ids(base));
  const moved = (side: FlatParagraph[]) => {
    const sideIds = new Set(ids(side));
    return !sameJson(ids(base).filter((id) => sideIds.has(id)), ids(side).filter((id) => baseIds.has(id)));
  };
  const [primary, other] = moved(server) && !moved(local) ? [server, local] : [local, server];
  return placeInto(ids(primary), ids(other), keep);
}

/**
 * Three-way merge of two edited documents, paragraph by paragraph. `base` is what both sides started from,
 * `local` what this side has, `server` what the other side has now. Each paragraph is compared as a whole (text,
 * formatting and list placement). Inputs are not changed.
 */
export function mergeDocs(base: DocJSON, local: DocJSON, server: DocJSON): { doc: DocJSON; conflicts: MergeConflict[] } {
  if (docEquals(local, server) || docEquals(server, base)) return { doc: local, conflicts: [] };
  if (docEquals(local, base)) return { doc: server, conflicts: [] };
  const B = flattenDoc(base);
  const L = flattenDoc(local);
  const S = flattenDoc(server);
  const [bm, lm, sm] = [B, L, S].map(byId);
  const conflicts: MergeConflict[] = [];
  const keep = new Map<string, FlatParagraph>();
  for (const id of new Set([...bm.keys(), ...lm.keys(), ...sm.keys()])) {
    const kept = pickParagraph(bm.get(id), lm.get(id), sm.get(id), conflicts);
    if (kept) keep.set(id, kept);
  }
  const order = mergeOrder(B, L, S, new Set(keep.keys()));
  return { doc: buildDoc(order.map((id) => keep.get(id)!)), conflicts };
}

/**
 * Three-way merge of the master resume. `base` is what this page last loaded or saved, `local` is what's on screen,
 * `server` is the row as it is now. The document is merged paragraph by paragraph (mergeDocs); the page setup is
 * local if it changed relative to base, else the server's. Where both sides changed the same paragraph differently,
 * it's listed in `conflicts` and `merged` holds the local version. Facts live in their own table (migration 0005);
 * the old `facts` JSON is carried over as stored, never merged.
 */
export function mergeResumes(base: Resume, local: Resume, server: Resume): MergeResult {
  if (sameJson(local, server) || sameJson(server, base)) return { merged: local, conflicts: [] };
  if (sameJson(local, base)) return { merged: server, conflicts: [] };

  const { doc, conflicts } = mergeDocs(resumeDoc(base), resumeDoc(local), resumeDoc(server));
  const merged = withDoc(local, doc);
  setOpt(merged, "page", sameJson(local.page, base.page) ? server.page : local.page);
  setOpt(merged, "facts", server.facts ?? local.facts);
  return { merged, conflicts };
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
