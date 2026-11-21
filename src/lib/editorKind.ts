import { useState, type CSSProperties } from "react";

/** The two editor pages: a tailored job copy, or the master resume. */
export type EditorKind = "job" | "master";

/** How long a toolbar group keeps sliding in after the editor kind changes. Matches `.editor-kind-slide`. */
export const SLIDE_MS = 260;

/** The last kind seen and when it changed. Module state only: no storage, so it lasts for this tab's visit. */
let last: { kind: EditorKind; changedAt: number } | null = null;

/**
 * Called once per mount. Returns the ms since the kind changed, when that was within SLIDE_MS (so a remounted
 * toolbar continues the same slide), else null. The first call only records the kind, so a first page load
 * never animates.
 */
export function noteEditorKind(kind: EditorKind, now = Date.now()): number | null {
  if (!last) {
    last = { kind, changedAt: -Infinity };
    return null;
  }
  if (kind !== last.kind) {
    last = { kind, changedAt: now };
    return 0;
  }
  const elapsed = now - last.changedAt;
  return elapsed < SLIDE_MS ? elapsed : null;
}

/**
 * The slide for a toolbar group that differs between the job and master pages. Spread `className` and `style`
 * on the group. Computed once per mount, so the class stays put for the animation's whole run. Never on the
 * server: a server render must not touch the module state the browser reads.
 */
export function useKindSlide(kind: EditorKind): { className: string; style: CSSProperties } {
  const [elapsed] = useState(() => (typeof window === "undefined" ? null : noteEditorKind(kind)));
  return {
    className: elapsed === null ? "" : "editor-kind-slide",
    style: { animationDelay: `-${elapsed ?? 0}ms` },
  };
}
