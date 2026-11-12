import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geminiJSON } from "@/lib/gemini";
import { analyzePrompt } from "@/lib/prompts";
import { normalizeResume, resumeToPromptText } from "@/lib/resume";
import type { Analysis } from "@/lib/types";
import { formatAnswers } from "@/lib/answers";
import { normalizeAnalysis } from "@/lib/analysis";

// AI calls can be slow; Vercel (Fluid compute) allows up to 300s.
export const maxDuration = 120;

export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { jobId } = (await req.json()) as { jobId: string };

  const [{ data: job }, { data: resume }, { data: bank }] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).single(),
    supabase.from("resumes").select("content").eq("job_id", jobId).maybeSingle(),
    supabase.from("bullets").select("id, source, text").order("created_at"),
  ]);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!resume) return NextResponse.json({ error: "No tailored resume for this job yet" }, { status: 400 });

  const prev = job.analysis as Analysis | null;
  try {
    const result = normalizeAnalysis(await geminiJSON<unknown>(
      analyzePrompt({
        resume: resumeToPromptText(normalizeResume(resume.content)),
        job: `${job.title} at ${job.company} (${job.location})\n\n${job.description}`,
        bank: (bank ?? []).map((b) => `[bank:${b.id}] (${b.source}) ${b.text}`).join("\n"),
        answers: formatAnswers(prev),
      }),
    ));
    // Keep earlier answers (and their questions) so they keep informing future runs.
    const oldAnswered = (prev?.questions ?? []).filter((q) => prev?.answers?.[q.id]?.trim());
    const analysis: Analysis = {
      ...result,
      questions: [
        ...oldAnswered,
        ...result.questions.map((q, i) => ({ ...q, id: `q${Date.now()}_${i}` })),
      ],
      answers: prev?.answers ?? {},
      analyzed_at: new Date().toISOString(),
    };
    const { error: saveError } = await supabase.from("jobs").update({ analysis }).eq("id", jobId);
    if (saveError) console.error("analyze: saving result failed:", saveError.message);
    return NextResponse.json({ analysis });
  } catch (e) {
    console.error("analyze failed:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
