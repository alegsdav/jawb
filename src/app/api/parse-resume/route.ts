import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geminiJSON } from "@/lib/gemini";
import { parseResumePrompt } from "@/lib/prompts";
import { normalizeResume } from "@/lib/resume";

export const maxDuration = 60;

const MAX_PDF_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at ~4.5 MB

/** Accepts JSON {text} or multipart form-data with a "file" (PDF or .txt). Returns {resume}. */
export async function POST(req: Request) {
  const { user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let text: string | null = null;
  let pdf: string | null = null;

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    if (file.size > MAX_PDF_BYTES) return NextResponse.json({ error: "File is over 4 MB." }, { status: 413 });
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      pdf = Buffer.from(await file.arrayBuffer()).toString("base64");
    } else if (file.type.startsWith("text/") || /\.(txt|md)$/i.test(file.name)) {
      text = await file.text();
    } else {
      return NextResponse.json(
        { error: "Upload a PDF or text file. For Word/Google Docs, use File → Download → PDF first." },
        { status: 415 },
      );
    }
  } else {
    text = ((await req.json()) as { text?: string }).text ?? "";
    if (!text.trim()) return NextResponse.json({ error: "Paste your resume text." }, { status: 400 });
  }

  try {
    const parsed = await geminiJSON<unknown>(parseResumePrompt(pdf ? null : text), {
      temperature: 0,
      files: pdf ? [{ mimeType: "application/pdf", data: pdf }] : undefined,
    });
    const resume = normalizeResume(parsed);
    if (!resume.sections.length) {
      return NextResponse.json({ error: "Couldn't find any resume sections in that file." }, { status: 422 });
    }
    return NextResponse.json({ resume });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
