import type { Item, TextStyle } from "./types";

/**
 * legacy (version 2) formatting, used only to migrate old data: the implied Harvard bold/italic per
 * field, and `styles` overrides. Version 3 resumes store explicit marks/para instead (see
 * normalizeResume in resume.ts), so nothing else should read this file.
 */

type StyleField = "name" | "contact" | "sectionTitle" | "title" | "subtitle" | "location" | "dates";

// Same predicate as isInlineItem in resume.ts. Inlined here because resume.ts imports cleanStyle from
// this file, so importing back would be circular.
const isInline = (it: Item) => !it.bullets.length && !it.dates && !it.location;

/**
 * The Harvard default for a field. `item` is needed for the title/subtitle of inline items
 * ("Languages: Python"): the label is bold when there is one, and the details are plain.
 * Without `item`, title/subtitle use the normal-item defaults.
 */
export function defaultStyle(field: StyleField, item?: Item): Required<TextStyle> {
  switch (field) {
    case "name":
    case "sectionTitle":
      return { bold: true, italic: false };
    case "contact":
    case "location":
    case "dates":
      return { bold: false, italic: false };
    case "title":
      if (item && isInline(item)) return { bold: item.subtitle.trim() !== "", italic: false };
      return { bold: true, italic: false };
    case "subtitle":
      if (item && isInline(item)) return { bold: false, italic: false };
      return { bold: false, italic: true };
  }
}

/** The style in effect: override flags win, everything else falls back to the default. */
export function effectiveStyle(field: StyleField, override: TextStyle | undefined, item?: Item): Required<TextStyle> {
  const d = defaultStyle(field, item);
  return { bold: override?.bold ?? d.bold, italic: override?.italic ?? d.italic };
}

/** Keep only boolean bold/italic from untrusted data. Undefined when nothing is left. */
export function cleanStyle(raw: unknown): TextStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: TextStyle = {};
  if (typeof r.bold === "boolean") out.bold = r.bold;
  if (typeof r.italic === "boolean") out.italic = r.italic;
  return Object.keys(out).length ? out : undefined;
}
