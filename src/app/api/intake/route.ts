import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { fetchJobFromUrl } from "@/lib/fetch-job";
import { geminiJSON } from "@/lib/gemini";
import { extractJobMetaPrompt } from "@/lib/prompts";
import { pasteOnlySite } from "@/lib/jobsites";

// AI calls can be slow; Vercel (Fluid compute) allows up to 300s.
export const maxDuration = 120;

/**
 * Create a job from a URL and/or pasted description. Returns { id }.
 * - url only: fetch the posting (422 { error, pasteOnly } for sites that can't be read server-side).
 * - url + text: store both; the pasted text is the description and nothing is fetched.
 * - text only: store the text.
 */
export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await req.json()) as { url?: string; text?: string };
  const url = body.url?.trim() ?? "";
  let description = body.text?.trim() ?? "";
  let meta = { company: "", title: "", location: "" };

  if (url && !description) {
    const site = pasteOnlySite(url);
    if (site) {
      return NextResponse.json(
        { error: `${site} postings can't be read automatically. Paste the job description and keep the link.`, pasteOnly: site },
        { status: 422 },
      );
    }
  }

  try {
    if (url && !description) {
      const f = await fetchJobFromUrl(url);
      description = f.description;
      meta = { company: f.company, title: f.title, location: f.location };
    }
    if (!description) {
      return NextResponse.json({ error: "Paste a job description or a job link." }, { status: 400 });
    }
    if (!meta.company || !meta.title) {
      const m = await geminiJSON<typeof meta>(extractJobMetaPrompt(description)).catch(() => null);
      if (m) {
        meta = {
          company: meta.company || m.company || "",
          title: m.title || meta.title || "",
          location: meta.location || m.location || "",
        };
      }
    }
  } catch (e) {
    console.error("intake failed:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }

  const { data, error } = await supabase
    .from("jobs")
    .insert({ url, description, ...meta })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id });
}
