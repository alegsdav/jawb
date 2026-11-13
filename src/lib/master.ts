import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resume } from "./types";
import { normalizeResume } from "./resume";
import { addFacts } from "./facts";

/**
 * Conflict-safe writes to the master resume.
 *
 * Several places write the master's whole JSON (the master page's autosave, "add these answers to my
 * facts" and "save this version as my master" on a job). A plain update would let a stale copy in
 * one tab or device silently wipe what another just saved. Every write here is conditional on the
 * row's `updated_at` (bumped by a trigger on each update): if 0 rows match, someone else saved in
 * between, so we re-read and try again.
 */

/** Retries after the first attempt when another save lands in between. */
export const MASTER_RETRIES = 3;

type Row = { id: string; content: unknown; updated_at: string };

const errMsg = (e: { message?: string } | null | undefined, fallback: string) => e?.message || fallback;

/**
 * Read the master, apply `mutate` to its (normalized) content and write it back only if nobody saved
 * in between; on a conflict re-read and re-apply `mutate`, up to 3 more times. `mutate` must be pure
 * (it can run more than once). Returning the same object from `mutate` skips the write.
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
    if (error) return { ok: false, error: errMsg(error, "Couldn't load your master resume.") };
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
    if (e2) return { ok: false, error: errMsg(e2, "Couldn't save your master resume.") };
    if (rows?.length) return { ok: true, content: next };
    // 0 rows: the master changed since we read it. Loop: re-read and re-apply.
  }
  return { ok: false, error: "Your master resume kept changing while saving (another tab?). Try again." };
}

/**
 * The master page's autosave: write the whole local document, conditional on the `updated_at` the
 * page last saw. On a conflict, keep the local document but union in the server's facts (so a fact
 * added from another device or a job page is never dropped), and save again.
 *
 * Returns what was saved and the row's new `updated_at`. `content` is a different object from the
 * input only when facts were merged in, so the caller can update its local copy. Throws on errors.
 */
export async function saveMasterDocument(
  supabase: SupabaseClient,
  id: string,
  local: Resume,
  knownUpdatedAt: string,
): Promise<{ content: Resume; updatedAt: string }> {
  let content = local;
  let known = knownUpdatedAt;
  for (let attempt = 0; attempt <= MASTER_RETRIES; attempt++) {
    const { data: rows, error } = await supabase
      .from("resumes")
      .update({ content })
      .eq("id", id)
      .eq("updated_at", known)
      .select("updated_at");
    if (error) throw new Error(errMsg(error, "Couldn't save."));
    if (rows?.length) return { content, updatedAt: (rows[0] as { updated_at: string }).updated_at };

    const { data: server, error: e2 } = await supabase
      .from("resumes")
      .select("content, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (e2) throw new Error(errMsg(e2, "Couldn't save."));
    if (!server) throw new Error("Your master resume was deleted elsewhere. Reload the page.");
    const s = server as Omit<Row, "id">;
    content = addFacts(content, normalizeResume(s.content).facts ?? []);
    known = s.updated_at;
  }
  throw new Error("Your master resume kept changing while saving (another tab?). Reload the page.");
}
