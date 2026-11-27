"use client";

import {
  Children, createContext, useCallback, useContext, useLayoutEffect, useRef, useState,
  type KeyboardEvent, type PointerEvent, type ReactNode,
} from "react";
import { PanelRightIcon } from "./icons";
import {
  DIVIDER_PX, SPLIT_DEFAULT, SPLIT_STEP, clampSplit, parseSplit, splitColumns, splitLimits,
} from "@/lib/split";

/** The one storage key for the review split, so the job and master pages share the user's width and collapsed state. */
export const REVIEW_SPLIT_KEY = "jawb_review_split";

type SplitState = { collapsed: boolean; toggle: () => void };
const SplitContext = createContext<SplitState>({ collapsed: false, toggle: () => {} });

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage blocked or unavailable: keep the defaults.
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked or full: the choice simply isn't remembered.
  }
}

/**
 * The desktop split of an editor page: the document (left) and the review panel (right), with a draggable divider
 * between them. Takes exactly two children, the editor section then the panel section. On phones and tablets it is
 * the plain stacked layout: the divider is hidden and the panel is shown or hidden by the page's tabs as before.
 * `storageKey` remembers the reviewer's width; the collapsed state is remembered under `${storageKey}:collapsed`.
 */
export function SplitPane({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [fraction, setFraction] = useState(SPLIT_DEFAULT);
  const [freePx, setFreePx] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ id: number; value: number } | null>(null);

  const [left, right] = Children.toArray(children);
  const f = clampSplit(fraction, freePx);
  const { min, max } = splitLimits(freePx);

  // Read the saved choices before paint, so a client navigation doesn't flash the default layout. Track the width
  // on every window resize, so the reviewer is re-clamped when the window changes.
  useLayoutEffect(() => {
    const saved = parseSplit(readStored(storageKey));
    if (saved !== null) setFraction(saved);
    setCollapsed(readStored(`${storageKey}:collapsed`) === "1");

    const measure = () => {
      const el = rootRef.current;
      if (el) setFreePx(Math.max(0, el.getBoundingClientRect().width - DIVIDER_PX));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [storageKey]);

  const commit = useCallback((value: number) => {
    setFraction(value);
    writeStored(storageKey, value.toFixed(4));
  }, [storageKey]);

  const toggle = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    writeStored(`${storageKey}:collapsed`, next ? "1" : "0");
  }, [collapsed, storageKey]);

  /** The reviewer's share for a pointer at this x: the reviewer runs from the divider to the right edge. */
  const shareAt = (clientX: number): number => {
    const el = rootRef.current;
    if (!el) return f;
    const rect = el.getBoundingClientRect();
    const free = Math.max(1, rect.width - DIVIDER_PX);
    const reviewPx = rect.right - clientX - DIVIDER_PX / 2;
    return clampSplit(reviewPx / free, free);
  };

  // Dragging moves the columns directly on the element, so the page doesn't re-render on every pointer move; the
  // final share is committed (state and storage) on release.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection or focus change in the document while dragging
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, value: f };
    setDragging(true);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id || !rootRef.current) return;
    d.value = shareAt(e.clientX);
    rootRef.current.style.gridTemplateColumns = splitColumns(d.value);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    setDragging(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    commit(d.value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    let next: number;
    if (e.key === "ArrowLeft") next = f + SPLIT_STEP; // the divider moves left: the reviewer widens
    else if (e.key === "ArrowRight") next = f - SPLIT_STEP;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    else return;
    e.preventDefault();
    commit(clampSplit(Math.round(next * 100) / 100, freePx));
  };

  return (
    <SplitContext.Provider value={{ collapsed, toggle }}>
      <div
        ref={rootRef}
        className="flex flex-1 flex-col lg:grid lg:min-h-0 lg:grid-rows-[minmax(0,1fr)]"
        style={{ gridTemplateColumns: collapsed ? "minmax(0,1fr)" : splitColumns(f) }}
      >
        {left}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize review panel"
          aria-valuenow={Math.round(f * 100)}
          aria-valuemin={Math.round(min * 100)}
          aria-valuemax={Math.round(max * 100)}
          tabIndex={0}
          title="Drag to resize. Double-click to reset."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onDoubleClick={() => commit(SPLIT_DEFAULT)}
          onKeyDown={onKeyDown}
          className={`group relative w-[9px] shrink-0 cursor-col-resize touch-none select-none outline-none ${
            collapsed ? "hidden" : "hidden lg:block"
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 transition-[width,background-color] duration-150 ${
              dragging
                ? "w-[2px] bg-accent"
                : "w-px bg-border group-hover:w-[2px] group-hover:bg-accent group-focus-visible:w-[2px] group-focus-visible:bg-accent"
            }`}
          />
        </div>
        {/* display: contents keeps the panel a grid item; collapsing hides it on lg (phones are untouched). */}
        <div className={`contents ${collapsed ? "lg:hidden" : ""}`}>{right}</div>
      </div>
    </SplitContext.Provider>
  );
}

/** The sidebar toggle's look and size (see TOGGLE in Sidebar.tsx): a 32×32 box, muted until hovered. */
const PANEL_TOGGLE =
  "flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-fg/[0.06] hover:text-fg";

/**
 * The review panel's show/hide button. `panel` sits at the right end of the panel's tab row and hides the panel;
 * `editor` sits at the right end of the editor's top bar and shows it again once it is collapsed. Both sit 6px in from
 * the canvas's right edge and are centred on the 36px bar, so they share one spot. Desktop only.
 */
export function ReviewPanelToggle({ placement }: { placement: "panel" | "editor" }) {
  const { collapsed, toggle } = useContext(SplitContext);
  if (placement === "panel" ? collapsed : !collapsed) return null;
  const hide = placement === "panel";
  const label = hide ? "Hide review panel" : "Show review panel";
  return (
    // Centred on the whole 36px row, line included (pt-px: the row's 1px bottom border would otherwise lift it half a
    // pixel above the sidebar's toggle). The editor's copy has a -2px margin, as its bar has 8px padding (6px net).
    <span className={`ml-auto hidden shrink-0 items-center pt-px lg:flex ${hide ? "pl-2" : "-mr-0.5"}`}>
      <button
        type="button"
        className={PANEL_TOGGLE}
        aria-label={label}
        title={label}
        onClick={toggle}
        // Pressing the button doesn't take focus from the document (as IconButton does).
        onMouseDown={(e) => e.preventDefault()}
      >
        <PanelRightIcon className="h-[18px] w-[18px] shrink-0" />
      </button>
    </span>
  );
}
