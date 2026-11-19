import type { BulletFeedback, Rating } from "@/lib/analysis";
import { PLACEHOLDER_RE } from "@/lib/facts";

/**
 * What the AI said about one paragraph, as the UI shows it: the rating colours and the view of the feedback
 * for the paragraph's current text. The ProseMirror decorations that draw it live in ./aiHighlights.ts.
 * Pure: runs in Node.
 */

export const RATING: Record<Rating, { label: string; tint: string; dot: string; text: string; light: string }> = {
  strong: { label: "Strong", tint: "bg-[#e9f6ee]", dot: "bg-[#1f8a4c]", text: "text-[#5fd08a]", light: "text-[#188038]" },
  ok: { label: "Okay", tint: "bg-[#fdf5e2]", dot: "bg-[#c98a12]", text: "text-[#f0b84a]", light: "text-[#b06000]" },
  weak: { label: "Weak", tint: "bg-[#fdecec]", dot: "bg-[#c53030]", text: "text-[#ff8a8a]", light: "text-[#d93025]" },
};

export type BulletInfo = {
  view?: BulletFeedback;            // feedback?.[bid]
  fb: BulletFeedback | null;        // view when view.state === "current", else null
  original?: string;                // baseline?.get(bid)
  isNew: boolean;                   // !!baseline && original === undefined
  changed: boolean;                 // !!baseline && original !== undefined && original !== text
  suggestion: string;               // fb?.suggestion ?? ""
  placeholders: { text: string; start: number }[]; // PLACEHOLDER_RE matches in text (start = char index)
};

/** The inputs bulletInfo reads: the AI feedback and the master text by paragraph id. */
export type BulletSources = {
  feedback?: Record<string, BulletFeedback>;
  baseline?: Map<string, string> | null;
};

export function bulletInfo(bid: string, text: string, opts: BulletSources): BulletInfo {
  const view = opts.feedback?.[bid];
  const fb = view?.state === "current" ? view : null;
  const original = opts.baseline?.get(bid);
  const isNew = !!opts.baseline && original === undefined;
  const changed = !!opts.baseline && original !== undefined && original !== text;
  const suggestion = fb?.suggestion ?? "";
  const placeholders = [...text.matchAll(PLACEHOLDER_RE)].map((m) => ({ text: m[0], start: m.index! }));
  return { view, fb, original, isNew, changed, suggestion, placeholders };
}
