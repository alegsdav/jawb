import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geminiText } from "@/lib/gemini";
import { coverLetterPrompt } from "@/lib/prompts";
import { normalizeResume, resumeToPlainText } from "@/lib/resume";
import { formatAnswers } from "@/lib/answers";

// AI calls can be slow; Vercel (Fluid compute) allows up to 300s.
export const maxDuration = 120;

export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { jobId } = (await req.json()) as { jobId: string };

  const [{ data: job }, { data: resume }] = await Promise.all([
    supabase.from("jobs").select("*").eq("id", jobId).single(),
    supabase.from("resumes").select("content").eq("job_id", jobId).maybeSingle(),
  ]);
  if (!job || !resume) return NextResponse.json({ error: "Job or resume not found" }, { status: 404 });

  try {
    const letter = await geminiText(
      coverLetterPrompt({
        resume: resumeToPlainText(normalizeResume(resume.content)),
        job: `${job.title} at ${job.company} (${job.location})\n\n${job.description}`,
        answers: formatAnswers(job.analysis),
      }),
      { temperature: 0.6 },
    );
    await supabase.from("jobs").update({ cover_letter: letter.trim() }).eq("id", jobId);
    return NextResponse.json({ cover_letter: letter.trim() });
  } catch (e) {
    console.error("cover-letter failed:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
