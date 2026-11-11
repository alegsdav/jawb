"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BankBullet } from "@/lib/types";

export default function BankPage() {
  const supabase = createClient();
  const [items, setItems] = useState<BankBullet[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({ source: "", text: "", tags: "" });
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("bullets").select("*").order("created_at", { ascending: false }).then(({ data, error }) => {
      if (error) setError(error.message);
      setItems((data as BankBullet[]) ?? []);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parseTags = (s: string) => s.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.text.trim()) return;
    const { data, error } = await supabase
      .from("bullets")
      .insert({ source: draft.source.trim(), text: draft.text.trim(), tags: parseTags(draft.tags) })
      .select()
      .single();
    if (error) return setError(error.message);
    setItems([data as BankBullet, ...items]);
    setDraft({ source: draft.source, text: "", tags: "" });
  }

  async function update(id: string, patch: Partial<BankBullet>) {
    setItems(items.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    const { error } = await supabase.from("bullets").update(patch).eq("id", id);
    if (error) setError(error.message);
  }

  async function remove(id: string) {
    if (!confirm("Delete this entry?")) return;
    setItems(items.filter((b) => b.id !== id));
    await supabase.from("bullets").delete().eq("id", id);
  }

  const groups = useMemo(() => {
    const q = filter.toLowerCase();
    const shown = items.filter(
      (b) => !q || b.text.toLowerCase().includes(q) || b.source.toLowerCase().includes(q) || b.tags.some((t) => t.includes(q)),
    );
    const map = new Map<string, BankBullet[]>();
    for (const b of shown) map.set(b.source || "Unsorted", [...(map.get(b.source || "Unsorted") ?? []), b]);
    return [...map.entries()];
  }, [items, filter]);

  const sources = [...new Set(items.map((b) => b.source).filter(Boolean))];

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Bullet bank</h1>
        <p className="text-sm text-muted">
          Every bullet, fact and number you might use. The analyzer reads this and suggests which ones to add for each job.
          Raw facts are fine, e.g. &quot;sanitizer handles ~2,000 files/season&quot;.
        </p>
      </div>

      <form onSubmit={add} className="card p-4 space-y-2">
        <div className="grid sm:grid-cols-2 gap-2">
          <input
            className="input"
            list="sources"
            placeholder="Source (e.g. Ellis Chi, CPA)"
            value={draft.source}
            onChange={(e) => setDraft({ ...draft, source: e.target.value })}
          />
          <datalist id="sources">{sources.map((s) => <option key={s} value={s} />)}</datalist>
          <input
            className="input"
            placeholder="Tags, comma separated (python, ai, backend)"
            value={draft.tags}
            onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
          />
        </div>
        <textarea
          className="input w-full h-20"
          placeholder="Bullet or fact"
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
        <button className="btn btn-primary btn-sm" disabled={!draft.text.trim()}>Add to bank</button>
      </form>

      {error && <p className="text-sm text-bad">{error}</p>}
      <input className="input w-full" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />

      {loading ? (
        <p className="text-muted text-sm">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-muted text-sm">Nothing here yet.</p>
      ) : (
        groups.map(([source, list]) => (
          <section key={source} className="space-y-2">
            <h2 className="label">{source}</h2>
            {list.map((b) => (
              <div key={b.id} className="card p-3 space-y-2">
                <textarea
                  className="ghost-input w-full text-sm"
                  defaultValue={b.text}
                  onBlur={(e) => e.target.value !== b.text && update(b.id, { text: e.target.value })}
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    className="ghost-input text-xs text-muted flex-1 min-w-40"
                    defaultValue={b.tags.join(", ")}
                    placeholder="tags"
                    onBlur={(e) => update(b.id, { tags: parseTags(e.target.value) })}
                  />
                  <button className="text-xs text-muted hover:text-bad" onClick={() => remove(b.id)}>Delete</button>
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
