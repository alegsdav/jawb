import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geminiJSON } from "@/lib/gemini";
import { extractFactsPrompt } from "@/lib/prompts";
import { friendlyError } from "@/lib/api";
import { budgetErrorResponse, withAiBudget } from "@/lib/aiBudget";
import { FACTS_MIGRATION_HINT, insertFacts, loadFacts } from "@/lib/factStore";
import { checkExtractedFacts } from "@/lib/coaching";

export const maxDuration = 60;

type Body = {
  answer?: unknown;
  question?: unknown;
  /** The bullet or entry the answer is about (shown to the model as context only). */
  context?: unknown;
  /** Link the new facts to this entry of this resume (never to a bullet: they aren't a bullet's text). */
  resumeId?: unknown;
  entryId?: unknown;
};

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Turn one answer into atomic facts and save them right away (no confirmation step; the page shows
 * "Saved N facts · Undo"). Light AI call. Every fact must keep only numbers the answer itself states
 * (guardNumbers with the answer as the only source); any fact the guard would change is dropped. New
 * facts that duplicate an existing one are skipped. Returns `{ facts, dropped }` (the rows added).
 */
export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Body;
  const answer = text(body.answer, 4000);
  if (!answer) return NextResponse.json({ error: "Write an answer first." }, { status: 400 });
  const question = text(body.question, 600);
  const context = text(body.context, 1500);
  const resumeId = text(body.resumeId, 64) || null;
  const entryId = text(body.entryId, 64) || null;

  const existing = await loadFacts(supabase);
  if (existing.missing) return NextResponse.json({ error: FACTS_MIGRATION_HINT }, { status: 503 });
  if (existing.error) return NextResponse.json({ error: existing.error }, { status: 503 });

  try {
    const raw = await withAiBudget(supabase, { action: "extract_facts" }, (meter) =>
      geminiJSON<unknown>(extractFactsPrompt({ answer, question, context }), { temperature: 0, onUsage: meter.add }),
    );
    const { kept, dropped } = checkExtractedFacts(raw, answer);
    const saved = await insertFacts(
      supabase,
      kept.map((t) => ({ text: t, source: "extracted" as const, resume_id: entryId ? resumeId : null, entry_id: entryId })),
      existing.facts,
    );
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 503 });
    return NextResponse.json({ facts: saved.value, dropped });
  } catch (e) {
    const limited = budgetErrorResponse(e);
    if (limited) return limited;
    console.error("extract-facts failed:", e);
    return NextResponse.json({ error: friendlyError(e, "Couldn't save facts from your answer. Try again in a minute.") }, { status: 502 });
  }
}
