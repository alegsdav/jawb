import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resume } from "./types";
import { loadFacts } from "./factStore";
import { factsForPrompt, relevantFacts } from "./facts";
import { formatFacts, type CoachContext } from "./prompts";
import { entryLine, type CoachRequest } from "./coaching";

/**
 * Everything a coaching prompt needs, read on the server: the student's relevant active facts (linked
 * to this entry or its bullets first, then recent ones, capped; none that repeat a bullet) and, on a job
 * tab, the posting (read from the job row, not from the page). `sources` are the only texts numbers
 * may come from in an example: the bullet(s) and those facts.
 */
export async function coachContext(
  supabase: SupabaseClient,
  r: CoachRequest,
): Promise<{ context: CoachContext; sources: string[]; facts: string[] } | { error: string; status: number }> {
  const [loaded, job] = await Promise.all([
    loadFacts(supabase),
    r.jobId
      ? supabase.from("jobs").select("title, company, location, description").eq("id", r.jobId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (loaded.error) console.warn("coach: facts didn't load; coaching without them:", loaded.error);
  if (job.error) return { error: "Couldn't load this job. Try again.", status: 503 };
  if (r.jobId && !job.data) return { error: "This job no longer exists. It may have been deleted.", status: 404 };

  const page: Resume = {
    version: 2,
    header: { name: "", contact: "" },
    sections: [{ id: "s", title: "", items: [{ id: r.entryId, title: "", subtitle: "", location: "", dates: "", bullets: r.bullets }] }],
  };
  const facts = relevantFacts(factsForPrompt(loaded.facts, page), { id: r.entryId, bulletIds: r.bullets.map((b) => b.id) }).map((f) => f.text);
  const bullet = r.bullets.find((b) => b.id === r.bulletId)?.text ?? "";
  const j = job.data as { title?: string; company?: string; location?: string; description?: string } | null;
  return {
    context: {
      entry: entryLine(r.entry),
      bullets: r.bullets.map((b) => b.text),
      bullet,
      facts: formatFacts(facts),
      job: j ? `${j.title ?? ""} at ${j.company ?? ""} (${j.location ?? ""})\n\n${j.description ?? ""}` : "",
    },
    sources: [...(bullet ? [bullet] : r.bullets.map((b) => b.text)), ...facts],
    facts,
  };
}
