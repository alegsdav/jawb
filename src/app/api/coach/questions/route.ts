import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geminiJSON } from "@/lib/gemini";
import { coachQuestionsPrompt } from "@/lib/prompts";
import { friendlyError } from "@/lib/api";
import { budgetErrorResponse, withAiBudget } from "@/lib/aiBudget";
import { parseCoachRequest, validateQuestions } from "@/lib/coaching";
import { coachContext } from "@/lib/coachServer";

export const maxDuration = 60;

/** 3 to 5 questions that help the student find real numbers and details for an entry (light AI call). */
export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const r = parseCoachRequest(await req.json().catch(() => null));
  if (!r) return NextResponse.json({ error: "Select an entry or bullet first." }, { status: 400 });
  const ctx = await coachContext(supabase, r);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  try {
    const raw = await withAiBudget(supabase, { action: "coach_questions" }, (meter) =>
      geminiJSON<unknown>(coachQuestionsPrompt(ctx.context), { temperature: 0.4, onUsage: meter.add }),
    );
    const questions = validateQuestions(raw);
    if (!questions.length) return NextResponse.json({ error: "The AI didn't come up with questions. Try again." }, { status: 422 });
    return NextResponse.json({ questions });
  } catch (e) {
    const limited = budgetErrorResponse(e);
    if (limited) return limited;
    console.error("coach/questions failed:", e);
    return NextResponse.json({ error: friendlyError(e, "Couldn't get questions. Try again in a minute.") }, { status: 502 });
  }
}
