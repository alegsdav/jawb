import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import {
  CLOSED_MESSAGE,
  cleanCompany,
  cleanField,
  fetchJobFromUrl,
  JobClosedError,
  JobFetchError,
  LISTING_MESSAGE,
  parseJobUrl,
} from "@/lib/fetch-job";
import { geminiJSON } from "@/lib/gemini";
import { checkJobPagePrompt, extractJobMetaPrompt } from "@/lib/prompts";
import { pasteOnlySite } from "@/lib/jobsites";
import { dbErrorMessage } from "@/lib/db";
import { findDuplicateJob } from "@/lib/status";
import { withAiBudget } from "@/lib/aiBudget";

// AI calls can be slow; Vercel (Fluid compute) allows up to 300s.
export const maxDuration = 120;

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status });

/** The AI's answer to checkJobPagePrompt. Every field is optional: a partial answer still counts. */
type JobPageCheck = { status?: string; company?: string; title?: string; location?: string };

/**
 * Create a job from a URL and/or pasted description. Returns { id }.
 * - url only: fetch the posting (422 { error, pasteOnly } for sites that can't be read server-side).
 * - url + text: store both; the pasted text is the description and nothing is fetched.
 * - text only: store the text.
 * Before inserting, a job with the same link (no query/hash/trailing slash) or the same company and
 * title is a duplicate: 409 { error, duplicate: { id, created_at } }, nothing is added. Send
 * `force: true` to add it anyway.
 * The stored link is always a valid http(s) URL. Every error is a plain sentence.
 */
export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return bad("You're signed out. Reload the page and sign in again.", 401);

  let body: { url?: unknown; text?: unknown; force?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return bad("Paste a job description or a job link.");
  }
  const force = body?.force === true;
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

  // Duplicates: the user's jobs (RLS scopes this). A failed lookup never blocks adding.
  type Existing = { id: string; url: string; company: string; title: string; created_at: string };
  let existing: Existing[] = [];
  if (!force) {
    const { data, error } = await supabase.from("jobs").select("id, url, company, title, created_at");
    if (error) console.warn("intake: duplicate check skipped:", error.message);
    existing = (data ?? []) as Existing[];
  }
  const duplicate = (candidate: { url?: string; company?: string; title?: string }) => {
    const dup = findDuplicateJob(existing, candidate);
    return dup
      ? bad("You already added this job.", 409, { duplicate: { id: dup.id, created_at: dup.created_at } })
      : null;
  };
  // Same link: say so before fetching the page again.
  const sameLink = url ? duplicate({ url }) : null;
  if (sameLink) return sameLink;

  try {
    // Set when the AI page check ran; it replaces the meta call below for these links.
    let checked = false;
    if (url && !description) {
      const f = await fetchJobFromUrl(url);
      description = f.description;
      meta = { company: f.company, title: f.title, location: f.location };
      // Scraped or schema.org pages may be closed or be a list of openings. One light AI read decides that
      // and fills gaps. Over the limit or failing, the job is still added with the fetched fields.
      if (f.source === "jsonld" || f.source === "page") {
        checked = true;
        const check = await withAiBudget(supabase, { action: "intake_meta" }, (meter) =>
          geminiJSON<JobPageCheck>(checkJobPagePrompt(description, f.title), { onUsage: meter.add }),
        ).catch(() => null);
        if (check?.status === "closed") return bad(CLOSED_MESSAGE, 410, { closed: true });
        if (check?.status === "not_a_posting") return bad(LISTING_MESSAGE, 410, { closed: true });
        if (check) {
          const ai = {
            company: cleanCompany(check.company ?? ""),
            title: cleanField(check.title ?? ""),
            location: cleanField(check.location ?? ""),
          };
          // A scraped page's "title" is its browser-tab title ("Software Engineer | Acme Careers"): the AI's reading of
          // the posting wins there. Schema.org fields are the site's own, so they win and the AI only fills gaps.
          meta =
            f.source === "page"
              ? { company: ai.company || meta.company, title: ai.title || meta.title, location: ai.location || meta.location }
              : { company: meta.company || ai.company, title: meta.title || ai.title, location: meta.location || ai.location };
        }
      }
    }
    if (!description) return bad("Paste a job description or a job link.");
    if (!checked && (!meta.company || !meta.title)) {
      // Light AI call. Over the limit (or any failure), the job is still added; the user fills in the details.
      const m = await withAiBudget(supabase, { action: "intake_meta" }, (meter) =>
        geminiJSON<typeof meta>(extractJobMetaPrompt(description), { onUsage: meter.add }),
      ).catch(() => null);
      if (m) {
        meta = {
          company: meta.company || m.company || "",
          title: m.title || meta.title || "",
          location: meta.location || m.location || "",
        };
      }
    }
  } catch (e) {
    if (e instanceof JobClosedError) return bad(e.message, 410, { closed: true });
    console.error("intake failed:", e);
    const message =
      e instanceof JobFetchError ? e.message : "Couldn't read that page. Paste the job description and keep the link.";
    return bad(message, 422);
  }

  const sameRole = duplicate({ company: meta.company, title: meta.title });
  if (sameRole) return sameRole;

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
