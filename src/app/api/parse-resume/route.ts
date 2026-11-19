import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/api";
import { geminiJSON } from "@/lib/gemini";
import { parseResumePrompt } from "@/lib/prompts";
import { budgetErrorResponse, withAiBudget } from "@/lib/aiBudget";
import { NoTextError } from "@/lib/import/pdfToDoc";
import { resumeFromPdf } from "@/lib/import/resumeFromPdf";
import { harvardFromParsed } from "@/lib/import/textToHarvard";

// AI calls can be slow; Vercel (Fluid compute) allows up to 300s.
export const maxDuration = 120;

const MAX_FILE_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at ~4.5 MB
const MAX_TEXT_CHARS = 60_000;

/**
 * Accepts JSON {text} or multipart form-data with a "file" (PDF or .txt/.md). Returns {resume}, a version 4 resume.
 * A PDF is imported exactly as it is (no AI): its document keeps its fonts, sizes, lines and margins. The browser
 * normally reads PDFs itself (see lib/import/importPdf); this path is the fallback.
 * Pasted text and .txt/.md files have no formatting, so the AI works out the structure and the result is laid out
 * in the Harvard template (the look of the guided builder).
 */
export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let text: string | null = null;
  let pdf: Uint8Array | null = null;

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "File is over 4 MB." }, { status: 413 });
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      pdf = new Uint8Array(await file.arrayBuffer());
    } else if (file.type.startsWith("text/") || /\.(txt|md)$/i.test(file.name)) {
      text = await file.text();
      if (!text.trim()) return NextResponse.json({ error: "Couldn't find any text in that file." }, { status: 422 });
    } else {
      return NextResponse.json(
        { error: "Upload a PDF, a Word (.docx) or a text file." },
        { status: 415 },
      );
    }
  } else {
    text = (((await req.json().catch(() => ({}))) ?? {}) as { text?: string }).text ?? "";
    if (!text.trim()) return NextResponse.json({ error: "Paste your resume text." }, { status: 400 });
  }

  if (pdf) {
    try {
      return NextResponse.json({ resume: await resumeFromPdf(pdf) });
    } catch (e) {
      if (e instanceof NoTextError) return NextResponse.json({ error: e.message }, { status: 422 });
      console.error("parse-resume failed:", e);
      return NextResponse.json(
        { error: friendlyError(e, "Couldn't read that file. Export it again as a text PDF, or paste the text.") },
        { status: 422 },
      );
    }
  }

  const source = text ?? "";
  if (source.length > MAX_TEXT_CHARS) {
    return NextResponse.json({ error: "That text is over 60,000 characters. Paste only the resume." }, { status: 413 });
  }
  try {
    const parsed = await withAiBudget(supabase, { action: "parse_resume" }, (meter) =>
      geminiJSON<unknown>(parseResumePrompt(source), { temperature: 0, onUsage: meter.add }),
    );
    const resume = harvardFromParsed(parsed);
    if (!resume.sections.length) {
      return NextResponse.json({ error: "Couldn't find any resume sections in that file." }, { status: 422 });
    }
    return NextResponse.json({ resume });
  } catch (e) {
    const limited = budgetErrorResponse(e);
    if (limited) return limited;
    console.error("parse-resume failed:", e);
    return NextResponse.json(
      { error: friendlyError(e, "Couldn't read that resume. Try again, or paste the text instead.") },
      { status: 502 },
    );
  }
}
