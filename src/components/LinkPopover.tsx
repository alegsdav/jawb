"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

/** Viewport position of the text the link belongs to (from the editor's coordsAtPos). */
export type LinkAnchor = { top: number; bottom: number; left: number };

type Props = {
  anchor: LinkAnchor;
  /** "edit": URL box (Apply / Remove). "bubble": the link's URL with Open, Edit and Remove. */
  mode: "edit" | "bubble";
  /** The link's current href (prefilled in edit mode). */
  href: string;
  /** Apply the typed address. Returns false (and the box stays open) when the address is refused. */
  onApply: (raw: string) => boolean;
  onRemove: () => void;
  onEdit: () => void;
  /** Closes the box. refocus: put the caret back in the editor (Escape); false for a click outside. */
  onClose: (refocus: boolean) => void;
};

const WIDTH = 340;
const GAP = 6;

/**
 * The link box under a selection, or the bubble above a caret inside a link. Rendered in document.body so the page's
 * zoom transform does not move it; the anchor is in viewport coordinates. data-doc-keep-selection keeps the document's
 * selection while the box is in use.
 */
export function LinkPopover({ anchor, mode, href, onApply, onRemove, onEdit, onClose }: Props) {
  const [value, setValue] = useState(href);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "edit") inputRef.current?.focus();
  }, [mode]);

  // A click anywhere else closes the box (without moving the focus the click just gave elsewhere).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [onClose]);

  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8));
  // Below the text; above it when there is no room below.
  const below = anchor.bottom + GAP;
  const top = below + 80 > window.innerHeight ? Math.max(8, anchor.top - GAP - 80) : below;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) {
      onRemove();
      return;
    }
    if (!onApply(value)) setError("Enter a web address (https://…) or a mailto: address.");
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose(true);
    }
  };

  const node = (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Link"
      data-doc-keep-selection
      onKeyDown={onKeyDown}
      className="fixed z-50 rounded-lg border border-border bg-surface p-2 text-sm text-fg shadow-lg"
      style={{ left, top, width: WIDTH, maxWidth: "calc(100vw - 16px)" }}
    >
      {mode === "edit" ? (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] text-muted">Link address</span>
            <input
              ref={inputRef}
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://example.com"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "doc-link-error" : undefined}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              className="h-8 rounded-md border border-border bg-surface px-2 text-sm text-fg"
            />
          </label>
          {error && (
            <p id="doc-link-error" role="alert" className="text-[12px] text-red-700">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            {href && (
              <button type="button" className="btn btn-sm" onClick={onRemove}>
                Remove link
              </button>
            )}
            <button type="submit" className="btn btn-sm">
              Apply
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="min-w-0 flex-1 truncate text-[#1155cc] underline"
            title={href}
          >
            {href}
          </a>
          <button type="button" className="btn btn-sm" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="btn btn-sm" onClick={onRemove}>
            Remove
          </button>
        </div>
      )}
    </div>
  );

  return typeof document === "undefined" ? null : createPortal(node, document.body);
}
