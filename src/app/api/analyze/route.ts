import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geminiJSON } from "@/lib/gemini";
import { analyzePrompt, formatFacts } from "@/lib/prompts";
import { bulletTextMap, normalizeResume, resumeToPromptText } from "@/lib/resume";
import type { Analysis } from "@/lib/types";
import { formatAnswers } from "@/lib/answers";
import { attachOriginals, guardAnalysisNumbers, mergeAnalysis, normalizeAnalysis } from "@/lib/analysis";
import { friendlyError } from "@/lib/api";

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

  const [{ data: job, error: eJ }, { data: resume, error: eR }, { data: master, error: eM }] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).maybeSingle(),
    supabase.from("resumes").select("content").eq("job_id", jobId).maybeSingle(),
    supabase.from("resumes").select("content").eq("is_master", true).maybeSingle(),
  ]);
  const loadError = eJ ?? eR ?? eM;
  if (loadError) {
    console.error("analyze: loading failed:", loadError.message);
    return NextResponse.json({ error: friendlyError(loadError, "Couldn't load this job. Try again.") }, { status: 503 });
  }
  if (!job) return NextResponse.json({ error: "This job no longer exists. It may have been deleted." }, { status: 404 });
  if (!resume) return NextResponse.json({ error: "This job has no tailored copy yet. Reload the page." }, { status: 400 });

  const tailored = normalizeResume(resume.content);
  const facts = master ? normalizeResume(master.content).facts : undefined;
  const prev = job.analysis ? normalizeAnalysis(job.analysis as Analysis) : null;
  const answers = formatAnswers(prev);
  try {
    const fresh = normalizeAnalysis(
      await geminiJSON<unknown>(
        analyzePrompt({
          resume: resumeToPromptText(tailored),
          job: `${job.title} at ${job.company} (${job.location})\n\n${job.description}`,
          facts: formatFacts(facts),
          answers,
        }),
      ),
    );
    // Remember what each bullet said when it was rated, so the page can hide feedback once it's edited.
    const rated = attachOriginals(fresh, tailored);
    // Honesty: a number in a rewrite must be in that bullet's own text, the facts or the answers (same
    // unit); anything else becomes a [placeholder] + a question.
    const answerValues = Object.values(prev?.answers ?? {}).filter((v) => v.trim());
    const honest = guardAnalysisNumbers(rated, [...(facts ?? []), ...answerValues], bulletTextMap(tailored));
    const analysis = mergeAnalysis(prev, honest, new Date());
    const { error: saveError } = await supabase.from("jobs").update({ analysis }).eq("id", jobId);
    if (saveError) console.error("analyze: saving result failed:", saveError.message);
    return NextResponse.json({ analysis, saved: !saveError });
  } catch (e) {
    console.error("analyze failed:", e);
    return NextResponse.json({ error: friendlyError(e, "The analysis failed. Try again in a minute.") }, { status: 502 });
  }
}
