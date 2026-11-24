"use client";

import type { ReactElement } from "react";
import { RATING, type BulletInfo } from "./docDecorations";

/**
 * The coaching card for the bullet the caret is in: plain text, no boxes. Its lines, in order: the rating and its
 * note; while an edit is pending, why it is stronger and Accept / Reject (the new wording is already a tracked
 * change in the document, so it is not repeated here); the placeholders still to fill; short state lines. On
 * desktop it sits in the right panel; below lg it is a bottom sheet over the document, so it keeps its card chrome.
 */
export function BulletCommentCard(props: {
  bulletId: string;
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
  const { bulletId, info, showChanges, quiet, onAccept, onRevert, onReject, onClose, onSelectPlaceholder } = props;
  const { view, fb, original, isNew, changed, suggestion, why, placeholders } = info;
  const placeholder = !quiet && placeholders.length > 0;

  if (!(view || changed || isNew || placeholder)) return null;

  const muted = "text-muted";
  const linkBtn = "text-xs text-muted underline underline-offset-2 hover:text-fg";

  return (
    <div
      data-comment-for={bulletId}
      className="doc-ui space-y-2 text-[13px] text-fg max-lg:rounded-lg max-lg:border max-lg:border-border max-lg:bg-surface max-lg:p-3 max-lg:shadow-sm"
      // The card isn't part of the text: clicks and focus inside it must not re-select the entry.
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.stopPropagation()}
    >
      {/* Phones only (the sheet): the way to close it. On desktop, clicking elsewhere in the document closes it. */}
      <div className="flex justify-end lg:hidden">
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

      {fb && (
        <p>
          <span className={`font-semibold ${RATING[fb.rating].light}`}>{RATING[fb.rating].label}</span>
          <span className={muted}> · </span>
          {fb.note}
        </p>
      )}

      {view?.state === "updated" && <p className={muted}>Updated. Re-analyze to rate the new wording.</p>}
      {view?.state === "stale" && <p className={muted}>Edited since the last analysis. Re-analyze for feedback on this wording.</p>}

      {suggestion && (
        <div className="space-y-2 pt-0.5">
          {/* The new wording, once: the document shows the bullet as it is, so this is the only place it appears. */}
          <p className="text-[14px] leading-relaxed text-fg">{suggestion}</p>
          {why && (
            <p>
              <span className="font-semibold">Why the edit is stronger:</span> {why}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              className="rounded-md bg-fg px-3 py-1 text-xs font-medium text-surface"
              onClick={() => onAccept(suggestion)}
            >
              Accept
            </button>
            {onReject && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                className={linkBtn}
                onClick={() => onReject(bulletId)}
              >
                Reject
              </button>
            )}
          </div>
        </div>
      )}

      {placeholder && (
        <p>
          Fill{" "}
          {placeholders.map((p, i) => (
            <span key={p.start}>
              {i > 0 && (i === placeholders.length - 1 ? " and " : ", ")}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onSelectPlaceholder(p.start, p.text.length)}
                className="font-medium underline decoration-[#d9a800] decoration-2 underline-offset-2 hover:text-[#8a6d00]"
                title="Select it so you can type over it"
              >
                {p.text}
              </button>
            </span>
          ))}{" "}
          before you apply.
        </p>
      )}

      {showChanges && changed && (
        <p>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            className={linkBtn}
            onClick={() => onRevert(original!)}
          >
            Revert to master wording
          </button>
        </p>
      )}
      {showChanges && isNew && !view && <p className={muted}>Added in this tailored copy (not in your master resume).</p>}
    </div>
  );
}
