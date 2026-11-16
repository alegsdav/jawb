"use client";

import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";

/** Letter page width at 96dpi; matches `.doc-page` max-width and the PDF. */
export const PAGE_W = 816;
/** Below this column width the page reflows for phones (see globals.css), so it is never scaled. */
const REFLOW_W = 640;

/**
 * Scales its children visually (the page only, not the UI around it). When scaled, the inner element is
 * laid out at the page's own width and scaled from its top-left corner; the outer box takes the scaled
 * size and centres itself, so a page wider than the column scrolls horizontally instead of being clipped.
 * At zoom 1 nothing is transformed or sized.
 */
export function ZoomFrame({ zoom, children }: { zoom: number; children: React.ReactNode }) {
  const scale = zoom > 0 ? zoom : 1;
  const scaled = scale !== 1;
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

  if (!scaled) return <div className="zoom-frame">{children}</div>;
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
 * The Docs-style grey canvas the page sits on. It is the document's scroll area, works out the "Fit"
 * zoom (0) from its own width, and never scales on phone widths (the page reflows there instead).
 */
export function EditorCanvas({
  zoom, children, className = "", footer,
}: {
  zoom: number;
  children: React.ReactNode;
  className?: string;
  /** Rendered after the page, outside the zoom (e.g. nothing, or notes). */
  footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const reflow = width > 0 && width < REFLOW_W;
  const fit = width ? Math.min(1, (width - 48) / PAGE_W) : 1;
  const effective = reflow ? 1 : zoom === 0 ? fit : zoom;
  return (
    <div ref={ref} className={`bg-[#f1f3f4] ${className}`}>
      <ZoomFrame zoom={effective}>{children}</ZoomFrame>
      {footer}
    </div>
  );
}
