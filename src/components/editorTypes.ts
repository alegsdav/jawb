import type { LineKind } from "@/lib/docLineTypes";

/**
 * Contract between the resume editor (ResumeDocument) and the pages that host it.
 */

/** Imperative document commands for the page's Format menu and shortcuts. All act on the line with the caret. */
export type DocCommands = {
  /** Toggle bold / italic on the part of the line the caret is in (a no-op for bullets and with no caret). */
  toggleBold(): void;
  toggleItalic(): void;
  /** Remove the bold/italic override on the caret's line part, back to its default. */
  resetFormat(): void;
  /** Change the paragraph style of the caret's line (no-op on the name and contact lines). */
  setLineKind(kind: LineKind): void;
};

/**
 * Formatting state of the caret's line, for the toolbar and the Format menu.
 * canFormat: the caret is in a line part that has bold/italic (not a bullet, editor focused or last focused).
 * lineKind: the caret line's kind, or null when nothing is selected.
 */
export type FormatState = { canFormat: boolean; bold: boolean; italic: boolean; lineKind: LineKind | null };

export const EMPTY_FORMAT_STATE: FormatState = { canFormat: false, bold: false, italic: false, lineKind: null };

/** What's selected in the document (the caret's line), by id. The coaching panel follows it. */
export type DocSelection =
  | { kind: "section"; sectionId: string }
  | { kind: "entry"; sectionId: string; entryId: string }
  | { kind: "bullet"; sectionId: string; entryId: string; bulletId: string };

/** User-facing names of the paragraph styles, in dropdown order. name/contact are fixed and not choosable. */
export const LINE_KIND_LABELS: { kind: LineKind; label: string; hint: string }[] = [
  { kind: "heading", label: "Section heading", hint: "EXPERIENCE, EDUCATION…" },
  { kind: "entry", label: "Entry title", hint: "Organization  ⇥  Location" },
  { kind: "role", label: "Entry subtitle", hint: "Role  ⇥  Dates" },
  { kind: "bullet", label: "Bullet", hint: "What you did and its impact" },
  { kind: "text", label: "Normal text", hint: "Languages: Python, SQL" },
];
