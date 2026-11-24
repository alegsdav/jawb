/**
 * The coach panel's two choices ("Examples" and "Question me"), as plain data: which one is zoomed in, the
 * classes each button gets, and the status line while the AI works. The panel's component reads these.
 */

export type ChoiceMode = "examples" | "questions";

export const CHOICES: { mode: ChoiceMode; label: string; busyText: string }[] = [
  { mode: "examples", label: "Examples", busyText: "Finding examples for this bullet…" },
  { mode: "questions", label: "Question me", busyText: "Writing questions about this bullet…" },
];

/** The choice a stage belongs to (null while the two are side by side). */
export function choiceOfStage(kind: "choose" | "examples" | "resolve" | "questions"): ChoiceMode | null {
  if (kind === "choose") return null;
  return kind === "questions" ? "questions" : "examples";
}

/**
 * A choice button's classes. Side by side (`zoom` null) both are equal width. The picked one grows to the full
 * row and turns into a heading (its border fades out, its label grows); the other shrinks to nothing, fades and
 * goes invisible (so an "instead" link can zoom it back). All of it is a CSS transition, ~300ms.
 */
export function choiceClass(mode: ChoiceMode, zoom: ChoiceMode | null): string {
  const base = "min-w-0 overflow-hidden rounded-md border text-left transition-[flex-grow,flex-basis,border-color,font-size,padding,opacity,visibility] duration-300 ease-out";
  if (zoom === null) return `${base} grow basis-0 border-border px-3 py-2.5 text-[14px] text-fg hover:bg-surface-2`;
  if (zoom === mode) return `${base} grow basis-0 border-transparent px-0 py-2.5 text-[17px] font-medium text-fg cursor-default`;
  return `${base} grow-0 basis-0 border-transparent px-0 py-2.5 text-[14px] opacity-0 invisible`;
}

/** The row's gap: 8px side by side, 0 once one choice is zoomed (so the zoomed one takes the full width). */
export const rowGapClass = (zoom: ChoiceMode | null) => `flex transition-[gap] duration-300 ease-out ${zoom ? "gap-0" : "gap-2"}`;
