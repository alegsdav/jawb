import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { fetchJobFromUrl, JobFetchError, parseJobUrl } from "@/lib/fetch-job";
import { geminiJSON } from "@/lib/gemini";
import { extractJobMetaPrompt } from "@/lib/prompts";
import { pasteOnlySite } from "@/lib/jobsites";
import { dbErrorMessage } from "@/lib/db";

// AI calls can be slow; Vercel (Fluid compute) allows up to 300s.
export const maxDuration = 120;

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

/**
 * Create a job from a URL and/or pasted description. Returns { id }.
 * - url only: fetch the posting (422 { error, pasteOnly } for sites that can't be read server-side).
 * - url + text: store both; the pasted text is the description and nothing is fetched.
 * - text only: store the text.
 * The stored link is always a valid http(s) URL. Every error is a plain sentence.
 */
export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return bad("You're signed out. Reload the page and sign in again.", 401);

  let body: { url?: unknown; text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return bad("Paste a job description or a job link.");
  }
  const rawUrl = typeof body?.url === "string" ? body.url.trim() : "";
  let description = typeof body?.text === "string" ? body.text.trim() : "";
  let meta = { company: "", title: "", location: "" };

  let url = "";
  if (rawUrl) {
    try {
      url = parseJobUrl(rawUrl).href;
    } catch (e) {
      return bad(e instanceof JobFetchError ? e.message : "That doesn't look like a link.");
    }
  }

  if (url && !description) {
    const site = pasteOnlySite(url);
    if (site) {
      return bad(`${site} postings can't be read automatically. Paste the job description and keep the link.`, 422, {
        pasteOnly: site,
      });
    }
  }

  try {
    if (url && !description) {
      const f = await fetchJobFromUrl(url);
      description = f.description;
      meta = { company: f.company, title: f.title, location: f.location };
    }
    if (!description) return bad("Paste a job description or a job link.");
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
    const message =
      e instanceof JobFetchError ? e.message : "Couldn't read that page. Paste the job description and keep the link.";
    return bad(message, 422);
  }

  const { data, error } = await supabase
    .from("jobs")
    .insert({ url, description, ...meta })
    .select("id")
    .single();
  if (error) {
    console.error("intake insert failed:", error);
    return bad(dbErrorMessage(error, "save"), 500);
  }
  return NextResponse.json({ id: data.id });
}
