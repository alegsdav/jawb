import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser } from "@/lib/supabase/server";
import { geminiJSON } from "@/lib/gemini";
import { formatFacts, masterReviewPrompt } from "@/lib/prompts";
import { bulletTextMap, isEmptyResume, normalizeResume, resumeToPromptText } from "@/lib/resume";
import type { MasterAnalysis } from "@/lib/types";
import { attachOriginals, guardAnalysisNumbers, mergeAnalysis, normalizeMasterAnalysis } from "@/lib/analysis";
import { friendlyError } from "@/lib/api";
import { budgetErrorResponse, withAiBudget } from "@/lib/aiBudget";
import { isMissingColumn } from "@/lib/db";
import { loadFacts } from "@/lib/factStore";
import { factsForGuard, factsForPrompt, legacyFacts } from "@/lib/facts";

// AI calls can be slow; Vercel (Fluid compute) allows up to 300s.
export const maxDuration = 120;

const EMPTY_MASTER = "Your master resume is empty. Add your experience first, then run the review.";
const MAX_ANSWER_CHARS = 1000;
const MAX_ENTRIES = 200;
const MAX_ID_CHARS = 64;

let warnedNoColumn = false;

type MasterRow = { id: string; content: unknown; analysis: MasterAnalysis | null };

/** The stored review, normalized; null when nothing is stored. */
const storedReview = (raw: unknown): MasterAnalysis | null =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? normalizeMasterAnalysis(raw) : null;

/**
 * The master row, with its stored review. `column` is false before migration 0011 (no `analysis` column):
 * the row is then read without it and there is no stored review.
 */
async function loadMaster(supabase: SupabaseClient): Promise<{ row: MasterRow | null; column: boolean; error: unknown }> {
  const withColumn = await supabase.from("resumes").select("id, content, analysis").eq("is_master", true).maybeSingle();
  if (!withColumn.error) {
    const d = withColumn.data as { id: string; content: unknown; analysis: unknown } | null;
    return { row: d ? { id: d.id, content: d.content, analysis: storedReview(d.analysis) } : null, column: true, error: null };
  }
  if (!isMissingColumn(withColumn.error)) return { row: null, column: true, error: withColumn.error };
  const plain = await supabase.from("resumes").select("id, content").eq("is_master", true).maybeSingle();
  const d = plain.data as { id: string; content: unknown } | null;
  return { row: d ? { id: d.id, content: d.content, analysis: null } : null, column: false, error: plain.error };
}

/** The review as stored right now (it may have changed while the AI ran); `fallback` when it can't be read. */
async function currentReview(supabase: SupabaseClient, id: string, fallback: MasterAnalysis | null): Promise<MasterAnalysis | null> {
  const { data, error } = await supabase.from("resumes").select("analysis").eq("id", id).maybeSingle();
  if (error) return fallback;
  return storedReview((data as { analysis?: unknown } | null)?.analysis) ?? fallback;
}

/**
 * Writes only the `analysis` column of the master row. Returns false when it isn't saved (the column is
 * missing, the row is gone, or the write failed); the page then keeps the review itself.
 */
async function saveReview(supabase: SupabaseClient, id: string, analysis: MasterAnalysis): Promise<boolean> {
  const { data, error } = await supabase.from("resumes").update({ analysis }).eq("id", id).select("id");
  if (error) {
    if (isMissingColumn(error)) return false;
    console.error("analyze-master: saving result failed:", error.message);
    return false;
  }
  return Boolean(data?.length);
}

function noteMissingColumn() {
  if (warnedNoColumn) return;
  warnedNoColumn = true;
  console.info("The master review isn't stored until supabase/migrations/0011_master_analysis.sql is run.");
}

/** The student's earlier answers as "Q: … / A: …" blocks (answered questions only). */
function answerBlocks(a: MasterAnalysis | null): string {
  if (!a?.answers) return "";
  return a.questions
    .filter((q) => a.answers?.[q.id]?.trim())
    .map((q) => `Q: ${q.question}\nA: ${a.answers![q.id]}`)
    .join("\n\n");
}

/**
 * Keeps only what points at this resume: bullets whose id is on the master, the weakest list that
 * names those bullets, and question placeholders whose bullet is on the master.
 */
function keepOnResume(a: MasterAnalysis, texts: Map<string, string>): MasterAnalysis {
  const bullets = a.bullets.filter((b) => texts.has(b.bullet_id));
  const kept = new Set(bullets.map((b) => b.bullet_id));
  return {
    ...a,
    bullets,
    weakest: a.weakest.filter((id) => kept.has(id)),
    questions: a.questions.map((q) =>
      q.bullet_id && !texts.has(q.bullet_id) ? { id: q.id, question: q.question, why: q.why } : q,
    ),
  };
}

/**
 * One review of the master resume (no job). Returns `{ analysis, saved }`: `saved: false` means the result
 * isn't in the database (the column is missing, or the write failed), so the page keeps it itself.
 */
