"use client";

import { useState } from "react";

/**
 * Facts on the master resume: true things that don't fit on the page. Shown beside the document on
 * desktop and below it on phones (`id="facts"` is the toolbar's jump target); never printed, fed to
 * the AI when tailoring. The parent owns the list (undo + autosave).
 */
export function FactsPanel({
  facts, onChange, onAdd,
}: {
  facts: string[];
  /** Replace the whole list (edit/delete). */
  onChange: (next: string[]) => void;
  /** Append new facts (the parent de-duplicates). */
  onAdd: (lines: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ i: number; text: string } | null>(null);

  const add = () => {
    const lines = draft.split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean);
    if (!lines.length) return;
    onAdd(lines);
    setDraft("");
  };

  const saveEdit = () => {
    if (!editing) return;
    const text = editing.text.trim();
    onChange(text ? facts.map((f, i) => (i === editing.i ? text : f)) : facts.filter((_, i) => i !== editing.i));
    setEditing(null);
  };

  return (
    <section id="facts" className="card p-4 sm:p-5 space-y-3 scroll-mt-16" aria-labelledby="facts-heading">
      <div>
        <h2 id="facts-heading" className="font-semibold">
          Facts <span className="text-sm font-normal text-muted">· {facts.length}</span>
        </h2>
        <p className="text-sm text-muted">
          True things that don&apos;t fit on the page — numbers, tools, side projects. The AI uses them when tailoring;
          they&apos;re never printed.
        </p>
      </div>

      {facts.length > 0 && (
        <ul className="divide-y divide-border border-y border-border">
          {facts.map((f, i) =>
            editing?.i === i ? (
              <li key={i} className="py-2 space-y-2">
                <textarea
                  className="input w-full min-h-20"
                  value={editing.text}
                  autoFocus
                  onChange={(e) => setEditing({ i, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      saveEdit();
                    } else if (e.key === "Escape") setEditing(null);
                  }}
                />
                <div className="flex gap-2">
                  <button className="btn btn-sm btn-primary" onClick={saveEdit}>Save</button>
                  <button className="btn btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </li>
            ) : (
              <li key={i} className="py-2 flex items-start gap-2">
                <span className="flex-1 min-w-0 text-sm break-words">{f}</span>
                <button className="btn btn-sm shrink-0" onClick={() => setEditing({ i, text: f })} aria-label={`Edit fact ${i + 1}`}>
                  Edit
                </button>
                <button
                  className="btn btn-sm shrink-0 text-bad"
                  onClick={() => onChange(facts.filter((_, j) => j !== i))}
                  aria-label={`Delete fact ${i + 1}`}
                >
                  Delete
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      <div className="space-y-2">
        <textarea
          className="input w-full min-h-20"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
          }}
          placeholder={"e.g. Automated a weekly Excel report with Python, saving ~4 hrs/week\nOne fact per line"}
        />
        <button className="btn btn-sm btn-primary" onClick={add} disabled={!draft.trim()}>
          Add fact{draft.trim().includes("\n") ? "s" : ""}
        </button>
      </div>
    </section>
  );
}
