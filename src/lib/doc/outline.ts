/**
 * Derives the structure the AI works with (header + sections of items and bullets) from a free document.
 * The heuristics are below; they read only the document (text, lists, bold, borders), never any stored field.
 *
 *   - Empty paragraphs are ignored for structure.
 *   - name: the first non-empty paragraph, if it is not a list item or a heading (else "").
 *   - contact: up to 3 following non-list, non-heading paragraphs, joined with " | ".
 *   - heading: not in a list, 1-40 chars, no tab, not ending in ".", and one of:
 *       (a) it has borderBottom; (b) its letters are all uppercase and there are at least 3;
 *       (c) every text run is bold and its text is a known heading; (d) its text is a known heading of at most 3 words.
 *   - Each heading starts a section. Lines before the first heading form an untitled section (title "").
 *   - A bullet (list paragraph) is a Bullet of the current item (a new item when there is none).
 *   - Any other paragraph starts an item. The item's first line is split at its first tab (left: title,
 *     right: location). A following plain paragraph is the item's second line (subtitle, dates) when the first line
 *     was an entry line: it had a tab, or it had no ": " (a "Label: value" line is an inline item on its own).
 *     The second line is only taken while the item has no bullets yet.
 */
import { flattenDoc } from "./model";
import type { DocJSON, DocText, FlatParagraph } from "./types";
import type { Bullet, Item, Section } from "../types";

export type Outline = { header: { name: string; contact: string }; sections: Section[] };

const KNOWN_HEADINGS = new Set([
  "education", "experience", "work experience", "professional experience", "relevant experience", "research experience",
  "leadership", "leadership experience", "leadership & activities", "leadership and activities", "activities",
  "extracurricular activities", "projects", "skills", "technical skills", "skills & interests", "skills and interests",
  "additional information", "additional", "honors", "awards", "honors & awards", "honors and awards", "publications",
  "certifications", "volunteer", "volunteer experience", "community service", "interests", "summary", "profile",
  "objective", "coursework", "relevant coursework",
]);

const isList = (p: FlatParagraph) => p.listType !== null;
const isBlank = (p: FlatParagraph) => p.text.trim() === "";

/** Heading text as compared with KNOWN_HEADINGS: lowercase, trimmed, trailing colons removed. */
export function headingKey(text: string): string {
  return text.trim().toLowerCase().replace(/:+$/, "").trim();
}

/** Whether every letter of the text is uppercase, with at least 3 letters. */
function isAllCaps(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  return letters.length >= 3 && letters.join("") === letters.join("").toUpperCase();
}

/** A paragraph's text runs (non-empty text nodes) with their bold flag. */
function runsOf(p: FlatParagraph): { bold: boolean }[] {
  return (p.node.content ?? [])
    .filter((n): n is DocText => n.type === "text" && n.text.length > 0)
    .map((n) => ({ bold: (n.marks ?? []).some((m) => m.type === "bold") }));
}

/** The paragraph is a section heading under the rules in the file comment. */
export function isHeading(p: FlatParagraph): boolean {
  if (isList(p)) return false;
  const t = p.text.trim();
  if (t.length < 1 || t.length > 40) return false;
  if (p.text.includes("\t") || t.endsWith(".")) return false;
  if (p.node.attrs?.borderBottom === true) return true;
  if (isAllCaps(t)) return true;
  const key = headingKey(t);
  if (!KNOWN_HEADINGS.has(key)) return false;
  const runs = runsOf(p);
  if (runs.length && runs.every((r) => r.bold)) return true;
  return t.split(/\s+/).length <= 3;
}

/** Splits a line at its first tab: left part and right part, both trimmed. */
export function splitLine(text: string): { left: string; right: string; tabbed: boolean } {
  const at = text.indexOf("\t");
  if (at < 0) return { left: text.trim(), right: "", tabbed: false };
  return { left: text.slice(0, at).trim(), right: text.slice(at + 1).trim(), tabbed: true };
}