export async function POST() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [loaded, factRows] = await Promise.all([loadMaster(supabase), loadFacts(supabase)]);
  const loadError = loaded.error ?? (factRows.error ? { message: factRows.error } : null);
  if (loadError) {
    console.error("analyze-master: loading failed:", (loadError as { message?: string }).message ?? loadError);
    return NextResponse.json({ error: friendlyError(loadError, "Couldn't load your resume. Try again.") }, { status: 503 });
  }
  if (!loaded.row) return NextResponse.json({ error: EMPTY_MASTER }, { status: 400 });
  const { row } = loaded;
  const master = normalizeResume(row.content);
  if (isEmptyResume(master)) return NextResponse.json({ error: EMPTY_MASTER }, { status: 400 });
  if (!loaded.column) noteMissingColumn();

  // Active facts not already on the master; their numbers may be reused in any bullet (facts linked to
  // one of its bullets only count for that bullet). Before migration 0005: the master's old list.
  const facts = factRows.missing ? legacyFacts(row.content) : factsForPrompt(factRows.facts, master).map((f) => f.text);
  const guardFacts = factRows.missing ? facts : factsForGuard(factRows.facts, master).map((f) => f.text);
  const prev = row.analysis;
  const texts = bulletTextMap(master);
  const now = new Date();
  try {
    const raw = await withAiBudget(supabase, { action: "master_review" }, (meter) =>
      geminiJSON<unknown>(
        masterReviewPrompt({
          resume: resumeToPromptText(master),
          facts: formatFacts(facts),
          answers: answerBlocks(prev),
        }),
        { onUsage: meter.add },
      ),
    );
    // Remember what each bullet said when it was rated; keep only what points at this resume; then the
    // honesty guard: a number in a rewrite must be in that bullet's own text, the facts or the answers.
    const onResume = keepOnResume(attachOriginals(normalizeMasterAnalysis(raw), master), texts);
    const answerValues = Object.values(prev?.answers ?? {}).filter((v) => v.trim());
    const honest = guardAnalysisNumbers(onResume, [...guardFacts, ...answerValues], texts);
    // Answers given while the AI ran (on another device) are kept: merge with the review as it is now.
    const current = loaded.column ? await currentReview(supabase, row.id, prev) : prev;
    const analysis = mergeAnalysis(current, honest, now);
    const saved = loaded.column ? await saveReview(supabase, row.id, analysis) : false;
    return NextResponse.json({ analysis, saved });
  } catch (e) {
    const limited = budgetErrorResponse(e);
    if (limited) return limited;
    console.error("analyze-master failed:", e);
    return NextResponse.json({ error: friendlyError(e, "The review failed. Try again in a minute.") }, { status: 502 });
  }
}

type ReviewPatch = { answers?: Record<string, string>; dismissed?: string[] };

/** Checks a PATCH body's shape and sizes. Returns the cleaned values or a plain-language error. */
function parseReviewPatch(body: unknown): { ok: true; value: ReviewPatch } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "Couldn't read your changes. Reload the page and try again." };
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad;
  const b = body as Record<string, unknown>;
  const value: ReviewPatch = {};
  if (b.answers !== undefined) {
    if (!b.answers || typeof b.answers !== "object" || Array.isArray(b.answers)) return bad;
    const entries = Object.entries(b.answers as Record<string, unknown>);
    if (entries.length > MAX_ENTRIES) return bad;
    for (const [id, v] of entries) {
      if (!id || id.length > MAX_ID_CHARS || typeof v !== "string") return bad;
      if (v.length > MAX_ANSWER_CHARS) return { ok: false, error: `Answers can be at most ${MAX_ANSWER_CHARS} characters.` };
    }
    value.answers = Object.fromEntries(entries as [string, string][]);
  }
  if (b.dismissed !== undefined) {
    if (!Array.isArray(b.dismissed) || b.dismissed.length > MAX_ENTRIES) return bad;
    if (!b.dismissed.every((id) => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_CHARS)) return bad;
    value.dismissed = [...b.dismissed] as string[];
  }
  return { ok: true, value };
}

/**
 * Saves the page's changes to the review: `answers` merge per question id (an empty answer removes it),
 * `dismissed` replaces the list. Returns `{ analysis, saved }`; `analysis` is null when no review is stored
 * (none run yet, or migration 0011 is missing), and then nothing is saved.
 */
export async function PATCH(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const parsed = parseReviewPatch(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const loaded = await loadMaster(supabase);
  if (loaded.error) {
    console.error("analyze-master: loading failed:", (loaded.error as { message?: string }).message ?? loaded.error);
    return NextResponse.json({ error: friendlyError(loaded.error, "Couldn't load your review. Try again.") }, { status: 503 });
  }
  if (!loaded.row) return NextResponse.json({ error: EMPTY_MASTER }, { status: 400 });
  const prev = loaded.row.analysis;
  if (!prev) return NextResponse.json({ analysis: null, saved: false });

  const answers: Record<string, string> = { ...(prev.answers ?? {}) };
  for (const [id, v] of Object.entries(parsed.value.answers ?? {})) {
    const t = v.trim();
    if (t) answers[id] = t;
    else delete answers[id];
  }
  const analysis: MasterAnalysis = { ...prev, answers, dismissed: parsed.value.dismissed ?? prev.dismissed ?? [] };
  const saved = await saveReview(supabase, loaded.row.id, analysis);
  return NextResponse.json({ analysis, saved });
}
