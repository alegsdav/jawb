import type { TextStyle } from "./types";

/**
 * Shared contract for the resume text editor. The editor is one continuous document of lines; each line
 * has a "paragraph style" (its kind). The structured Resume (sections > items > bullets) is derived from
 * the lines in order, and the lines are derived from the Resume, by src/lib/docLines.ts.
 *
 *   name      the first line (the person's name). Always line 0.
 *   contact   the second line (city • email • phone). Always line 1.
 *   heading   a section title ("EXPERIENCE"). Starts a new Section.
 *   entry     an entry's first line: organization / school on the left, location right-aligned.
 *   role      an entry's second line: role / degree on the left, dates right-aligned.
 *   bullet    a bullet point of the current entry.
 *   text      a plain line ("Languages: Python, SQL"), stored as an inline Item: title before the first
 *             ": ", subtitle after it (or the whole line as title when there is no ": ").
 */
export type LineKind = "name" | "contact" | "heading" | "entry" | "role" | "bullet" | "text";

export const LINE_KINDS: readonly LineKind[] = ["name", "contact", "heading", "entry", "role", "bullet", "text"];

/** One line of the document, independent of the editor library. */
export type DocLine = {
  kind: LineKind;
  /** The line's text. entry/role: the left part only. text: the whole line, e.g. "Languages: Python, SQL". */
  text: string;
  /** entry/role only: the right-aligned part (location / dates). Always a string for entry/role, undefined otherwise. */
  right?: string;
  /**
   * Model ids this line maps to. heading: sid. entry/role/text: sid + iid. bullet: sid + iid + bid.
   * name/contact: none. Missing or duplicated ids get fresh ones when lines become a Resume.
   */
  sid?: string;
  iid?: string;
  bid?: string;
  /**
   * Bold/italic override for the line's first part: the name, the contact line, the section title, the entry
   * title (entry left), the role (role left), or a text line's label (before the first ": ", or the whole
   * line when there is no ": "). Undefined = the default for that part. Bullets never have styles.
   */
  style?: TextStyle;
  /** Override for the second part: the location (entry right), the dates (role right), a text line's details (after the first ": "). */
  style2?: TextStyle;
};

/** The ids a line resolved to after a parse (written back onto the editor's line so they stay stable). */
export type LineIds = { sid?: string; iid?: string; bid?: string };

/** Which part of a line: 1 = first (left / label), 2 = second (right / details). */
export type LinePart = 1 | 2;
