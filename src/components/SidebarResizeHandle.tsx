"use client";

import type React from "react";
import { useRef, useState } from "react";
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_STEP, clampSidebarWidth } from "@/lib/sidebar";
import { saveSidebarWidth, useSidebar } from "./sidebarState";

type Drag = { id: number; startX: number; startW: number; last: number; aside: HTMLElement };

/**
 * The rail's right edge: drag to resize (200 to 360px). Rendered inside the rail's aside (the Sidebar's sibling of the
 * nav, so the nav's overflow clip doesn't cut the straddling hit area). During a drag only the CSS variable changes
 * on the aside (no React render per move); the width is committed, and saved in a cookie, on release.
 */
export function SidebarResizeHandle() {
  const { width, setWidth } = useSidebar();
  const drag = useRef<Drag | null>(null);
  // The highlight while dragging: set once at the start and once at the end, not per move.
  const [dragging, setDragging] = useState(false);

  /** Ends a drag: drop the live override so the committed value (from the context) takes over again. */
  const finish = (handle: HTMLElement, commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    try {
      handle.releasePointerCapture(d.id);
    } catch {
      /* capture already gone */
    }
    setDragging(false);
    d.aside.style.removeProperty("--sidebar-w");
    if (commit && d.last !== d.startW) {
      setWidth(d.last);
      saveSidebarWidth(d.last);
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const aside = e.currentTarget.parentElement;
    if (e.button !== 0 || !aside) return;
    e.preventDefault(); // no text selection while dragging
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, startX: e.clientX, startW: width, last: width, aside };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.last = clampSidebarWidth(d.startW + e.clientX - d.startX);
    d.aside.style.setProperty("--sidebar-w", `${d.last}px`);
    e.currentTarget.setAttribute("aria-valuenow", String(d.last));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) finish(e.currentTarget, true);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = e.key === "ArrowRight" ? SIDEBAR_WIDTH_STEP : -SIDEBAR_WIDTH_STEP;
    const next = clampSidebarWidth(width + delta);
    if (next === width) return;
    setWidth(next);
    saveSidebarWidth(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => {
        if (width === SIDEBAR_WIDTH_DEFAULT) return;
        setWidth(SIDEBAR_WIDTH_DEFAULT);
        saveSidebarWidth(SIDEBAR_WIDTH_DEFAULT);
      }}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 -right-[3px] z-20 flex w-[6px] cursor-col-resize touch-none justify-center outline-none focus-visible:outline-none"
    >
      <span
        aria-hidden
        className={`h-full w-[2px] transition-colors duration-150 motion-reduce:transition-none ${
          dragging ? "bg-accent" : "bg-transparent group-hover:bg-fg/15 group-focus-visible:bg-accent"
        }`}
      />
    </div>
  );
}
