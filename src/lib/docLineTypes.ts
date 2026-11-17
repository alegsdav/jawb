import type { Mark, Para } from "./types";

/**
 * Shared contract for the resume text editor. The editor is one continuous document of lines; each line
 * has a paragraph style (its kind), which tells the app what the line IS (so the AI knows which lines are
 * bullets, entries, headings). The kind never decides how a line LOOKS: all formatting is explicit
 * (inline marks + paragraph para), like a Google Doc. The structured Resume is derived from the lines in
 * order, and the lines from the Resume, by src/lib/docLines.ts.
 *
 *   name      the person's name (at most one; usually the first line). → header.name
 *   contact   the contact line (at most one). → header.contact
 *   heading   a section title ("Experience"). Starts a new Section.
 *   entry     an entry's first line: left text, then optionally a tab and a right-aligned part
 *             (organization ⇥ location). → item.title / item.location
 *   role      an entry's second line: left ⇥ right (role ⇥ dates). → item.subtitle / item.dates
 *   bullet    a bullet point of the current entry.
 *   text      any other line, stored as an inline Item whose title is the whole line. Empty text lines
 *             are kept (they're how a user adds blank space, like in a doc).
 */
export type LineKind = "name" | "contact" | "heading" | "entry" | "role" | "bullet" | "text";

export const LINE_KINDS: readonly LineKind[] = ["name", "contact", "heading", "entry", "role", "bullet", "text"];

/** One line of the document, independent of the editor library. */
export type DocLine = {
  kind: LineKind;
  /** The line's text (plain). entry/role: the left part only. */
  text: string;
  /** entry/role only: the right-aligned part (location / dates). Always a string for entry/role, undefined otherwise. */
  right?: string;
  /** Inline formatting over `text` (canonical Mark[]; omitted when none). */
  marks?: Mark[];
  /** entry/role only: inline formatting over `right` (omitted when none). */
  rightMarks?: Mark[];
  /** Paragraph formatting (omitted when none). */
  para?: Para;
  /**
   * Model ids this line maps to. heading: sid. entry/role/text: sid + iid. bullet: sid + iid + bid.
   * name/contact: none. Missing or duplicated ids get fresh ones when lines become a Resume.
   */
  sid?: string;
  iid?: string;
  bid?: string;
};

/** The ids a line resolved to after a parse (written back onto the editor's line so they stay stable). */
export type LineIds = { sid?: string; iid?: string; bid?: string };

/** Which part of a line: 1 = left / whole line, 2 = the right-aligned part of an entry/role line. */
export type LinePart = 1 | 2;