/** A plain line that is a complete inline item ("Label: value") and never takes a second line. */
const isLabelLine = (text: string) => text.includes(": ");

/** The name and contact lines at the top, and how many non-empty paragraphs they used. */
function readHeader(lines: FlatParagraph[]): { name: string; contact: string; used: number } {
  let i = 0;
  let name = "";
  if (lines.length && !isList(lines[0]) && !isHeading(lines[0])) {
    name = lines[0].text.trim();
    i = 1;
  }
  const contact: string[] = [];
  while (i < lines.length && contact.length < 3 && !isList(lines[i]) && !isHeading(lines[i])) {
    contact.push(lines[i].text.trim());
    i++;
  }
  return { name, contact: contact.join(" | "), used: i };
}

/** Who a paragraph belongs to: its section and item (both optional). */
type Owner = { section?: string; item?: string };

/**
 * One walk over the document that yields both the outline and the paragraph membership of every section,
 * item and the header, so the two always agree.
 */
function analyze(doc: DocJSON): { outline: Outline; groups: Map<string, string[]> } {
  const all = flattenDoc(doc);
  const lines = all.filter((p) => !isBlank(p));
  const head = readHeader(lines);
  const groups = new Map<string, string[]>([["header", []]]);
  const place = (id: string, owner: Owner) => {
    const keys = owner.item !== undefined || owner.section !== undefined
      ? [owner.section, owner.item].filter((k): k is string => k !== undefined)
      : ["header"];
    for (const k of keys) {
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(id);
    }
  };

  const sections: Section[] = [];
  let section: Section | undefined;
  let item: Item | undefined;
  let entryOpen = false;
  let owner: Owner = {};
  let lineIndex = -1;

  const ensureSection = (p: FlatParagraph): Section => {
    if (!section) {
      section = { id: p.id, title: "", items: [] };
      sections.push(section);
    }
    return section;
  };

  for (const p of all) {
    if (isBlank(p)) {
      place(p.id, owner);
      continue;
    }
    lineIndex++;
    if (lineIndex < head.used) {
      owner = {};
      place(p.id, owner);
      continue;
    }

    if (isList(p)) {
      const sec = ensureSection(p);
      if (!item) {
        item = { id: p.id, title: "", subtitle: "", location: "", dates: "", bullets: [] };
        sec.items.push(item);
      }
      const bullet: Bullet = { id: p.id, text: p.text.trim() };
      item.bullets.push(bullet);
      entryOpen = false;
    } else if (isHeading(p)) {
      section = { id: p.id, title: p.text.trim(), items: [] };
      sections.push(section);
      item = undefined;
      entryOpen = false;
    } else {
      const sec = ensureSection(p);
      if (item && entryOpen && item.bullets.length === 0) {
        const { left, right } = splitLine(p.text);
        item.subtitle = left;
        item.dates = right;
        entryOpen = false;
      } else {
        const { left, right, tabbed } = splitLine(p.text);
        item = { id: p.id, title: left, subtitle: "", location: right, dates: "", bullets: [] };
        sec.items.push(item);
        entryOpen = tabbed || !isLabelLine(p.text);
      }
    }
    owner = { section: section?.id, item: item?.id };
    place(p.id, owner);
  }

  return { outline: { header: { name: head.name, contact: head.contact }, sections }, groups };
}

/** The header and sections (with items and bullets) derived from the document. Ids are paragraph ids. */
export function outlineFromDoc(doc: DocJSON): Outline {
  return analyze(doc).outline;
}

/**
 * Paragraph membership of the outline, for code that adds or removes whole entries or sections. Keys: every section
 * id and item id from outlineFromDoc, plus "header" (name and contact paragraphs). Values: ids of ALL paragraphs
 * (empty ones included) in document order. A section is its heading plus everything up to the next heading; an
 * item is its first paragraph plus everything up to the next item or heading, so empty paragraphs between entries
 * belong to the preceding item.
 */
export function outlineGroups(doc: DocJSON): Map<string, string[]> {
  return analyze(doc).groups;
}
