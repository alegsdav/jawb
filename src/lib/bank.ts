import type { SupabaseClient } from "@supabase/supabase-js";
import type { BankBullet, Resume } from "./types";

/**
 * Bank entries live in the `bullets` table; their kind is carried in tags so no schema change is needed:
 *   "example"        AI-written example for a role (mock numbers in [brackets]); not the user's own claim
 *   "from-resume"    pulled from an uploaded resume
 *   "accepted"       a suggested rewrite the user accepted
 *   "job:<id>"       tied to a job (role-specific)
 *   "entry:<id>"     resume entry it fits
 */
export const isExample = (b: Pick<BankBullet, "tags">) => b.tags?.includes("example");
export const tagValue = (b: Pick<BankBullet, "tags">, key: "job" | "entry") =>
  b.tags?.find((t) => t.startsWith(`${key}:`))?.slice(key.length + 1) ?? null;

export const MOCK_RE = /\[[^\]\n]+\]/g;
export const hasMock = (text: string) => /\[[^\]\n]+\]/.test(text);
export const countMocks = (texts: string[]) => texts.reduce((n, t) => n + (t.match(MOCK_RE)?.length ?? 0), 0);

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

export type NewBankRow = { source: string; text: string; tags: string[] };

/** All non-empty bullets in a resume, labeled with the entry they came from. */
export function bulletsFromResume(r: Resume): NewBankRow[] {
  const rows: NewBankRow[] = [];
  for (const s of r.sections)
    for (const it of s.items)
      for (const b of it.bullets)
        if (b.text.trim()) rows.push({ source: it.title || s.title, text: b.text.trim(), tags: ["from-resume"] });
  return rows;
}

/**
 * Append to the user's own bullets, skipping any text already in the bank (case/whitespace-insensitive).
 * Never edits or removes existing rows.
 */
export async function addToBank(supabase: SupabaseClient, rows: NewBankRow[]): Promise<BankBullet[]> {
  const clean = rows.map((r) => ({ ...r, text: r.text.trim() })).filter((r) => r.text);
  if (!clean.length) return [];
  const { data: existing } = await supabase.from("bullets").select("text, tags");
  const seen = new Set((existing ?? []).filter((b) => !isExample(b)).map((b) => norm(b.text)));
  const fresh: NewBankRow[] = [];
  for (const r of clean) {
    const k = norm(r.text);
    if (!seen.has(k)) {
      seen.add(k);
      fresh.push(r);
    }
  }
  if (!fresh.length) return [];
  const { data, error } = await supabase.from("bullets").insert(fresh).select();
  if (error) throw error;
  return (data as BankBullet[]) ?? [];
}
