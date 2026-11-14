"use client";

import type { PriorityItem } from "@/lib/coaching";
import { plural } from "@/lib/facts";
import { markPlaceholders } from "./PlaceholderTextarea";

/**
 * Top of a job tab's panel: the suggested rewrites to review first (weak bullets, then okay ones with
 * a rewrite), each with the full rewrite and Accept / Reject (the same actions as the comment card in
 * the document), then the posting's keywords the resume is missing. Ratings are the AI's view of how a
 * bullet reads for this job; the student's own wording is never scored here.
 */
export function PriorityList({
  items, missingKeywords, onAccept, onReject, onShow, onAcceptAll,
}: {
  items: PriorityItem[];
  missingKeywords: string[];
  onAccept: (bulletId: string, rewrite: string) => void;
  onReject: (bulletId: string) => void;
  onShow: (bulletId: string) => void;
  onAcceptAll: () => void;
}) {
  if (!items.length && !missingKeywords.length) return null;
  return (
    <div className="space-y-3">
      {items.length > 0 && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm flex-1 min-w-40">
              <strong>Start here:</strong> {plural(items.length, "suggested rewrite")} for this job.
            </p>
            {items.length > 1 && (
              <button type="button" className="btn btn-sm btn-primary min-h-10 sm:min-h-0" onClick={onAcceptAll}>
                Accept all
              </button>
            )}
          </div>
          <ol className="space-y-2">
            {items.map((p) => (
              <li key={p.bulletId} className="rounded-lg border border-border bg-surface p-3 space-y-1.5">
                <p className="text-xs text-muted">
                  <span className={`font-semibold ${p.rating === "weak" ? "text-bad" : "text-ok"}`}>
                    {p.rating === "weak" ? "Could be much stronger" : "Could be stronger"}
                  </span>
                  {p.entry && <> · {p.entry}</>}
                </p>
                <p className="text-sm line-through decoration-bad/60 text-muted break-words">{p.text}</p>
                <p className="text-sm text-good bg-good-bg rounded px-1.5 py-1 break-words">{markPlaceholders(p.rewrite)}</p>
                {p.note && <p className="text-xs text-muted">{p.note}</p>}
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  <button type="button" className="btn btn-sm btn-primary min-h-10 sm:min-h-0" onClick={() => onAccept(p.bulletId, p.rewrite)}>
                    ✓ Accept
                  </button>
                  <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={() => onReject(p.bulletId)}>
                    ✕ Reject
                  </button>
                  <button type="button" className="btn btn-sm min-h-10 sm:min-h-0" onClick={() => onShow(p.bulletId)}>
                    Show in resume
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted">A rewrite with a [placeholder] needs your real number: fill it in on the resume or answer its question below.</p>
        </div>
      )}
      {missingKeywords.length > 0 && (
        <div className="space-y-1.5">
          <p className="label">Missing from your resume</p>
          <div className="flex flex-wrap gap-1">
            {missingKeywords.map((k) => (
              <span key={k} className="chip border-bad/40 text-bad" title="In the posting, missing from your resume">{k}</span>
            ))}
          </div>
          <p className="text-xs text-muted">Only add the ones that are true for you. Select an entry to get help working one in.</p>
        </div>
      )}
    </div>
  );
}
