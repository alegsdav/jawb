import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { jobLabel } from "@/lib/jobLabel";

/**
 * The job's browser tab title, set on the server so the first paint already has it (a client effect alone runs after
 * the root's "Jawb" title is applied and can lose). The page still updates the title on its own when the name changes.
 * RLS limits the row to the signed-in user; a missing or unreadable job falls back to a plain title.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("jobs").select("title, company").eq("id", id).maybeSingle();
    if (data) {
      return { title: `${jobLabel({ company: String(data.company ?? ""), title: String(data.title ?? "") })} · Jawb` };
    }
  } catch {
    /* fall through to the plain title */
  }
  return { title: "Job · Jawb" };
}

export default function JobLayout({ children }: { children: React.ReactNode }) {
  return children;
}
