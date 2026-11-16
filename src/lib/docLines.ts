import type { DocLine, LineIds, LineKind, LinePart } from "./docLineTypes";
import { isInlineItem, uid } from "./resume";
import { defaultStyle, effectiveStyle, toggleStyle, type StyleField } from "./textStyle";
import type { Bullet, Item, Resume, Section, TextStyle } from "./types";

/** Pure converter between the structured Resume and the editor's lines. See docLineTypes.ts for the contract. */

const withStyle = (st: TextStyle | undefined): { style?: TextStyle } => (st ? { style: st } : {});
const withStyle2 = (st: TextStyle | undefined): { style2?: TextStyle } => (st ? { style2: st } : {});

/** Lines for a Resume, in document order. Header lines and empty entries are always emitted. */
export function resumeToLines(r: Resume): DocLine[] {
  const hs = r.header.styles;
  const lines: DocLine[] = [
    { kind: "name", text: r.header.name, ...withStyle(hs?.name) },
    { kind: "contact", text: r.header.contact, ...withStyle(hs?.contact) },
  ];
  for (const section of r.sections) {
    lines.push({ kind: "heading", text: section.title, sid: section.id, ...withStyle(section.style) });
    for (const item of section.items) {
      const sid = section.id;
      if (isInlineItem(item)) {
        lines.push({
          kind: "text",
          text: joinInlineText(item.title, item.subtitle),
          sid,
          iid: item.id,
          ...withStyle(item.styles?.title),
          ...withStyle2(item.styles?.subtitle),
        });
        continue;
      }
      lines.push({
        kind: "entry",
        text: item.title,
        right: item.location,
        sid,
        iid: item.id,
        ...withStyle(item.styles?.title),
        ...withStyle2(item.styles?.location),
      });
      if (item.subtitle || item.dates) {
        lines.push({
          kind: "role",
          text: item.subtitle,
          right: item.dates,
          sid,
          iid: item.id,
          ...withStyle(item.styles?.subtitle),
          ...withStyle2(item.styles?.dates),
        });
      }
      for (const b of item.bullets) lines.push({ kind: "bullet", text: b.text, sid, iid: item.id, bid: b.id });
    }
  }
  return lines;
}

type ItemField = keyof NonNullable<Item["styles"]>;

/** Set or clear one field's style on an item, keeping the styles key absent when empty. */
function putStyle(it: Item, field: ItemField, st: TextStyle | undefined): void {
  const styles: NonNullable<Item["styles"]> = { ...it.styles };
  if (st) styles[field] = st;
  else delete styles[field];
  if (Object.keys(styles).length) it.styles = styles;
  else delete it.styles;
}

const newItem = (id: string, title: string, subtitle: string, location: string, dates: string): Item => ({
  id, title, subtitle, location, dates, bullets: [],
});

type Phase = "entry" | "role" | "bullets" | "inline";

/**
 * Rebuild the Resume from the lines, in order. `prev` supplies every other key (version, facts, baseline).
 * `ids[i]` is the id each line resolved to; duplicated or missing ids get fresh ones.
 */
export function linesToResume(lines: DocLine[], prev: Resume): { resume: Resume; ids: LineIds[] } {
  const nameAt = lines.findIndex((l) => l.kind === "name");
  const contactAt = lines.findIndex((l) => l.kind === "contact");
  const ids: LineIds[] = lines.map(() => ({}));
  const taken = { section: new Set<string>(), item: new Set<string>(), bullet: new Set<string>() };
  // The line's id if it is non-empty and unused so far, else a fresh one. Either way it is now taken.
  const claim = (set: Set<string>, id: string | undefined): string => {
    const out = id !== undefined && id !== "" && !set.has(id) ? id : uid();
    set.add(out);
    return out;
  };

  const sections: Section[] = [];
  // Entry-origin items and their lines, for the style fixup at the end.
  const fromEntry = new Map<Item, { entry: DocLine; role?: DocLine }>();
  let section: Section | undefined;
  let item: Item | undefined;
  let phase: Phase = "inline";

  // The current section, or a new untitled one when the lines start before any heading.
  const ensureSection = (line: DocLine): Section => {
    if (!section) {
      section = { id: claim(taken.section, line.sid), title: "", items: [] };
      sections.push(section);
    }
    return section;
  };

  const nameLine = nameAt >= 0 ? lines[nameAt] : undefined;
  const contactLine = contactAt >= 0 ? lines[contactAt] : undefined;
  const headerStyles: NonNullable<Resume["header"]["styles"]> = {};
  if (nameLine?.style) headerStyles.name = nameLine.style;
  if (contactLine?.style) headerStyles.contact = contactLine.style;
  const header: Resume["header"] = {
    name: nameLine?.text ?? "",
    contact: contactLine?.text ?? "",
    ...(Object.keys(headerStyles).length ? { styles: headerStyles } : {}),
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // The first name and contact lines are the header; they carry no ids.
    if (i === nameAt || i === contactAt) continue;

    if (line.kind === "heading") {
      const sec: Section = { id: claim(taken.section, line.sid), title: line.text, items: [], ...withStyle(line.style) };
      sections.push(sec);
      section = sec;
      item = undefined;
      ids[i] = { sid: sec.id };
      continue;
    }

    if (line.kind === "entry") {
      const sec = ensureSection(line);
      const it = newItem(claim(taken.item, line.iid), line.text, "", line.right ?? "", "");
      putStyle(it, "title", line.style);
      putStyle(it, "location", line.style2);
      sec.items.push(it);
      fromEntry.set(it, { entry: line });
      item = it;
      phase = "entry";
      ids[i] = { sid: sec.id, iid: it.id };
      continue;
    }

    if (line.kind === "role") {
      const sec = ensureSection(line);
      let cur: Item;
      if (item && phase === "entry") {
        // The second line of the current entry.
        cur = item;
        cur.subtitle = line.text;
        cur.dates = line.right ?? "";
        putStyle(cur, "subtitle", line.style);
        putStyle(cur, "dates", line.style2);
        const m = fromEntry.get(cur);
        if (m) m.role = line;
      } else {
        cur = newItem(claim(taken.item, line.iid), "", line.text, "", line.right ?? "");
        putStyle(cur, "subtitle", line.style);
        putStyle(cur, "dates", line.style2);
        sec.items.push(cur);
        item = cur;
      }
      phase = "role";
      ids[i] = { sid: sec.id, iid: cur.id };
      continue;
    }

    if (line.kind === "bullet") {
      const sec = ensureSection(line);
      const bullet: Bullet = { id: claim(taken.bullet, line.bid), text: line.text };
      let cur: Item;
      if (item && (phase === "entry" || phase === "role" || phase === "bullets")) {
        cur = item;
        cur.bullets.push(bullet);
      } else {
        cur = newItem(claim(taken.item, line.iid), "", "", "", "");
        cur.bullets.push(bullet);
        sec.items.push(cur);
        item = cur;
      }
      phase = "bullets";
      ids[i] = { sid: sec.id, iid: cur.id, bid: bullet.id };
      continue;
    }

    // text, or a later name/contact line (treated as text).
    const sec = ensureSection(line);
    const it: Item = {
      id: claim(taken.item, line.iid),
      ...splitInlineText(line.text),
      location: "",
      dates: "",
      bullets: [],
    };
    putStyle(it, "title", line.style);
    putStyle(it, "subtitle", line.style2);
    sec.items.push(it);
    item = it;
    phase = "inline";
    ids[i] = { sid: sec.id, iid: it.id };
  }

  // An entry that ended up inline renders with the inline defaults, which differ from the entry's.
  // Store the entry's effective style when it differs, so the document looks the same as before.
  for (const [it, m] of fromEntry) {
    if (!isInlineItem(it)) continue;
    const title = effectiveStyle("title", m.entry.style);
    putStyle(it, "title", differs("title", title, it) ? title : undefined);
    if (m.role) {
      const subtitle = effectiveStyle("subtitle", m.role.style);
      putStyle(it, "subtitle", differs("subtitle", subtitle, it) ? subtitle : undefined);
    }
  }

  return { resume: { ...prev, header, sections }, ids };
}

