import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE_PT, DEFAULT_LINE_HEIGHT } from "@/lib/doc/types";

/**
 * Contract between the resume editor (ResumeDocument) and the pages that host it.
 */

export type MarkName = "bold" | "italic" | "underline";
export type Align = "left" | "center" | "right" | "justify";
export type ListKind = "bullet" | "ordered";

/** Font sizes offered in the toolbar, in points. */
export const FONT_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28] as const;

/** Imperative document commands for the toolbar, the menus and the shortcuts. They act on the editor's selection. */
export type DocCommands = {
  /** The editor's own undo history (the only undo for the document). Refocuses the editor. */
  undo(): void;
  redo(): void;
  toggleMark(mark: MarkName): void;
  /** Font size in points for the selection (or what you type next, with a caret). */
  setSize(pt: number): void;
  setFontFamily(family: string): void;
  setAlign(align: Align): void;
  toggleList(kind: ListKind): void;
  /** Nest the list item deeper / shallower (Tab / Shift+Tab). */
  indent(): void;
  outdent(): void;
  /** Line spacing multiple (1, 1.15, 1.5, 2). null = default. */
  setLineHeight(multiple: number | null): void;
  /** Add or remove space above / below the selected paragraphs, in points. */
  adjustSpaceBefore(deltaPt: number): void;
  adjustSpaceAfter(deltaPt: number): void;
  toggleBorderBottom(): void;
  insertHorizontalRule(): void;
  /** Remove all text formatting and paragraph formatting from the selected paragraphs. */
  clearFormatting(): void;
};

/**
 * Formatting state at the selection, for the toolbar and the menus.
 * active: the editor has the selection (focused, or last focused and not dismissed).
 * bold/italic/underline: on for the whole selection (with a caret: what typing would produce).
 * fontFamily / fontSize: null when the selection mixes values. Text without a mark has the document defaults.
 * align, list, lineHeight, borderBottom: of the paragraph the selection starts in.
 */
export type FormatState = {
  active: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontFamily: string | null;
  fontSize: number | null;
  align: Align;
  list: ListKind | null;
  lineHeight: number;
  borderBottom: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

export const EMPTY_FORMAT_STATE: FormatState = {
  active: false,
  bold: false,
  italic: false,
  underline: false,
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: DEFAULT_FONT_SIZE_PT,
  align: "left",
  list: null,
  lineHeight: DEFAULT_LINE_HEIGHT,
  borderBottom: false,
  canUndo: false,
  canRedo: false,
};

/** What's selected in the document (the caret's paragraph), by id. The coaching panel follows it. */
export type DocSelection =
  | { kind: "section"; sectionId: string }
  | { kind: "entry"; sectionId: string; entryId: string }
  | { kind: "bullet"; sectionId: string; entryId: string; bulletId: string };
