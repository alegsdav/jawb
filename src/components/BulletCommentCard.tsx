"use client";

import type { ReactElement } from "react";
import { RATING, type BulletInfo } from "./docDecorations";

/**
 * The light Docs-style comment card for the bullet the caret is in, shown in the side panel. Shows the
 * AI's rating and note, the suggested edit, placeholder chips, and the master-resume comparison.
 */
export function BulletCommentCard(props: {
  bulletId: string;
  text: string;
  info: BulletInfo;
  showChanges: boolean;
  quiet: boolean;
  /** Replace the bullet's text (Accept suggestion). */
  onAccept: (text: string) => void;
  /** Replace the bullet's text with the master version. */
  onRevert: (text: string) => void;
  onReject?: (bulletId: string) => void;
  onClose: () => void;
  /** Select a [placeholder] in the bullet (char offsets within the bullet text). */
  onSelectPlaceholder: (start: number, length: number) => void;
}): ReactElement | null {
  const { bulletId, text, info, showChanges, quiet, onAccept, onRevert, onReject, onClose, onSelectPlaceholder } = props;
  const { view, fb, original, isNew, changed, suggestion, placeholders } = info;
  const placeholder = !quiet && placeholders.length > 0;

  if (!(view || changed || isNew || placeholder)) return null;

  const muted = "text-muted";
  const rating = fb ? RATING[fb.rating].light : "";

  return (
    <div
      data-comment-for={bulletId}
      className="doc-ui rounded-lg border border-border bg-surface shadow-sm p-3 text-[13px] text-fg space-y-2"
      // The card isn't part of the text: clicks and focus inside it must not re-select the entry.
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-2">
        <p className={`line-clamp-2 min-w-0 flex-1 text-xs ${muted}`}>{text.trim() || "Empty bullet"}</p>
        <button
          type="button"
          aria-label="Close comment"
          title="Close comment"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClose}
          className="icon-btn -mr-1 -mt-1 shrink-0"
        >
          <span aria-hidden className="text-base leading-none">×</span>
        </button>
      </div>
      {placeholder && (
        <div className="rounded bg-[#fff6d6] px-2 py-1.5 text-[#5c4300]">
          <p>Replace each [placeholder] with your real number, or reword the bullet, before you apply.</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {placeholders.map((p) => (
              <button
                key={p.start}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelectPlaceholder(p.start, p.text.length)}
                className="min-h-8 rounded border border-[#d9a800] bg-[#ffd84d] px-2 text-xs font-medium text-[#3d2c00]"
                title="Select it so you can type over it"
              >
                {p.text}
              </button>
            ))}
          </div>
        </div>
      )}
      {fb && (
        <p>
          <span className={`font-semibold ${rating}`}>{RATING[fb.rating].label}.</span> {fb.note}
        </p>
      )}
      {view?.state === "updated" && (
        <p>
          <span className="font-semibold">Updated.</span>{" "}
          <span className={muted}>You accepted the suggested edit. Re-analyze to rate the new wording.</span>
        </p>
      )}
      {view?.state === "stale" && (
        <p className={muted}>Edited since the last analysis, so its rating is hidden. Re-analyze for feedback on this wording.</p>
      )}
      {suggestion && (
        <div className="space-y-1.5 pt-1">
          <p className={`text-[11px] uppercase tracking-wide ${muted}`}>Suggested edit</p>
          <p className="line-through decoration-[#d93025]/60 text-muted">{text}</p>
          <p className="rounded bg-[#e6f4ea] px-1 -mx-1 text-[#137333]">{suggestion}</p>
          <div className="flex gap-1.5 pt-1">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className="rounded-md bg-[#1a73e8] px-3 py-1 text-xs font-medium text-white"
              onClick={() => onAccept(suggestion)}
            >
              ✓ Accept
            </button>
            {onReject && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                className="rounded-md px-3 py-1 text-xs text-muted hover:bg-surface-2"
                onClick={() => onReject(bulletId)}
              >
                ✕ Reject
              </button>
            )}
          </div>
        </div>
      )}
      {showChanges && changed && (
        <div className="border-t border-border pt-2">
          <p className={`text-[11px] uppercase tracking-wide ${muted}`}>Master resume version</p>
          <p className={muted}>{original}</p>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            className="mt-1 min-h-8 text-xs text-[#1a73e8] underline underline-offset-2"
            onClick={() => onRevert(original!)}
          >
            Revert to master resume
          </button>
        </div>
      )}
      {showChanges && isNew && !view && <p className={muted}>Added in this tailored copy (not in your master resume).</p>}
    </div>
  );
}
