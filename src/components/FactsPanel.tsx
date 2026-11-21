"use client";

import { useState } from "react";
import type { Fact } from "@/lib/types";
import { FACT_SOURCE_LABEL } from "@/lib/facts";
import { FACTS_MIGRATION_HINT } from "@/lib/factStore";
import type { FactsStatus } from "@/lib/useFacts";

/**
 * The student's facts: true things the AI uses so it doesn't ask again (numbers, tools, side projects,
 * answers, bullets from their resume). Never printed. Every fact can be edited or deleted; each shows
 * where it came from. A fact with a [placeholder] is a draft the AI doesn't see until it's filled.
 * `id="facts"` is the toolbar's jump target on phones.
 */
export function FactsPanel({
  facts, status, error, onAdd, onEdit, onDelete,
}: {
  facts: Fact[];
  status: FactsStatus;
  error?: string;
  /** Add new facts, one per line (the store de-duplicates). */
  onAdd: (lines: string[]) => Promise<unknown> | void;
  onEdit: (id: string, text: string) => Promise<unknown> | void;
  onDelete: (fact: Fact) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = [...facts].reverse(); // newest first

  const add = async () => {
    const lines = draft.split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
    if (!lines.length) return;
    setBusy(true);
    await onAdd(lines);
    setBusy(false);
    setDraft("");
  };

  const saveEdit = async () => {
    if (!editing) return;
    const e = editing;
    setEditing(null);
    await onEdit(e.id, e.text);
  };

  return (
    <section id="facts" className="space-y-3 scroll-mt-16" aria-label="Facts">
      <p className="text-[13px] text-muted">True things about you the AI uses. Never printed.</p>

      {status === "missing" && <p role="status" className="text-[13px]">{FACTS_MIGRATION_HINT}</p>}
      {error && status !== "missing" && <p role="alert" className="text-[13px] text-bad">{error}</p>}

      {shown.length > 0 && (
        <ul className="divide-y divide-border border-y border-border">
          {shown.map((f) =>
            editing?.id === f.id ? (
              <li key={f.id} className="py-2 space-y-2">
                <label htmlFor={`fact-edit-${f.id}`} className="sr-only">Edit fact</label>
                <textarea
                  id={`fact-edit-${f.id}`}
                  className="input w-full min-h-20"
                  value={editing.text}
                  autoFocus
                  onChange={(e) => setEditing({ id: f.id, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void saveEdit();
                    } else if (e.key === "Escape") setEditing(null);
                  }}
                />
                {f.bullet_id && <p className="text-xs text-muted">This fact follows a bullet. Editing it here unlinks it from the bullet.</p>}
                <div className="flex gap-2">
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[13px] font-medium text-fg hover:bg-surface-2 disabled:opacity-50" onClick={() => void saveEdit()}>Save</button>
                  <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </li>
            ) : (
              <li key={f.id} className="py-2 flex items-start gap-2">
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-[13px] break-words">{f.text}</p>
                  <p className="flex flex-wrap gap-1">
                    <span className="chip text-[11px] text-muted">{FACT_SOURCE_LABEL[f.source]}</span>
                    {f.bullet_id && <span className="chip text-[11px] text-muted" title="Updates when you edit that bullet">Follows a bullet</span>}
                    {!f.active && (
                      <span className="chip text-[11px] border-border text-fg" title="Fill the [placeholder] so the AI can use it">
                        Draft: fill the [placeholder]
                      </span>
                    )}
                  </p>
                </div>
                <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50 shrink-0" onClick={() => setEditing({ id: f.id, text: f.text })} aria-label={`Edit fact: ${f.text}`}>
                  Edit
                </button>
                <button type="button" className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50 shrink-0 text-bad" onClick={() => onDelete(f)} aria-label={`Delete fact: ${f.text}`}>
                  Delete
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      {status !== "missing" && (
        <div className="space-y-2">
          <textarea
            id="fact-new"
            aria-label="Add facts"
            className="input w-full min-h-20"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void add();
            }}
            placeholder={"e.g. Automated a weekly Excel report with Python, saving ~4 hrs/week\nOne fact per line"}
          />
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[13px] font-medium text-fg hover:bg-surface-2 disabled:opacity-50" onClick={() => void add()} disabled={!draft.trim() || busy}>
            {busy ? "Adding…" : `Add fact${draft.trim().includes("\n") ? "s" : ""}`}
          </button>
        </div>
      )}
    </section>
  );
}
