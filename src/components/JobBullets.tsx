"use client";

import { useMemo, useState } from "react";
import type { BankBullet, Resume } from "@/lib/types";
import { isExample, tagValue } from "@/lib/bank";
import { postApi } from "@/lib/api";
import { MockText } from "./MockText";

type Props = {
  jobId: string;
  roleLabel: string;
  bank: BankBullet[];
  onBankChange: (next: BankBullet[]) => void;
  resume: Resume;
  onInsertBullet: (itemId: string, text: string) => void;
  /** Bank ids the analysis recommended for this job. */
  recommended: string[];
};

/** Role-specific example bullets plus the user's own bank, each insertable into the tailored resume. */
export function JobBullets({ jobId, roleLabel, bank, onBankChange, resume, onInsertBullet, recommended }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  const entries = useMemo(
    () =>
      resume.sections.flatMap((s) =>
        s.items.filter((it) => it.bullets.length || it.dates).map((it) => ({ id: it.id, label: `${it.title || s.title}${it.subtitle ? ` — ${it.subtitle}` : ""}` })),
      ),
    [resume],
  );
  const examples = bank.filter((b) => isExample(b) && tagValue(b, "job") === jobId);
  const recSet = new Set(recommended);
  const q = filter.toLowerCase();
  const mine = bank
    .filter((b) => !isExample(b))
    .filter((b) => !q || b.text.toLowerCase().includes(q) || b.source.toLowerCase().includes(q))
    .sort((a, b) => Number(recSet.has(b.id)) - Number(recSet.has(a.id)));

  async function generate() {
    if (examples.length && !confirm("Replace the current examples for this role with a new set?")) return;
    setBusy(true);
    setError("");
    const { data, error } = await postApi<{ examples: BankBullet[] }>("/api/example-bullets", { jobId });
    setBusy(false);
    if (error || !data) return setError(error ?? "Couldn't generate examples.");
    onBankChange([...bank.filter((b) => !(isExample(b) && tagValue(b, "job") === jobId)), ...data.examples]);
  }

  return (
    <div className="space-y-5">
      <section className="card p-4 space-y-3">
        <div className="flex flex-wrap items-start gap-2">
          <div className="flex-1 min-w-48">
            <h2 className="font-semibold">Strong example bullets for {roleLabel || "this role"}</h2>
            <p className="text-xs text-muted">
              Written by AI from your real experience, the way a top applicant would phrase it.{" "}
              <mark className="rounded px-0.5 bg-[#fde9a8] text-[#5c4300]">Highlighted</mark> numbers are mock examples.
              Swap in your real figures before you use one.
            </p>
          </div>
          <button className="btn btn-sm btn-primary" onClick={generate} disabled={busy}>
            {busy ? "Writing examples…" : examples.length ? "Regenerate" : "Generate examples"}
          </button>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
        {examples.length === 0 && !busy && (
          <p className="text-sm text-muted">No examples yet for this role. Generating takes about 20–40 seconds.</p>
        )}
        <ul className="space-y-2">
          {examples.map((b) => (
            <BulletRow key={b.id} b={b} entries={entries} onInsert={onInsertBullet} example />
          ))}
        </ul>
      </section>

      <section className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold flex-1">Your bullets</h2>
          <input className="input py-1 text-sm w-full sm:w-56" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {mine.length === 0 ? (
          <p className="text-sm text-muted">Your bank is empty. It fills up from your uploaded resume and every suggestion you accept.</p>
        ) : (
          <ul className="space-y-2">
            {mine.map((b) => (
              <BulletRow key={b.id} b={b} entries={entries} onInsert={onInsertBullet} recommended={recSet.has(b.id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function BulletRow({
  b, entries, onInsert, example, recommended,
}: {
  b: BankBullet;
  entries: { id: string; label: string }[];
  onInsert: (itemId: string, text: string) => void;
  example?: boolean;
  recommended?: boolean;
}) {
  const preferred = tagValue(b, "entry");
  const [target, setTarget] = useState(
    entries.find((e) => e.id === preferred)?.id ?? entries.find((e) => e.label.startsWith(b.source))?.id ?? entries[0]?.id ?? "",
  );
  const [added, setAdded] = useState(false);
  const why = b.tags.find((t) => t.startsWith("why:"))?.slice(4);

  return (
    <li className={`rounded-lg border p-3 space-y-2 ${example ? "border-[#f1d98a] bg-[#fffaeb] dark:bg-[#2a2314] dark:border-[#5c4a1a]" : "border-border"}`}>
      <div className="flex items-start gap-2">
        {example ? (
          <span className="chip border-0 bg-[#fde9a8] text-[#5c4300] shrink-0">Example</span>
        ) : recommended ? (
          <span className="chip border-0 bg-good-bg text-good shrink-0">Fits this job</span>
        ) : null}
        <p className="text-sm flex-1">
          <MockText text={b.text} />
        </p>
      </div>
      {(why || b.source) && (
        <p className="text-xs text-muted">
          {b.source}
          {why ? ` · ${why}` : ""}
        </p>
      )}
      <div className="flex gap-1.5">
        <select className="input py-1 text-xs flex-1 min-w-0" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Add to entry">
          {entries.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </select>
        <button
          className="btn btn-sm"
          disabled={!target}
          onClick={() => {
            onInsert(target, b.text);
            setAdded(true);
            setTimeout(() => setAdded(false), 1800);
          }}
        >
          {added ? "Added ✓" : "Add to resume"}
        </button>
      </div>
    </li>
  );
}
