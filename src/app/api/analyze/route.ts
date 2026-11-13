import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geminiJSON } from "@/lib/gemini";
import { analyzePrompt, formatFacts } from "@/lib/prompts";
import { normalizeResume, resumeToPromptText } from "@/lib/resume";
import type { Analysis } from "@/lib/types";
import { formatAnswers } from "@/lib/answers";
import { mergeAnalysis, normalizeAnalysis } from "@/lib/analysis";

// AI calls can be slow; Vercel (Fluid compute) allows up to 300s.
export const maxDuration = 120;

export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { jobId } = (await req.json()) as { jobId: string };

  const [{ data: job }, { data: resume }, { data: master }] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).single(),
    supabase.from("resumes").select("content").eq("job_id", jobId).maybeSingle(),
    supabase.from("resumes").select("content").eq("is_master", true).maybeSingle(),
  ]);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!resume) return NextResponse.json({ error: "No tailored resume for this job yet" }, { status: 400 });

  const prev = job.analysis ? normalizeAnalysis(job.analysis as Analysis) : null;
  try {
    const fresh = normalizeAnalysis(await geminiJSON<unknown>(
      analyzePrompt({
        resume: resumeToPromptText(normalizeResume(resume.content)),
        job: `${job.title} at ${job.company} (${job.location})\n\n${job.description}`,
        facts: formatFacts(master ? normalizeResume(master.content).facts : undefined),
        answers: formatAnswers(prev),
      }),
    ));
    const analysis = mergeAnalysis(prev, fresh, new Date());
    const { error: saveError } = await supabase.from("jobs").update({ analysis }).eq("id", jobId);
    if (saveError) console.error("analyze: saving result failed:", saveError.message);
    return NextResponse.json({ analysis });
  } catch (e) {
    console.error("analyze failed:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
