"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BankBullet } from "@/lib/types";
import { addToBank, bulletsFromResume, hasMock, isExample, tagValue } from "@/lib/bank";
import { normalizeResume } from "@/lib/resume";
import { MockText } from "@/components/MockText";

type JobLite = { id: string; title: string; company: string };

const ORIGIN: Record<string, string> = { "from-resume": "From resume", accepted: "Accepted suggestion", "from-question": "Your answer" };

export default function BankPage() {
  const supabase = createClient();
  const [items, setItems] = useState<BankBullet[]>([]);
  const [jobs, setJobs] = useState<JobLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"mine" | "examples">("mine");
  const [draft, setDraft] = useState({ source: "", text: "" });
  const [filter, setFilter] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      supabase.from("bullets").select("*").order("created_at", { ascending: false }),
      supabase.from("jobs").select("id, title, company"),
    ]).then(([b, j]) => {
      if (b.error) setError(b.error.message);
      setItems((b.data as BankBullet[]) ?? []);
      setJobs((j.data as JobLite[]) ?? []);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mine = items.filter((b) => !isExample(b));
  const examples = items.filter(isExample);

  async function syncFromMaster() {
    setNote("");
    const { data } = await supabase.from("resumes").select("content").eq("is_master", true).maybeSingle();
    if (!data) return setNote("No master resume yet. Upload one on the Master resume page.");
    try {
      const added = await addToBank(supabase, bulletsFromResume(normalizeResume(data.content)));
      setItems((cur) => [...added, ...cur]);
      setNote(added.length ? `Added ${added.length} bullet${added.length > 1 ? "s" : ""} from your master resume.` : "Every bullet in your master is already in the bank.");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.text.trim()) return;
    const { data, error } = await supabase
      .from("bullets")
      .insert({ source: draft.source.trim(), text: draft.text.trim(), tags: [] })
      .select()
      .single();
    if (error) return setError(error.message);
    setItems([data as BankBullet, ...items]);
    setDraft({ source: draft.source, text: "" });
  }

  async function update(id: string, patch: Partial<BankBullet>) {
    setItems((cur) => cur.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    const { error } = await supabase.from("bullets").update(patch).eq("id", id);
    if (error) setError(error.message);
  }

  async function remove(id: string, ask = true) {
    if (ask && !confirm("Delete this bullet?")) return;
    setItems((cur) => cur.filter((b) => b.id !== id));
    await supabase.from("bullets").delete().eq("id", id);
  }

  async function copyToMine(b: BankBullet) {
    const { data, error } = await supabase
      .from("bullets")
      .insert({ source: b.source, text: b.text, tags: ["from-example"] })
      .select()
      .single();
    if (error) return setError(error.message);
    setItems((cur) => [data as BankBullet, ...cur]);
    setNote("Copied to your bullets. Replace the highlighted example numbers with real ones.");
  }

  const q = filter.toLowerCase();
  const match = (b: BankBullet) => !q || b.text.toLowerCase().includes(q) || b.source.toLowerCase().includes(q);

  const mineGroups = useMemo(() => {
    const map = new Map<string, BankBullet[]>();
    for (const b of mine.filter(match)) map.set(b.source || "Unsorted", [...(map.get(b.source || "Unsorted") ?? []), b]);
    return [...map.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, filter]);

  const exampleGroups = useMemo(() => {
    const map = new Map<string, BankBullet[]>();
    for (const b of examples.filter(match)) {
      const jid = tagValue(b, "job") ?? "";
      map.set(jid, [...(map.get(jid) ?? []), b]);
    }
    return [...map.entries()].map(([jid, list]) => ({ job: jobs.find((j) => j.id === jid), jid, list }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, jobs, filter]);

  const sources = [...new Set(mine.map((b) => b.source).filter(Boolean))];

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-60">
          <h1 className="text-xl font-semibold">Bullet bank</h1>
          <p className="text-sm text-muted">
            Fills itself from your uploaded resume and every suggestion you accept. Accepted edits are added as new
            bullets; nothing here is overwritten. Role-specific examples are generated from each job&apos;s Bullets tab.
          </p>
        </div>
        <button className="btn btn-sm" onClick={syncFromMaster}>Add bullets from master</button>
      </div>

      {note && <p className="text-sm text-good">{note}</p>}
      {error && <p className="text-sm text-bad">{error}</p>}

      <div className="flex gap-1 border-b border-border">
        {(
          [
            ["mine", `Your bullets (${mine.length})`],
            ["examples", `Role examples (${examples.length})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === key ? "border-accent font-medium" : "border-transparent text-muted hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <input className="input w-full" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />

      {loading ? (
        <p className="text-muted text-sm">Loading…</p>
      ) : tab === "mine" ? (
        <>
          <form onSubmit={add} className="card p-4 space-y-2">
            <input
              className="input w-full"
              list="sources"
              placeholder="Where it's from (e.g. Ellis Chi, CPA)"
              value={draft.source}
              onChange={(e) => setDraft({ ...draft, source: e.target.value })}
            />
            <datalist id="sources">{sources.map((s) => <option key={s} value={s} />)}</datalist>
            <textarea
              className="input w-full h-20"
              placeholder="A bullet or a raw fact, e.g. &quot;sanitizer handles ~2,000 files per season&quot;"
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
            <button className="btn btn-primary btn-sm" disabled={!draft.text.trim()}>Add bullet</button>
          </form>

          {mineGroups.length === 0 ? (
            <p className="text-muted text-sm">
              Nothing here yet. Click &quot;Add bullets from master&quot; or upload your resume on the Master resume page.
            </p>
          ) : (
            mineGroups.map(([source, list]) => (
              <section key={source} className="space-y-2">
                <h2 className="label">{source}</h2>
                {list.map((b) => {
                  const origin = b.tags.map((t) => ORIGIN[t]).find(Boolean);
                  return (
                    <div key={b.id} className="card p-3 space-y-1.5">
                      <textarea
                        className="ghost-input w-full text-sm"
                        defaultValue={b.text}
                        onBlur={(e) => e.target.value !== b.text && update(b.id, { text: e.target.value })}
                      />
                      <div className="flex items-center gap-2 flex-wrap text-xs text-muted">
                        {origin && <span className="chip">{origin}</span>}
                        {hasMock(b.text) && (
                          <span className="chip border-0 bg-[#fde9a8] text-[#5c4300]">Has example numbers</span>
                        )}
                        <span>{new Date(b.created_at).toLocaleDateString()}</span>
                        <button className="ml-auto hover:text-bad" onClick={() => remove(b.id)}>Delete</button>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))
          )}
        </>
      ) : exampleGroups.length === 0 ? (
        <p className="text-muted text-sm">
          No role examples yet. Open a job from the Tracker and use its <strong>Bullets</strong> tab to generate strong
          example bullets for that role.
        </p>
      ) : (
        exampleGroups.map(({ job, jid, list }) => (
          <section key={jid} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h2 className="label flex-1">{job ? `${job.title || "Untitled role"} · ${job.company}` : "Deleted job"}</h2>
              {job && <Link href={`/jobs/${job.id}`} className="text-xs text-accent hover:underline">Open job →</Link>}
            </div>
            {list.map((b) => (
              <div key={b.id} className="rounded-xl border border-[#f1d98a] bg-[#fffaeb] dark:bg-[#2a2314] dark:border-[#5c4a1a] p-3 space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="chip border-0 bg-[#fde9a8] text-[#5c4300] shrink-0">Example</span>
                  <p className="text-sm flex-1"><MockText text={b.text} /></p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
                  <span>{b.source}</span>
                  <button className="ml-auto hover:text-fg" onClick={() => copyToMine(b)}>Copy to my bullets</button>
                  <button className="hover:text-bad" onClick={() => remove(b.id, false)}>Delete</button>
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
