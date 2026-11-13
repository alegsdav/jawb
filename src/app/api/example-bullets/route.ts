import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { geminiJSON } from "@/lib/gemini";
import { exampleBulletsPrompt } from "@/lib/prompts";
import { normalizeResume, resumeToPromptText } from "@/lib/resume";
import { isExample } from "@/lib/bank";

// AI calls can be slow; Vercel (Fluid compute) allows up to 300s.
export const maxDuration = 120;

type Raw = { examples?: { entry_id?: string; text?: string; why?: string }[] };

/** Generate role-specific example bullets for a job and store them in the bank (replacing earlier ones for that job). */
export async function POST(req: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { jobId } = (await req.json()) as { jobId: string };

  const [{ data: job }, { data: tailored }, { data: master }, { data: bank }] = await Promise.all([
    supabase.from("jobs").select("id, title, company, location, description").eq("id", jobId).single(),
    supabase.from("resumes").select("content").eq("job_id", jobId).maybeSingle(),
    supabase.from("resumes").select("content").eq("is_master", true).maybeSingle(),
    supabase.from("bullets").select("source, text, tags"),
  ]);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const resume = normalizeResume((tailored ?? master)?.content);
  const entries = resume.sections.flatMap((s) =>
    s.items
      .filter((it) => it.bullets.length || it.dates)
      .map((it) => `[entry:${it.id}] ${it.title}${it.subtitle ? ` — ${it.subtitle}` : ""} (${s.title})`),
  );
  if (!entries.length) {
    return NextResponse.json({ error: "Add your experience to the master resume first." }, { status: 400 });
  }
  const entryIds = new Set(resume.sections.flatMap((s) => s.items.map((it) => it.id)));
  const titleOf = new Map(resume.sections.flatMap((s) => s.items.map((it) => [it.id, it.title || s.title] as const)));

  try {
    const raw = await geminiJSON<Raw>(
      exampleBulletsPrompt({
        job: `${job.title} at ${job.company} (${job.location})\n\n${job.description}`,
        entries: entries.join("\n"),
        resume: resumeToPromptText(resume),
        mine: (bank ?? []).filter((b) => !isExample(b)).map((b) => `(${b.source}) ${b.text}`).join("\n"),
      }),
      { temperature: 0.6 },
    );
    const rows = (Array.isArray(raw.examples) ? raw.examples : [])
      .map((e) => {
        const entry = String(e?.entry_id ?? "").replace(/^entry:/, "");
        const valid = entryIds.has(entry);
        return {
          source: valid ? titleOf.get(entry)! : "General",
          text: String(e?.text ?? "").trim(),
          tags: ["example", `job:${jobId}`, ...(valid ? [`entry:${entry}`] : []), ...(e?.why ? [`why:${String(e.why).slice(0, 140)}`] : [])],
        };
      })
      .filter((r) => r.text);
    if (!rows.length) return NextResponse.json({ error: "The AI didn't return any examples. Try again." }, { status: 502 });

    await supabase.from("bullets").delete().contains("tags", ["example", `job:${jobId}`]);
    const { data, error } = await supabase.from("bullets").insert(rows).select();
    if (error) throw error;
    return NextResponse.json({ examples: data });
  } catch (e) {
    console.error("example-bullets failed:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
