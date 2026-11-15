import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { usageSummary } from "@/lib/aiBudget";
import { friendlyError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * The signed-in student's AI usage: `{ available: true, heavy, light }` with used / limit / remaining /
 * resetAt per rolling window, or `{ available: false }` before migration 0004 is run.
 */
export async function GET() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    return NextResponse.json(await usageSummary(supabase), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("usage: loading failed:", e);
    return NextResponse.json({ error: friendlyError(e, "Couldn't load your AI usage.") }, { status: 503 });
  }
}
