"use client";

import type { PriorityItem } from "@/lib/coaching";
import { hasPlaceholder, plural } from "@/lib/facts";
import { markPlaceholders } from "./PlaceholderTextarea";

const GROUPS: [PriorityItem["rating"], string][] = [
  ["weak", "Could be much stronger"],
  ["ok", "Could be stronger"],
];

/**
 * Top of a job tab's panel: the suggested rewrites to review first (weak bullets, then okay ones with
 * a rewrite), grouped under one heading per rating, each with the full rewrite and Accept / Reject (the
 * same actions as the comment card in the document). Clicking a card selects its bullet in the resume.
 * The posting's missing keywords are listed once, in the analysis panel's Keywords section.
 */
export function PriorityList({
  items, onAccept, onReject, onShow,
}: {
  items: PriorityItem[];
  onAccept: (bulletId: string, rewrite: string) => void;
  onReject: (bulletId: string) => void;
  onShow: (bulletId: string) => void;
}) {
  if (!items.length) return null;
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-3">
      <p className="text-[13px] font-semibold">{plural(items.length, "rewrite")}</p>
      {GROUPS.map(([rating, heading]) => {
        const group = items.filter((p) => p.rating === rating);
        if (!group.length) return null;
        return (
          <div key={rating} className="space-y-2">
            <p className={`text-xs font-semibold ${rating === "weak" ? "text-bad" : "text-ok"}`}>{heading}</p>
            <ul className="space-y-2">
              {group.map((p) => (
                <li key={p.bulletId} className="rounded-lg border border-border bg-surface p-3 space-y-1.5">
                  <div
                    role="button"
                    tabIndex={0}
                    className="cursor-pointer space-y-1.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    onClick={() => onShow(p.bulletId)}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onShow(p.bulletId);
                      }
                    }}
                  >
                    {p.entry && <p className="text-xs text-muted">{p.entry}</p>}
                    <p className="text-sm line-through decoration-bad/60 text-muted break-words">{p.text}</p>
                    <p className="text-sm text-good bg-good-bg rounded px-1.5 py-1 break-words">{markPlaceholders(p.rewrite)}</p>
                    {p.note && <p className="text-xs text-muted">{p.note}</p>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    <button type="button" className="btn btn-sm btn-primary min-h-10 sm:min-h-0" onClick={() => onAccept(p.bulletId, p.rewrite)}>
                      ✓ Accept
                    </button>
                    <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={() => onReject(p.bulletId)}>
                      ✕ Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {items.some((p) => hasPlaceholder(p.rewrite)) && (
        <p className="text-xs text-muted">Fill each [placeholder] with your real number.</p>
      )}
    </div>
  );
}
