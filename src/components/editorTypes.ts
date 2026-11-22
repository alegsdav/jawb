import { DEFAULT_LINE_HEIGHT, type TabStop } from "@/lib/doc/types";

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
  /** Tab stops for the selected paragraphs (see TabStop). null = none, so tabs use the default rule. */
  setTabStops(stops: TabStop[] | null): void;
  /** Add or remove space above / below the selected paragraphs, in points. */
  adjustSpaceBefore(deltaPt: number): void;
  adjustSpaceAfter(deltaPt: number): void;
  toggleBorderBottom(): void;
  insertHorizontalLine(): void;
  /**
   * Link the selection to href (http(s) or mailto:; anything else is ignored). With a caret inside a link, changes
   * that whole link; with a caret elsewhere, inserts href as linked text. null removes the link.
   */
  setLink(href: string | null): void;
  /** Opens the link editor at the selection (Ctrl+K). */
  openLink(): void;
  /** Remove all text formatting and paragraph formatting from the selected paragraphs. */
  clearFormatting(): void;
};

/**
 * Formatting state at the selection, for the toolbar and the menus. The editor keeps it current while it is blurred,
 * so the toolbar can show the selection's marks, font and size without the editor focused.
 * active: the editor has the selection (focused, or last focused and not dismissed). Only the Format menu reads it, to
 * disable its items; the formatting toolbar never disables a control.
 * bold/italic/underline: on for the whole selection (with a caret: what typing would produce).
 * fontFamily / fontSize: null when the selection mixes values, and before the editor exists (EMPTY_FORMAT_STATE), when
 * the toolbar's selects are empty. Text without a mark has the document defaults.
 * align, list, lineHeight, borderBottom, tabStops: of the paragraph the selection starts in.
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
  /** The paragraph's tab stops, or null when it has none (tabs then use the default rule). */
  tabStops: TabStop[] | null;
  /** The href of the link on the selection (or at the caret); null when none or when the selection mixes. */
  link: string | null;
  canUndo: boolean;
  canRedo: boolean;
};

/** The formatting state before the editor exists: inactive, the marks off, and empty font selects. */
export const EMPTY_FORMAT_STATE: FormatState = {
  active: false,
  bold: false,
  italic: false,
  underline: false,
  fontFamily: null,
  fontSize: null,
  align: "left",
  list: null,
  lineHeight: DEFAULT_LINE_HEIGHT,
  borderBottom: false,
  tabStops: null,
  link: null,
  canUndo: false,
  canRedo: false,
};

/** What's selected in the document (the caret's paragraph), by id. The coaching panel follows it. */
export type DocSelection =
  | { kind: "section"; sectionId: string }
  | { kind: "entry"; sectionId: string; entryId: string }
  | { kind: "bullet"; sectionId: string; entryId: string; bulletId: string };

const noop = () => {};

/** Every command a no-op: the editor's chrome while no document is loaded (EditorSkeleton). */
export const NOOP_COMMANDS: DocCommands = {
  undo: noop,
  redo: noop,
  toggleMark: noop,
  setSize: noop,
  setFontFamily: noop,
  setAlign: noop,
  toggleList: noop,
  indent: noop,
  outdent: noop,
  setLineHeight: noop,
  setTabStops: noop,
  adjustSpaceBefore: noop,
  adjustSpaceAfter: noop,
  toggleBorderBottom: noop,
  insertHorizontalLine: noop,
  setLink: noop,
  openLink: noop,
  clearFormatting: noop,
};
