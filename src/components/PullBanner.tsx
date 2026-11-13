"use client";

import { plural } from "@/lib/facts";

import { useEffect, useRef, useState } from "react";
import { hasPullChanges, type PullAddition, type PullPlan, type PullRemoval } from "@/lib/tailor";
import type { MergeConflict } from "@/lib/master";
import type { MasterRemoval, SaveAsMasterPlan } from "@/lib/jobSync";


function additionText(a: PullAddition) {
  if (a.kind === "section") return { what: "New section", text: a.label, detail: a.items ? plural(a.items, "entry", "entries") : "" };
  if (a.kind === "item") return { what: `New entry in ${a.where}`, text: a.label, detail: a.bullets ? plural(a.bullets, "bullet") : "" };
  return { what: `New bullet in ${a.where}`, text: a.text, detail: "" };
}

const KIND: Record<PullRemoval["kind"], string> = { bullet: "Bullet", item: "Entry", section: "Section" };

/**
 * "Your master resume changed" banner on a job's tailored copy: one button for the safe automatic
 * updates (rewordings, name/contact still as they were), and a list of new master content to add and
 * removed master content to remove here too. Nothing is added or deleted without a tap.
 */
export function PullBanner({
  plan, onPull, onAdd, onAddAll, onDismissAdditions, onRemoval,
}: {
  plan: PullPlan;
  onPull: () => void;
  onAdd: (a: PullAddition) => void;
  onAddAll: () => void;
  onDismissAdditions: () => void;
  onRemoval: (r: PullRemoval, choice: "remove" | "keep") => void;
}) {
  const [open, setOpen] = useState(false);
  if (!hasPullChanges(plan)) return null;
  const { additions, removals } = plan;
  const listed = additions.length + removals.length;
  const summary = [
    plan.total ? plural(plan.total, "update") : "",
    additions.length ? `${additions.length} new` : "",
    removals.length ? `${removals.length} removed` : "",
  ].filter(Boolean);
  const kept = [plan.skipped ? plural(plan.skipped, "bullet") : "", plan.headerKept ? "your name/contact line" : ""].filter(Boolean);

  return (
    <div className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-sm space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex-1 min-w-48">
          Your master resume changed: {summary.join(", ")}.
          {kept.length > 0 && <span className="text-muted"> Your edits here ({kept.join(" and ")}) are kept.</span>}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {listed > 0 && (
            <button
              type="button"
              className="btn btn-sm min-h-10 sm:min-h-0"
              aria-expanded={open}
              aria-controls="pull-review"
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "Hide" : "Review"} new &amp; removed ({listed}) {open ? "▴" : "▾"}
            </button>
          )}
          {plan.total > 0 && (
            <button type="button" className="btn btn-sm btn-primary min-h-10 sm:min-h-0" onClick={onPull}>
              Pull {plural(plan.total, "update")}
            </button>
          )}
        </div>
      </div>

      {open && listed > 0 && (
        <div id="pull-review" className="space-y-3 border-t border-accent/20 pt-2">
          {additions.length > 0 && (
            <div className="space-y-1.5">
              <p className="label">New in your master resume</p>
              <ul className="space-y-1.5">
                {additions.map((a) => {
                  const t = additionText(a);
                  return (
                    <li key={`${a.kind}:${a.id}`} className="flex items-start gap-2">
                      <span className="flex-1 min-w-0">
                        <span className="text-xs text-muted">{t.what}{t.detail ? ` · ${t.detail}` : ""}</span>
                        <span className="block break-words">{t.text}</span>
                      </span>
                      <button type="button" className="btn btn-sm shrink-0 min-h-10 sm:min-h-0" onClick={() => onAdd(a)}>
                        Add
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {additions.length > 1 && (
                  <button type="button" className="btn btn-sm btn-primary min-h-10 sm:min-h-0" onClick={onAddAll}>
                    Add all ({additions.length})
                  </button>
                )}
                <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={onDismissAdditions}>
                  Leave {additions.length > 1 ? "them" : "it"} out of this copy
                </button>
              </div>
            </div>
          )}
          {removals.length > 0 && (
            <div className="space-y-1.5">
              <p className="label">Removed from master: remove here too?</p>
              <ul className="space-y-1.5">
                {removals.map((r) => (
                  <li key={`${r.kind}:${r.id}`} className="flex flex-wrap items-start gap-2">
                    <span className="flex-1 min-w-48">
                      <span className="text-xs text-muted">{KIND[r.kind]}</span>
                      <span className="block break-words">{r.label}</span>
                    </span>
                    <span className="flex gap-1.5 shrink-0">
                      <button type="button" className="btn btn-sm min-h-10 sm:min-h-0 text-bad" onClick={() => onRemoval(r, "remove")}>
                        Remove here
                      </button>
                      <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={() => onRemoval(r, "keep")}>
                        Keep
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "This tailored copy was changed on another device": both devices changed the same line, so autosave
 * is paused until the user picks a side (same choices as the master resume page).
 */
export function TailoredConflictBanner({
  conflicts, busy, onReload, onKeepMine,
}: { conflicts: MergeConflict[]; busy: boolean; onReload: () => void; onKeepMine: () => void }) {
  const shown = conflicts.slice(0, 3);
  const more = conflicts.length - shown.length;
  return (
    <div
      role="alert"
      className="fixed z-40 inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-md rounded-xl border border-bad/50 bg-surface p-4 text-sm shadow-lg space-y-2 max-h-[70dvh] overflow-y-auto"
    >
      <p className="font-semibold text-bad">This tailored copy was changed on another device</p>
      <p className="text-muted">
        Your other device changed the same {conflicts.length === 1 ? "line" : "lines"}. Nothing here is saved until you choose.
      </p>
      <ul className="space-y-1">
        {shown.map((c, i) => (
          <li key={i} className="break-words">
            <span className="font-medium">{c.where}</span>
            {(c.local || c.server) && (
              <span className="block text-xs text-muted">
                Yours: “{c.local || "(empty)"}” · Theirs: “{c.server || "(empty)"}”
              </span>
            )}
          </li>
        ))}
        {more > 0 && <li className="text-xs text-muted">and {more} more</li>}
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="btn min-h-10 sm:min-h-0 flex-1 sm:flex-none" disabled={busy} onClick={onReload}>
          Reload theirs
        </button>
        <button type="button" className="btn btn-primary min-h-10 sm:min-h-0 flex-1 sm:flex-none" disabled={busy} onClick={onKeepMine}>
          Keep mine (overwrite)
        </button>
      </div>
      <p className="text-xs text-muted">
        Reload theirs shows their version and drops your unsaved edits here. Keep mine saves your version of these lines over
        theirs and keeps their other changes.
      </p>
    </div>
  );
}

const REMOVAL_KIND: Record<MasterRemoval["kind"], string> = { bullet: "Bullet", item: "Entry", section: "Section" };

/**
 * Confirmation for "Save this tailored copy as my master resume": what goes in, what stays, and an
 * opt-in list of things this copy left out that could also be removed from the master (all unticked).
 */
export function SaveAsMasterDialog({
  plan, busy, onCancel, onConfirm,
}: {
  plan: SaveAsMasterPlan;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (remove: Set<string>) => void;
}) {
  const [remove, setRemove] = useState<Set<string>>(new Set());
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    confirmBtn.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancelRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const toggle = (id: string) =>
    setRemove((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const nothing = !plan.edited && !plan.added && !remove.size;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-master-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}
    >
      <div className="w-full sm:max-w-lg max-h-[90dvh] overflow-y-auto rounded-t-2xl sm:rounded-xl bg-bg p-4 shadow-xl space-y-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <h2 id="save-master-title" className="font-semibold">Save this tailored copy to your master resume</h2>
        <ul className="list-disc pl-5 text-sm space-y-1">
          {plan.edited || plan.added ? (
            <li>
              {[plan.edited ? plural(plan.edited, "reworded line") : "", plan.added ? plural(plan.added, "new item") : ""]
                .filter(Boolean)
                .join(" and ")}{" "}
              from this copy go into your master resume.
            </li>
          ) : (
            <li>This copy has no edits your master resume doesn&apos;t already have.</li>
          )}
          {plan.kept > 0 && (
            <li>
              {plural(plan.kept, "thing")} only in your master resume (added later, or left out of this copy) {plan.kept === 1 ? "stays" : "stay"}.
            </li>
          )}
          {plan.conflicts.length > 0 && (
            <li>
              {plural(plan.conflicts.length, "line")} also changed on your master since this copy was made; this copy&apos;s wording is
              used.
            </li>
          )}
          <li>Your facts stay, and other jobs keep their own tailored copies.</li>
        </ul>
        {plan.removals.length > 0 && (
          <fieldset className="rounded-lg border border-border p-3 space-y-2">
            <legend className="px-1 text-sm font-medium">Also remove from master:</legend>
            <p className="text-xs text-muted">
              You left these out of this copy. They stay on your master resume unless you tick them.
            </p>
            <ul className="space-y-1.5">
              {plan.removals.map((r) => (
                <li key={r.id}>
                  <label className="flex items-start gap-2 text-sm min-h-10 sm:min-h-0">
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={remove.has(r.id)} onChange={() => toggle(r.id)} />
                    <span className="min-w-0 break-words">
                      <span className="block text-xs text-muted">
                        {REMOVAL_KIND[r.kind]}
                        {r.where ? ` in ${r.where}` : ""}
                      </span>
                      {r.label}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" className="btn min-h-10 sm:min-h-0" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            ref={confirmBtn}
            type="button"
            className="btn btn-primary min-h-10 sm:min-h-0"
            onClick={() => onConfirm(remove)}
            disabled={busy || nothing}
          >
            {busy ? "Saving…" : remove.size ? `Save and remove ${remove.size}` : "Save to master resume"}
          </button>
        </div>
      </div>
    </div>
  );
}
