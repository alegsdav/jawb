import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { emptyResume, withDoc } from "@/lib/resume";
import { flattenDoc } from "@/lib/doc/model";
import type { DocJSON } from "@/lib/doc/types";
import type { Resume } from "@/lib/types";
import { friendlyError } from "@/lib/api";
import { NoTextError, pdfToDoc } from "@/lib/import/pdfToDoc";
import { textToDoc } from "@/lib/import/textToDoc";

const MAX_FILE_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at ~4.5 MB

const hasText = (doc: DocJSON) => flattenDoc(doc).some((p) => p.text.trim());

/**
 * Accepts JSON {text} or multipart form-data with a "file" (PDF or .txt/.md). Returns {resume}: a version 4 resume
 * whose document is the import as it is. Nothing is rewritten: a PDF keeps its fonts, sizes, lines and margins.
 */
export async function POST(req: Request) {
  const { user } = await requireUser();
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
    } else {
      return NextResponse.json(
        { error: "Upload a PDF or text file. For Word/Google Docs, use File → Download → PDF first." },
        { status: 415 },
      );
    }
  } else {
    text = (((await req.json().catch(() => ({}))) ?? {}) as { text?: string }).text ?? "";
    if (!text.trim()) return NextResponse.json({ error: "Paste your resume text." }, { status: 400 });
  }

  try {
    if (pdf) {
      const { doc, page } = await pdfToDoc(pdf);
      return resumeResponse(withDoc({ ...emptyResume(), page }, doc), doc);
    }
    const doc = textToDoc(text ?? "");
    return resumeResponse(withDoc(emptyResume(), doc), doc);
  } catch (e) {
    if (e instanceof NoTextError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("parse-resume failed:", e);
    return NextResponse.json(
      { error: friendlyError(e, "Couldn't read that file. Export it again as a text PDF, or paste the text.") },
      { status: 422 },
    );
  }
}

function resumeResponse(resume: Resume, doc: DocJSON) {
  if (!hasText(doc)) return NextResponse.json({ error: "Couldn't find any text in that file." }, { status: 422 });
  return NextResponse.json({ resume });
}
