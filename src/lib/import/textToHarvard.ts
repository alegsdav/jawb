/**
 * Pasted text (and .txt/.md uploads) after the AI has parsed it into structure: the parsed JSON becomes a document
 * in the Harvard template, the same look the guided builder makes. The input is untrusted model output, so every
 * field is checked, trimmed and capped here; nothing the model returns is rendered as it is.
 */
import { buildDoc, type FlatEntry } from "@/lib/doc/model";
import { emptyResume, withDoc } from "@/lib/resume";
import type { Resume } from "@/lib/types";
import {
  HARVARD_PAGE, harvardBullet, harvardContact, harvardEntry, harvardHeading, harvardLabelLine, harvardName, harvardRole,
} from "@/lib/template";

const MAX_SECTIONS = 30;
const MAX_ITEMS = 40;
const MAX_BULLETS = 30;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A single-line field: a string, whitespace collapsed, trimmed and capped. Anything else is "". */
function field(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** A bullet's text: a field without a leading bullet glyph the model may have kept. */
const bulletText = (v: unknown): string => field(v, 400).replace(/^[•●\-*–]\s+/, "").trim();

type Item = { title: string; subtitle: string; location: string; dates: string; bullets: string[] };
type Section = { title: string; items: Item[] };

function cleanSections(raw: unknown): Section[] {
  return list(obj(raw).sections)
    .slice(0, MAX_SECTIONS)
    .map((s) => {
      const sec = obj(s);
      const items = list(sec.items)
        .slice(0, MAX_ITEMS)
        .map((it) => {
          const x = obj(it);
          return {
            title: field(x.title, 160),
            subtitle: field(x.subtitle, 200),
            location: field(x.location, 100),
            dates: field(x.dates, 80),
            bullets: list(x.bullets).slice(0, MAX_BULLETS).map(bulletText).filter(Boolean),
          };
        })
        .filter((x) => x.title || x.subtitle || x.location || x.dates || x.bullets.length);
      return { title: field(sec.title, 80), items };
    })
    .filter((s) => s.items.length);
}

/** One section's lines: its heading, then each item (entry line, role line, bullets). Items after the first are spaced. */
function sectionLines(sec: Section, out: FlatEntry[]): void {
  if (sec.title) out.push(harvardHeading(sec.title));
  sec.items.forEach((x, i) => {
    const space = i ? 4 : 0;
    if (!x.bullets.length && x.title && x.subtitle && !x.location && !x.dates) {
      // A single labelled line, such as "Languages: Python, SQL".
      out.push(harvardLabelLine(x.title, x.subtitle, { spaceBefore: space }));
      return;
    }
    if (x.title || x.location) out.push(harvardEntry(x.title, x.location, { spaceBefore: space }));
    if (x.subtitle || x.dates) out.push(harvardRole(x.subtitle, x.dates));
    for (const text of x.bullets) out.push(harvardBullet(text));
  });
}

/**
 * The AI's parsed resume as a Harvard-format resume (version 4, the page setup of the builder). Name and contact
 * come first, then one section per parsed section. Sections and items with nothing in them are dropped.
 */
export function harvardFromParsed(raw: unknown): Resume {
  const header = obj(obj(raw).header);
  const name = field(header.name, 100);
  const contact = field(header.contact, 300);
  const lines: FlatEntry[] = [];
  if (name) lines.push(harvardName(name));
  if (contact) lines.push(harvardContact(contact));
  for (const sec of cleanSections(raw)) sectionLines(sec, lines);
  return withDoc({ ...emptyResume(), page: HARVARD_PAGE }, buildDoc(lines));
}
