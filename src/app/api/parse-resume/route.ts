import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geminiJSON } from "@/lib/gemini";
import { parseResumePrompt } from "@/lib/prompts";
import { normalizeResume } from "@/lib/resume";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { text } = (await req.json()) as { text: string };
  if (!text?.trim()) return NextResponse.json({ error: "Paste your resume text." }, { status: 400 });
  try {
    const parsed = await geminiJSON<unknown>(parseResumePrompt(text), { temperature: 0 });
    return NextResponse.json({ resume: normalizeResume(parsed) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
