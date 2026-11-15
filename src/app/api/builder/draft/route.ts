import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geminiJSON } from "@/lib/gemini";
import { builderDraftPrompt } from "@/lib/prompts";
import { friendlyError } from "@/lib/api";
import { budgetErrorResponse, withAiBudget } from "@/lib/aiBudget";
import { buildDraftResume, builderFacts, parseBuilderInput } from "@/lib/builder";
import { insertFacts, loadFacts } from "@/lib/factStore";

export const maxDuration = 120;

/**
 * "Build my resume" (heavy AI call): a Harvard-format master resume from the builder's answers, with
 * draft bullets written only from what the student wrote ([placeholders] where a metric is missing).
 * The student's raw "what did you do" answers are saved as facts (source 'builder', linked to their
 * entries on the master). Returns `{ resume, facts }`; the page puts the resume on the master.
 */
export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const input = parseBuilderInput(await req.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Add your name and at least one experience first." }, { status: 400 });

  try {
    const raw = await withAiBudget(supabase, { action: "builder_draft" }, (meter) =>
      geminiJSON<unknown>(builderDraftPrompt(input.experiences, input.about.major), { temperature: 0.3, onUsage: meter.add }),
    );
    const resume = buildDraftResume(input, raw);

    // Save the raw answers as facts. A failure here doesn't lose the draft: it's reported, not fatal.
    const [{ data: master }, existing] = await Promise.all([
      supabase.from("resumes").select("id").eq("is_master", true).maybeSingle(),
      loadFacts(supabase),
    ]);
    let facts: unknown[] = [];
    let factsError = "";
    if (!existing.missing && !existing.error) {
      const saved = await insertFacts(supabase, builderFacts(input, (master as { id?: string } | null)?.id ?? null), existing.facts);
      if (saved.ok) facts = saved.value;
      else factsError = saved.error;
    }
    return NextResponse.json({ resume, facts, ...(factsError ? { factsError } : {}) });
  } catch (e) {
    const limited = budgetErrorResponse(e);
    if (limited) return limited;
    console.error("builder/draft failed:", e);
    return NextResponse.json({ error: friendlyError(e, "Couldn't build your resume. Your answers are kept; try again in a minute.") }, { status: 502 });
  }
}
