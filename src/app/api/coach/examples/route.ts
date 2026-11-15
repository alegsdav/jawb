import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geminiJSON } from "@/lib/gemini";
import { coachExamplesPrompt } from "@/lib/prompts";
import { friendlyError } from "@/lib/api";
import { budgetErrorResponse, withAiBudget } from "@/lib/aiBudget";
import { parseCoachRequest, validateExamples } from "@/lib/coaching";
import { coachContext } from "@/lib/coachServer";

export const maxDuration = 60;

/**
 * Up to 3 example bullets for an entry or bullet, every metric a {{bN}} blank (light AI call). Nothing
 * is saved: examples live only on the page until the student resolves the blanks and inserts one.
 * Any example with a number outside a blank that isn't in the student's own text is dropped.
 */
export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const r = parseCoachRequest(await req.json().catch(() => null));
  if (!r) return NextResponse.json({ error: "Select an entry or bullet first." }, { status: 400 });
  const ctx = await coachContext(supabase, r);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  try {
    const raw = await withAiBudget(supabase, { action: "coach_examples" }, (meter) =>
      geminiJSON<unknown>(coachExamplesPrompt({ ...ctx.context, round: r.round }), { temperature: r.round > 1 ? 0.8 : 0.5, onUsage: meter.add }),
    );
    const examples = validateExamples(raw, { sources: ctx.sources, facts: ctx.facts, round: r.round });
    if (!examples.length) {
      return NextResponse.json({ error: "The AI's examples didn't pass our honesty check. Try More examples." }, { status: 422 });
    }
    return NextResponse.json({ examples });
  } catch (e) {
    const limited = budgetErrorResponse(e);
    if (limited) return limited;
    console.error("coach/examples failed:", e);
    return NextResponse.json({ error: friendlyError(e, "Couldn't get examples. Try again in a minute.") }, { status: 502 });
  }
}
