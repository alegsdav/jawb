import type { SupabaseClient } from "@supabase/supabase-js";
import type { Fact, FactSource, Resume } from "./types";
import { dbErrorMessage, isMissingRelation } from "./db";
import { diffFactTexts, factRow, freshFacts, normFact, planMirror, type FactPatch, type MirrorUpdate, type NewFact } from "./facts";

/**
 * Reading and writing the `facts` table (migration 0005) with any Supabase client (browser or server;
 * RLS scopes every query to the signed-in student). Errors come back as plain sentences.
 */

export const FACT_COLS = "id, text, source, active, resume_id, bullet_id, entry_id, created_at, updated_at";

export const FACTS_MIGRATION_HINT =
  "Database update needed: run supabase/migrations/0005_facts.sql in your Supabase SQL editor to save facts.";

type Result<T> = { ok: true; value: T } | { ok: false; error: string; missing?: boolean };

const asFacts = (data: unknown): Fact[] => (Array.isArray(data) ? (data as Fact[]) : []);

/** Every fact, oldest first. `missing` when the table doesn't exist yet. */
export async function loadFacts(supabase: SupabaseClient): Promise<{ facts: Fact[]; missing: boolean; error: string | null }> {
  const { data, error } = await supabase.from("facts").select(FACT_COLS).order("created_at", { ascending: true });
  if (error) {
    if (isMissingRelation(error)) return { facts: [], missing: true, error: null };
    return { facts: [], missing: false, error: dbErrorMessage(error, "load") };
  }
  return { facts: asFacts(data), missing: false, error: null };
}

/** Insert new facts, skipping blanks and duplicates of `existing` (and of each other). Returns the rows added. */
export async function insertFacts(supabase: SupabaseClient, rows: NewFact[], existing: { text: string }[]): Promise<Result<Fact[]>> {
  const fresh = freshFacts(rows, existing);
  if (!fresh.length) return { ok: true, value: [] };
  const { data, error } = await supabase.from("facts").insert(fresh.map(factRow)).select(FACT_COLS);
  if (error) return { ok: false, error: isMissingRelation(error) ? FACTS_MIGRATION_HINT : dbErrorMessage(error, "save"), missing: isMissingRelation(error) };
  return { ok: true, value: asFacts(data) };
}

/** Change one fact. */
export async function updateFact(supabase: SupabaseClient, id: string, patch: FactPatch): Promise<Result<null>> {
  const { error } = await supabase.from("facts").update(patch).eq("id", id);
  return error ? { ok: false, error: dbErrorMessage(error, "save") } : { ok: true, value: null };
}

/** Delete facts by id. */
export async function deleteFacts(supabase: SupabaseClient, ids: string[]): Promise<Result<null>> {
  if (!ids.length) return { ok: true, value: null };
  const { error } = await supabase.from("facts").delete().in("id", ids);
  return error ? { ok: false, error: dbErrorMessage(error, "save") } : { ok: true, value: null };
}

/**
 * Write a mirror plan (planMirror). Throws a plain sentence on failure so the resume autosave that
 * runs it retries (the plan is recomputed on the retry).
 */
export async function applyMirror(supabase: SupabaseClient, updates: MirrorUpdate[]): Promise<void> {
  for (const u of updates) {
    const { error } = await supabase.from("facts").update(u.patch).eq("id", u.id);
    if (error && !isMissingRelation(error)) throw new Error(dbErrorMessage(error, "autosave"));
  }
}

/**
 * The fact side of one resume save: mirror the linked facts onto `resume` and return the facts as they
 * are now (the same array when nothing changed). Throws on failure (see applyMirror).
 */
export async function mirrorFacts(supabase: SupabaseClient, facts: Fact[], resumeId: string, resume: Resume): Promise<Fact[]> {
  const plan = planMirror(facts, resumeId, resume);
  if (!plan.length) return facts;
  await applyMirror(supabase, plan);
  const byId = new Map(plan.map((u) => [u.id, u.patch]));
  return facts.map((f) => (byId.has(f.id) ? { ...f, ...byId.get(f.id) } : f));
}

/**
 * Before a job (and its tailored copy) is deleted: its linked facts become standalone facts. The
 * database does the same on delete (migration 0005); doing it first keeps the page's list right.
 */
export async function unlinkResumeFacts(supabase: SupabaseClient, resumeId: string): Promise<void> {
  const { error } = await supabase.from("facts").update({ resume_id: null, bullet_id: null }).eq("resume_id", resumeId);
  if (error && !isMissingRelation(error)) console.warn("Couldn't unlink this job's facts:", error.message);
}

type ListWrite = (mutate: (m: Resume) => Resume) => Promise<{ ok: true; content: Resume } | { ok: false; error: string }>;

/**
 * Adapter for saveAnswersInOrder (analysis.ts), whose answer-fact logic works on a Resume's `facts`
 * list: read the facts table, hand `mutate` a resume whose `facts` are those texts, then write the
 * difference back (added texts as new rows with `source`; removed texts delete matching facts that
 * aren't linked to a bullet). The returned content's `facts` is the list after the write.
 */
export function factListWriter(supabase: SupabaseClient, source: FactSource, onFacts?: (facts: Fact[]) => void): ListWrite {
  return async (mutate) => {
    const loaded = await loadFacts(supabase);
    if (loaded.error) return { ok: false, error: loaded.error };
    if (loaded.missing) return { ok: false, error: FACTS_MIGRATION_HINT };
    const before = loaded.facts.map((f) => f.text);
    const pseudo: Resume = { version: 2, header: { name: "", contact: "" }, sections: [], facts: before };
    const next = mutate(pseudo);
    if (next === pseudo) return { ok: true, content: pseudo };
    const { add, remove } = diffFactTexts(before, next.facts ?? []);
    const gone = new Set(remove.map(normFact));
    const doomed = loaded.facts.filter((f) => !f.bullet_id && gone.has(normFact(f.text))).map((f) => f.id);
    const del = await deleteFacts(supabase, doomed);
    if (!del.ok) return { ok: false, error: del.error };
    const kept = loaded.facts.filter((f) => !doomed.includes(f.id));
    const ins = await insertFacts(supabase, add.map((text) => ({ text, source })), kept);
    if (!ins.ok) return { ok: false, error: ins.error };
    const now = [...kept, ...ins.value];
    onFacts?.(now);
    return { ok: true, content: { ...pseudo, facts: now.map((f) => f.text) } };
  };
}
