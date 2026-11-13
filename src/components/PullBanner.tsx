"use client";

import { useState } from "react";
import { hasPullChanges, type PullAddition, type PullPlan, type PullRemoval } from "@/lib/tailor";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

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
