/**
 * Pasted text (and .txt/.md uploads) after the AI has parsed it into structure: the parsed JSON becomes a document
 * in the Harvard template, the same look the guided builder makes. The input is untrusted model output, so every
 * field is checked, trimmed and capped here; nothing the model returns is rendered as it is.
 */
import { buildDoc, normalizeHref, type FlatEntry } from "@/lib/doc/model";
import type { DocInline, DocMark, DocParagraph } from "@/lib/doc/types";
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

/**
 * An item's header lines: the organization and location on one line, the role and dates on the next. A missing part
 * shortens its line rather than leaving a line with only a right-aligned part: with no role and no location the
 * title and dates share one line, and a missing title or role starts its line with the other part.
 */
function headerLines(x: Item): FlatEntry[] {
  const { title, subtitle, location, dates } = x;
  if (!subtitle && !location) {
    if (title) return [harvardEntry(title, dates)];
    return dates ? [harvardRole(dates, "")] : [];
  }
  const out: FlatEntry[] = [];
  if (title || location) out.push(title ? harvardEntry(title, location) : harvardEntry(location, ""));
  if (subtitle || dates) out.push(subtitle ? harvardRole(subtitle, dates) : harvardRole(dates, ""));
  return out;
}

/** A paragraph with the space above it, as the items after the first in a section get. */
const spacedBy = (e: FlatEntry, space: number): FlatEntry =>
  space ? { ...e, node: { ...e.node, attrs: { ...e.node.attrs, spaceBefore: space } } } : e;

/** One section's lines: its heading, then each item (header lines, bullets). Items after the first are spaced. */
function sectionLines(sec: Section, out: FlatEntry[]): void {
  if (sec.title) out.push(harvardHeading(sec.title));
  sec.items.forEach((x, i) => {
    const space = i ? 4 : 0;
    if (!x.bullets.length && x.title && x.subtitle && !x.location && !x.dates) {
      // A single labelled line, such as "Languages: Python, SQL".
      out.push(harvardLabelLine(x.title, x.subtitle, { spaceBefore: space }));
      return;
    }
    out.push(...headerLines(x).map((e, j) => (j ? e : spacedBy(e, space))));
    for (const text of x.bullets) out.push(harvardBullet(text));
  });
}

/**
 * What a link may point at: a URL, a www. address, an email, or a host with a path (linkedin.com/in/x). A bare
 * host without a path is not one, so "Python (3.11)" stays text.
 */
const TARGET_RE = /^(?:https?:\/\/|www\.|[\w.+-]+@|[\w-]+(?:\.[\w-]+)+\/)/i;

/** The address for a link target, or null when it is not one (see normalizeHref). Emails become mailto: links. */
function hrefOf(target: string): string | null {
  if (!TARGET_RE.test(target)) return null;
  return normalizeHref(/^[\w.+-]+@/.test(target) ? `mailto:${target}` : target);
}

/**
 * Links in text: "Label (address)", a bare http(s):// or www. address, or an email. The pattern for the first is
 * a label of up to 40 characters that stops at a separator, then the address in brackets.
 */
const LINK_RE =
  /([^()•|,;\n]{1,40}?)\s*\(([^\s()]+)\)|((?:https?:\/\/|www\.)[^\s()<>"']*[^\s()<>"'.,;:!?])|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

/** A piece of text, with the address it links to when it is a link. */
type Piece = { text: string; href?: string };

/**
 * The text split at its links. A "Label (address)" pair keeps only the label, linked to the address, as a resume
 * shows a link. Anything that is not a web or mail address is left as text.
 */
function splitLinks(text: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  const plain = (s: string) => {
    if (s) out.push({ text: s });
  };
  for (const m of text.matchAll(LINK_RE)) {
    const at = m.index ?? 0;
    plain(text.slice(last, at));
    last = at + m[0].length;
    if (m[2] !== undefined) {
      const label = m[1].trim();
      const href = label ? hrefOf(m[2]) : null;
      if (!href) {
        plain(m[0]);
        continue;
      }
      plain(m[1].slice(0, m[1].indexOf(label)));
      out.push({ text: label, href });
    } else if (m[3] !== undefined) {
      const href = normalizeHref(m[3]);
      if (href) out.push({ text: m[3], href });
      else plain(m[3]);
    } else {
      out.push({ text: m[4], href: normalizeHref(`mailto:${m[4]}`) ?? undefined });
    }
  }
  plain(text.slice(last));
  return out;
}

/** The paragraph with each text run split at its links, the link pieces marked with a link mark. */
function linkParagraph(node: DocParagraph): DocParagraph {
  if (!node.content) return node;
  const content: DocInline[] = [];
  for (const n of node.content) {
    if (n.type !== "text") {
      content.push(n);
      continue;
    }
    for (const piece of splitLinks(n.text)) {
      const marks: DocMark[] = [...(n.marks ?? [])];
      if (piece.href) marks.push({ type: "link", attrs: { href: piece.href } });
      content.push(marks.length ? { type: "text", text: piece.text, marks } : { type: "text", text: piece.text });
    }
  }
  return { ...node, content };
}

/** A line with its links marked (see splitLinks). */
const linkLine = (e: FlatEntry): FlatEntry => ({ ...e, node: linkParagraph(e.node) });

/**
 * The AI's parsed resume as a Harvard-format resume (version 4, the page setup of the builder). Name and contact
 * come first, then one section per parsed section. Sections and items with nothing in them are dropped. Links in
 * the text (web and mail addresses, and "Label (address)" pairs) become links.
 */
export function harvardFromParsed(raw: unknown): Resume {
  const header = obj(obj(raw).header);
  const name = field(header.name, 100);
  const contact = field(header.contact, 300);
  const lines: FlatEntry[] = [];
  if (name) lines.push(harvardName(name));
  if (contact) lines.push(harvardContact(contact));
  for (const sec of cleanSections(raw)) sectionLines(sec, lines);
  return withDoc({ ...emptyResume(), page: HARVARD_PAGE }, buildDoc(lines.map(linkLine)));
}
