import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { dbErrorMessage } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Download everything the signed-in user has as one JSON file:
 * { exported_at, resumes, jobs, legacy_bullets }. RLS scopes every query to the user.
 */
export async function GET() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [resumes, jobs, bullets] = await Promise.all([
    supabase.from("resumes").select("*").order("created_at"),
    supabase.from("jobs").select("*").order("created_at"),
    // The old bullet bank table may be gone or unreadable; it's optional.
    Promise.resolve(supabase.from("bullets").select("*").order("created_at")).catch(() => ({ data: null, error: null })),
  ]);
  const failed = resumes.error ?? jobs.error;
  if (failed) {
    // The raw database message goes to the server log, never to the page.
    console.error("export: loading failed:", failed);
    return NextResponse.json({ error: dbErrorMessage(failed, "load") }, { status: 500 });
  }

  const now = new Date();
  const body = {
    exported_at: now.toISOString(),
    resumes: resumes.data ?? [],
    jobs: jobs.data ?? [],
    legacy_bullets: bullets.error ? [] : (bullets.data ?? []),
  };
  const filename = `job-pipeline-export-${now.toISOString().slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
