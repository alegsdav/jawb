import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geminiJSON } from "@/lib/gemini";
import { analyzePrompt, formatFacts } from "@/lib/prompts";
import { bulletTextMap, normalizeResume, resumeToPromptText } from "@/lib/resume";
import type { Analysis } from "@/lib/types";
import { formatAnswers } from "@/lib/answers";
import { attachOriginals, guardAnalysisNumbers, mergeAnalysis, normalizeAnalysis } from "@/lib/analysis";
import { friendlyError } from "@/lib/api";
import { budgetErrorResponse, withAiBudget } from "@/lib/aiBudget";
import { loadFacts } from "@/lib/factStore";
import { factsForGuard, factsForPrompt, legacyFacts } from "@/lib/facts";

// AI calls can be slow; Vercel (Fluid compute) allows up to 300s.
export const maxDuration = 120;

/**
 * Analyze a job's tailored copy. Returns `{ analysis, saved }`: `saved: false` means the result
 * couldn't be written to the job here, so the page must store it itself (it does, with retries).
 */
export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { jobId } = ((await req.json().catch(() => ({}))) ?? {}) as { jobId?: string };
  if (!jobId) return NextResponse.json({ error: "Which job? Reload the page and try again." }, { status: 400 });

  const [{ data: job, error: eJ }, { data: resume, error: eR }, { data: master, error: eM }, factRows] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).maybeSingle(),
    supabase.from("resumes").select("content").eq("job_id", jobId).maybeSingle(),
    supabase.from("resumes").select("content").eq("is_master", true).maybeSingle(),
    loadFacts(supabase),
  ]);
  const loadError = eJ ?? eR ?? eM ?? (factRows.error ? { message: factRows.error } : null);
  if (loadError) {
    console.error("analyze: loading failed:", loadError.message);
    return NextResponse.json({ error: friendlyError(loadError, "Couldn't load this job. Try again.") }, { status: 503 });
  }
  if (!job) return NextResponse.json({ error: "This job no longer exists. It may have been deleted." }, { status: 404 });
  if (!resume) return NextResponse.json({ error: "This job has no tailored copy yet. Reload the page." }, { status: 400 });

  const tailored = normalizeResume(resume.content);
  // Active facts not already on the page; their numbers may be reused in any bullet (facts linked to
  // one of these bullets only count for that bullet). Before migration 0005: the master's old list.
  const facts = factRows.missing ? legacyFacts(master?.content) : factsForPrompt(factRows.facts, tailored).map((f) => f.text);
  const guardFacts = factRows.missing ? facts : factsForGuard(factRows.facts, tailored).map((f) => f.text);
  const prev = job.analysis ? normalizeAnalysis(job.analysis as Analysis) : null;
  const answers = formatAnswers(prev);
  try {
    // First analysis vs re-analysis are separate actions (both heavy today; see AI_WEIGHTS).
    const fresh = normalizeAnalysis(
      await withAiBudget(supabase, { action: prev ? "reanalyze" : "analyze" }, (meter) =>
        geminiJSON<unknown>(
          analyzePrompt({
            resume: resumeToPromptText(tailored),
            job: `${job.title} at ${job.company} (${job.location})\n\n${job.description}`,
            facts: formatFacts(facts),
            answers,
          }),
          { onUsage: meter.add },
        ),
      ),
    );
    // Remember what each bullet said when it was rated, so the page can hide feedback once it's edited.
    const rated = attachOriginals(fresh, tailored);
    // Honesty: a number in a rewrite must be in that bullet's own text, the facts or the answers (same
    // unit); anything else becomes a [placeholder] + a question.
    const answerValues = Object.values(prev?.answers ?? {}).filter((v) => v.trim());
    const honest = guardAnalysisNumbers(rated, [...guardFacts, ...answerValues], bulletTextMap(tailored));
    const now = new Date();
    let analysis = mergeAnalysis(prev, honest, now);
    // Save only over the row as it was read. If it changed while the AI ran (answers given on another
    // device), re-read it, carry its answers over and try once more; otherwise `saved: false` and the
    // page stores the result itself (conditionally, merging with what's there).
    let saved = false;
    let known: string | null = typeof job.updated_at === "string" ? job.updated_at : null;
    for (let attempt = 0; attempt < 2 && known; attempt++) {
      const { data: rows, error: saveError } = await supabase
        .from("jobs")
        .update({ analysis })
        .eq("id", jobId)
        .eq("updated_at", known)
        .select("updated_at");
      if (saveError) {
        console.error("analyze: saving result failed:", saveError.message);
        break;
      }
      if (rows?.length) {
        saved = true;
        break;
      }
      const { data: latest, error: readError } = await supabase.from("jobs").select("analysis, updated_at").eq("id", jobId).maybeSingle();
      if (readError || !latest) break;
      known = typeof latest.updated_at === "string" ? latest.updated_at : null;
      analysis = mergeAnalysis(latest.analysis ? normalizeAnalysis(latest.analysis as Analysis) : null, honest, now);
    }
    return NextResponse.json({ analysis, saved });
  } catch (e) {
    const limited = budgetErrorResponse(e);
    if (limited) return limited;
    console.error("analyze failed:", e);
    return NextResponse.json({ error: friendlyError(e, "The analysis failed. Try again in a minute.") }, { status: 502 });
  }
}
