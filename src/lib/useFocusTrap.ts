"use client";

import { useEffect, type RefObject } from "react";

/** Elements a Tab press can land on (tabindex="-1" is skipped: it's focusable by script only). */
const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Not shown on screen: display or visibility off, or inside a hidden subtree. */
function isVisible(el: HTMLElement): boolean {
  if (el.closest("[hidden]")) return false;
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

/**
 * Keeps Tab and Shift+Tab inside a modal dialog: from its last focusable control Tab wraps to the first, and from
 * the first Shift+Tab wraps to the last. A focus that has strayed outside the container is brought back in.
 * `aria-modal` alone doesn't stop the browser from tabbing into the page behind.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const container = ref.current;
      if (!container) return;
      const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
      if (items.length === 0) {
        e.preventDefault(); // nothing to land on: keep focus where it is
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement as HTMLElement | null;
      const inside = !!current && container.contains(current);
      if (e.shiftKey) {
        if (!inside || current === first || current === container) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || current === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref, active]);
}
