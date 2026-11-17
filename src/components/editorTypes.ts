import type { LineKind } from "@/lib/docLineTypes";
import type { Para } from "@/lib/types";

/**
 * Contract between the resume editor (ResumeDocument) and the pages that host it.
 */

export type MarkName = "bold" | "italic" | "underline";
export type Align = NonNullable<Para["align"]> | "left";

/** Font sizes offered in the toolbar and Format menu, in points. 11 is the default (no size mark). */
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28] as const;
export const DEFAULT_FONT_SIZE = 11;

/** Imperative document commands for the page's Format menu and shortcuts. They act on the editor's selection. */
export type DocCommands = {
  /** Toggle bold / italic / underline on the selection (or on what you type next, with a caret). */
  toggleMark(mark: MarkName): void;
  /** Set the font size (points) of the selection. 11 removes the size mark. */
  setSize(pt: number): void;
  /** Align every line touched by the selection. */
  setAlign(align: Align): void;
  /** Toggle the rule line under / ALL CAPS / extra space before, on every line touched by the selection. */
  toggleRule(): void;
  toggleCaps(): void;
  toggleSpaceBefore(): void;
  /** Remove all inline marks in the selection and all paragraph formatting of the lines it touches. */
  clearFormatting(): void;
  /** Change the paragraph style of every line touched by the selection. */
  setLineKind(kind: LineKind): void;
};

/**
 * Formatting state at the selection, for the toolbar and the Format menu.
 * active: the editor has a selection (focused, or last focused and not dismissed).
 * bold/italic/underline: on for the whole selection (with a caret: what typing would produce).
 * size: the selection's size in points, or null when it mixes sizes.
 * align/rule/caps/spaceBefore: of the line with the selection's start.
 */
export type FormatState = {
  active: boolean;
  lineKind: LineKind | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  size: number | null;
  align: Align;
  rule: boolean;
  caps: boolean;
  spaceBefore: boolean;
};

export const EMPTY_FORMAT_STATE: FormatState = {
  active: false, lineKind: null, bold: false, italic: false, underline: false, size: DEFAULT_FONT_SIZE,
  align: "left", rule: false, caps: false, spaceBefore: false,
};

/** What's selected in the document (the caret's line), by id. The coaching panel follows it. */
export type DocSelection =
  | { kind: "section"; sectionId: string }
  | { kind: "entry"; sectionId: string; entryId: string }
  | { kind: "bullet"; sectionId: string; entryId: string; bulletId: string };

/** User-facing names of the paragraph styles, in dropdown order. */
export const LINE_KIND_LABELS: { kind: LineKind; label: string; hint: string }[] = [
  { kind: "text", label: "Normal text", hint: "Any line" },
  { kind: "name", label: "Name", hint: "Your name (one per resume)" },
  { kind: "contact", label: "Contact line", hint: "Email, phone, links (one per resume)" },
  { kind: "heading", label: "Section heading", hint: "Experience, Education…" },
  { kind: "entry", label: "Entry title", hint: "Organization  ⇥  Location" },
  { kind: "role", label: "Entry subtitle", hint: "Role  ⇥  Dates" },
  { kind: "bullet", label: "Bullet", hint: "What you did and its impact" },
];
