import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geminiText } from "@/lib/gemini";
import { coverLetterPrompt, formatFacts } from "@/lib/prompts";
import { normalizeResume, resumeToPlainText } from "@/lib/resume";
import { formatAnswers } from "@/lib/answers";
import { guardNumbers, normalizeAnalysis } from "@/lib/analysis";
import { friendlyError } from "@/lib/api";

// AI calls can be slow; Vercel (Fluid compute) allows up to 300s.
export const maxDuration = 120;

/** Draft a cover letter. Returns `{ cover_letter, saved }`; the page autosaves the letter either way. */
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
    console.error("cover-letter: loading failed:", loadError.message);
    return NextResponse.json({ error: friendlyError(loadError, "Couldn't load this job. Try again.") }, { status: 503 });
  }
  if (!job || !resume) return NextResponse.json({ error: "This job or its tailored copy no longer exists. Reload the page." }, { status: 404 });

  const resumeText = resumeToPlainText(normalizeResume(resume.content));
  const facts = master ? normalizeResume(master.content).facts : undefined;
  const answers = formatAnswers(job.analysis ? normalizeAnalysis(job.analysis) : null);
  const posting = `${job.title} at ${job.company} (${job.location})\n\n${job.description}`;
  try {
    const raw = await geminiText(
      coverLetterPrompt({ resume: resumeText, job: posting, facts: formatFacts(facts), answers }),
      { temperature: 0.6 },
    );
    // Honesty: numbers must come from the resume, facts, answers or the posting itself (company details).
    const letter = guardNumbers(raw.trim(), [resumeText, ...(facts ?? []), answers, posting]).text;
    const { error: saveError } = await supabase.from("jobs").update({ cover_letter: letter }).eq("id", jobId);
    // The page also autosaves the letter it receives, so a failed write here isn't lost.
    if (saveError) console.error("cover-letter: saving result failed:", saveError.message);
    return NextResponse.json({ cover_letter: letter, saved: !saveError });
  } catch (e) {
    console.error("cover-letter failed:", e);
    return NextResponse.json({ error: friendlyError(e, "The cover letter couldn't be drafted. Try again in a minute.") }, { status: 502 });
  }
}
