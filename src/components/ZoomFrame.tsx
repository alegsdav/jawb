"use client";

import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { PAGE_W, pageScale, reflowsAt } from "@/lib/pageZoom";

/**
 * Lays out the page at its own width (PAGE_W) and scales it visually from its top-left corner when `scale` is not 1.
 * The outer box takes the scaled size and centres itself, so a page wider than the column scrolls horizontally instead
 * of being clipped or re-wrapped. A `reflow` page (phones) takes the column's width instead and is never scaled.
 */
export function ZoomFrame({ scale, reflow = false, children }: { scale: number; reflow?: boolean; children: React.ReactNode }) {
  const scaled = !reflow && scale !== 1;
  const innerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!scaled || !el) {
      setHeight(null);
      return;
    }
    // offsetHeight is the layout height, unaffected by transform.
    const measure = () => setHeight(el.offsetHeight * scale);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scale, scaled]);

  if (reflow) return <div className="zoom-frame">{children}</div>;
  if (!scaled) return <div className="zoom-frame mx-auto" style={{ width: PAGE_W }}>{children}</div>;
  return (
    <div className="relative mx-auto" style={{ width: PAGE_W * scale, height: height ?? undefined }}>
      <div
        ref={innerRef}
        className="zoom-frame absolute left-0 top-0"
        style={{ width: PAGE_W, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The Docs-style grey canvas the page sits on. It is the document's scroll area (it scrolls sideways when the page is
 * wider than the window), works out the "Fit" zoom (0) from its own width, and reflows on phone widths instead.
 * `plain` drops the grey for a page shown inside a card or dialog, where the surrounding surface is the backdrop.
 */
export function EditorCanvas({
  zoom, children, className = "", footer, plain = false,
}: {
  zoom: number;
  children: React.ReactNode;
  className?: string;
  /** Rendered after the page, outside the zoom (e.g. nothing, or notes). */
  footer?: React.ReactNode;
  /** No grey backdrop. Default false (the editor's grey). */
  plain?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setWidth(el.clientWidth);
      setViewport(window.innerWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  // Phones are decided by the window, like the phone CSS (max-width: 639px): a laptop whose side panels leave a
  // narrow column still gets the real page, scaled to fit.
  const reflow = reflowsAt(viewport);
  return (
    // On lg+ the grey starts 4px in from the canvas's left edge: the same white as the divider's sides, so the menu and
    // the canvas read as apart. The border isn't in clientWidth, so the Fit zoom still measures the grey's width.
    <div ref={ref} className={`overflow-x-auto ${plain ? "" : "bg-[#f1f3f4] lg:border-l-4 lg:border-white"} ${className}`}>
      {/* Until the canvas is measured (the server's HTML, before hydration) the page would draw at 100% and then
          jump to its fitted size, or from the desktop page to the phone reflow; keep it invisible for that frame. */}
      <div style={viewport ? undefined : { visibility: "hidden" }}>
        <ZoomFrame scale={reflow ? 1 : pageScale(zoom, width)} reflow={reflow}>
          {children}
        </ZoomFrame>
      </div>
      {footer}
    </div>
  );
}