function differs(field: StyleField, st: Required<TextStyle>, it: Item): boolean {
  const d = defaultStyle(field, it);
  return st.bold !== d.bold || st.italic !== d.italic;
}

/** Split an inline line at the first ": ". No ": " means the whole line is the title. */
export function splitInlineText(text: string): { title: string; subtitle: string } {
  const at = text.indexOf(": ");
  if (at < 0) return { title: text, subtitle: "" };
  return { title: text.slice(0, at), subtitle: text.slice(at + 2) };
}

export function joinInlineText(title: string, subtitle: string): string {
  return subtitle ? `${title}: ${subtitle}` : title;
}

const NEXT_KIND: Record<LineKind, LineKind> = {
  name: "contact",
  contact: "heading",
  heading: "entry",
  entry: "role",
  role: "bullet",
  bullet: "bullet",
  text: "text",
};

/** The kind Enter creates after a line of `kind`. */
export function nextKind(kind: LineKind): LineKind {
  return NEXT_KIND[kind];
}

/** The style field a line part maps to, or null when the part has no styling. */
export function partField(kind: LineKind, part: LinePart): StyleField | null {
  switch (kind) {
    case "name":
      return part === 1 ? "name" : null;
    case "contact":
      return part === 1 ? "contact" : null;
    case "heading":
      return part === 1 ? "sectionTitle" : null;
    case "entry":
      return part === 1 ? "title" : "location";
    case "role":
      return part === 1 ? "subtitle" : "dates";
    case "text":
      return part === 1 ? "title" : "subtitle";
    case "bullet":
      return null;
  }
}

/** The pseudo inline item a text line stands for, so its label is bold only when there are details. */
function textItem(line: DocLine): Item | undefined {
  if (line.kind !== "text") return undefined;
  return { id: "", ...splitInlineText(line.text), location: "", dates: "", bullets: [] };
}

/** The bold/italic a line part shows, defaults included. Null when the part has no styling. */
export function lineEffectiveStyle(line: DocLine, part: LinePart): Required<TextStyle> | null {
  const field = partField(line.kind, part);
  if (!field) return null;
  return effectiveStyle(field, part === 1 ? line.style : line.style2, textItem(line));
}

/** A copy of the line with one part's style replaced (or removed when undefined). */
function withPart(line: DocLine, part: LinePart, st: TextStyle | undefined): DocLine {
  const key = part === 1 ? "style" : "style2";
  const out: DocLine = { ...line };
  delete out[key];
  if (st) out[key] = st;
  return out;
}

/** Flip bold or italic on one part of a line. Returns the same object when the part has no styling. */
export function toggleLineStyle(line: DocLine, part: LinePart, key: "bold" | "italic"): DocLine {
  const field = partField(line.kind, part);
  if (!field) return line;
  const cur = part === 1 ? line.style : line.style2;
  return withPart(line, part, toggleStyle(field, cur, key, textItem(line)));
}

/** Drop a part's override so it uses the default again. Returns the same object when the part has no styling. */
export function resetLineStyle(line: DocLine, part: LinePart): DocLine {
  if (!partField(line.kind, part)) return line;
  return withPart(line, part, undefined);
}
