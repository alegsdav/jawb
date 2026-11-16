"use client";

import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * Scales its children visually (the page only, not the UI around it).
 * The inner element keeps its layout width; the outer element takes the scaled height so the
 * scroll area matches what is on screen. At zoom 1 nothing is transformed or fixed in height.
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

  return (
    <div
      className="relative w-full"
      style={scaled && height !== null ? { height } : undefined}
    >
      <div
        ref={innerRef}
        className="zoom-frame"
        style={scaled ? { transform: `scale(${scale})`, transformOrigin: "top center" } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
