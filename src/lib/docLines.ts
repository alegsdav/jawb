import type { DocLine, LineIds, LineKind } from "./docLineTypes";
import { isInlineItem, uid } from "./resume";
import { cleanFormat, cleanMarks, cleanPara, joinRich } from "./richText";
import type { Bullet, Item, Mark, Para, Resume, Section } from "./types";

/**
 * Pure converter between the structured Resume and the editor's lines. See docLineTypes.ts for the contract.
 * Formatting is explicit data (marks / para) on both sides, so the lines carry it over unchanged.
 */

type Fmt = { marks?: Mark[]; para?: Para; rightMarks?: Mark[] };

/** The formatting keys of a line, present only when there is something to show. Marks are copied. */
function fmt(marks?: Mark[], para?: Para, rightMarks?: Mark[]): Fmt {
  const out: Fmt = {};
  if (marks?.length) out.marks = marks.map((m) => ({ ...m }));
  if (rightMarks?.length) out.rightMarks = rightMarks.map((m) => ({ ...m }));
  if (para && Object.keys(para).length) out.para = { ...para };
  return out;
}

/**
 * The format of a title's last character, applied to the ": " that joins title and subtitle in one line.
 * None when the title is empty or unformatted at its last character.
 */
function separatorMarks(titleMarks: Mark[] | undefined, title: string): Mark[] | undefined {
  if (!title.length || !titleMarks) return undefined;
  const last = title.length - 1;
  const mark = titleMarks.find((m) => m.from <= last && last < m.to);
  const f = cleanFormat(mark);
  return f ? [{ from: 0, to: 2, ...f }] : undefined;
}

/** One line for an inline item: the title alone, or "title: subtitle" for data from before version 3. */
function inlineLine(item: Item, sid: string): DocLine {
  const para = item.para?.entry;
  if (!item.subtitle) {
    return { kind: "text", text: item.title, sid, iid: item.id, ...fmt(item.marks?.title, para) };
  }
  const rich = joinRich([
    { text: item.title, marks: item.marks?.title },
    { text: ": ", marks: separatorMarks(item.marks?.title, item.title) },
    { text: item.subtitle, marks: item.marks?.subtitle },
  ]);
  return { kind: "text", text: rich.text, sid, iid: item.id, ...fmt(rich.marks, para) };
}

/** Lines for a Resume, in document order. The header lines and empty entries are always emitted when they exist. */
export function resumeToLines(r: Resume): DocLine[] {
  const lines: DocLine[] = [];
  const { name, contact } = r.header;
  // A completely blank resume starts with both header lines.
  const blank = !name && !contact && r.sections.length === 0;
  if (name || blank) lines.push({ kind: "name", text: name, ...fmt(r.header.marks?.name, r.header.para?.name) });
  if (contact || blank) lines.push({ kind: "contact", text: contact, ...fmt(r.header.marks?.contact, r.header.para?.contact) });

  for (const section of r.sections) {
    const sid = section.id;
    lines.push({ kind: "heading", text: section.title, sid, ...fmt(section.marks, section.para) });
    for (const item of section.items) {
      if (isInlineItem(item)) {
        lines.push(inlineLine(item, sid));
        continue;
      }
      lines.push({
        kind: "entry",
        text: item.title,
        right: item.location,
        sid,
        iid: item.id,
        ...fmt(item.marks?.title, item.para?.entry, item.marks?.location),
      });
      if (item.subtitle || item.dates) {
        lines.push({
          kind: "role",
          text: item.subtitle,
          right: item.dates,
          sid,
          iid: item.id,
          ...fmt(item.marks?.subtitle, item.para?.role, item.marks?.dates),
        });
      }
      for (const b of item.bullets) {
        lines.push({ kind: "bullet", text: b.text, sid, iid: item.id, bid: b.id, ...fmt(b.marks, b.para) });
      }
    }
  }
  return lines;
}

type Phase = "entry" | "role" | "bullets" | "inline";
type ItemMarkField = keyof NonNullable<Item["marks"]>;
type ItemParaField = keyof NonNullable<Item["para"]>;

const newItem = (id: string, title: string, subtitle: string, location: string, dates: string): Item => ({
  id, title, subtitle, location, dates, bullets: [],
});

/** Set or clear one inline mark field of an item, keeping the marks key absent when empty. */
function setItemMarks(it: Item, field: ItemMarkField, marks: Mark[] | undefined): void {
  const next: NonNullable<Item["marks"]> = { ...it.marks };
  if (marks) next[field] = marks;
  else delete next[field];
  if (Object.keys(next).length) it.marks = next;
  else delete it.marks;
}

/** Set or clear one paragraph format of an item, keeping the para key absent when empty. */
function setItemPara(it: Item, field: ItemParaField, para: Para | undefined): void {
  const next: NonNullable<Item["para"]> = { ...it.para };
  if (para) next[field] = para;
  else delete next[field];
  if (Object.keys(next).length) it.para = next;
  else delete it.para;
}

/** The entry line's text and right part (title, location) with their formatting. */
function applyEntry(it: Item, line: DocLine): void {
  const right = line.right ?? "";
  it.title = line.text;
  it.location = right;
  setItemMarks(it, "title", cleanMarks(line.marks, line.text.length));
  setItemMarks(it, "location", cleanMarks(line.rightMarks, right.length));
  setItemPara(it, "entry", cleanPara(line.para));
}

/** The role line's text and right part (subtitle, dates) with their formatting. */
function applyRole(it: Item, line: DocLine): void {
  const right = line.right ?? "";
  it.subtitle = line.text;
  it.dates = right;
  setItemMarks(it, "subtitle", cleanMarks(line.marks, line.text.length));
  setItemMarks(it, "dates", cleanMarks(line.rightMarks, right.length));
  setItemPara(it, "role", cleanPara(line.para));
}

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

  // The first name and contact lines are the header; they carry no ids.
  const nameLine = nameAt >= 0 ? lines[nameAt] : undefined;
  const contactLine = contactAt >= 0 ? lines[contactAt] : undefined;
  const header: Resume["header"] = { name: nameLine?.text ?? "", contact: contactLine?.text ?? "" };
  const headerMarks: NonNullable<Resume["header"]["marks"]> = {};
  const headerPara: NonNullable<Resume["header"]["para"]> = {};
  const nm = cleanMarks(nameLine?.marks, header.name.length);
  if (nm) headerMarks.name = nm;
  const cm = cleanMarks(contactLine?.marks, header.contact.length);
  if (cm) headerMarks.contact = cm;
  const np = cleanPara(nameLine?.para);
  if (np) headerPara.name = np;
  const cp = cleanPara(contactLine?.para);
  if (cp) headerPara.contact = cp;
  if (Object.keys(headerMarks).length) header.marks = headerMarks;
  if (Object.keys(headerPara).length) header.para = headerPara;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === nameAt || i === contactAt) continue;

    if (line.kind === "heading") {
      const sec: Section = { id: claim(taken.section, line.sid), title: line.text, items: [] };
      const sm = cleanMarks(line.marks, line.text.length);
      if (sm) sec.marks = sm;
      const sp = cleanPara(line.para);
      if (sp) sec.para = sp;
      sections.push(sec);
      section = sec;
      item = undefined;
      ids[i] = { sid: sec.id };
      continue;
    }

    if (line.kind === "entry") {
      const sec = ensureSection(line);
      const it = newItem(claim(taken.item, line.iid), "", "", "", "");
      applyEntry(it, line);
      sec.items.push(it);
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
      } else {
        cur = newItem(claim(taken.item, line.iid), "", "", "", "");
        sec.items.push(cur);
        item = cur;
      }
      applyRole(cur, line);
      phase = "role";
      ids[i] = { sid: sec.id, iid: cur.id };
      continue;
    }

    if (line.kind === "bullet") {
      const sec = ensureSection(line);
      const bullet: Bullet = { id: claim(taken.bullet, line.bid), text: line.text };
      const bm = cleanMarks(line.marks, line.text.length);
      if (bm) bullet.marks = bm;
      const bp = cleanPara(line.para);
      if (bp) bullet.para = bp;
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

    // text, or a later name/contact line (treated as text): the whole line is the inline item's title.
    const sec = ensureSection(line);
    const it = newItem(claim(taken.item, line.iid), "", "", "", "");
    applyEntry(it, line);
    sec.items.push(it);
    item = it;
    phase = "inline";
    ids[i] = { sid: sec.id, iid: it.id };
  }

  const out: Resume = { ...prev, header, sections };
  // Version 2 keys (styles, style) are never written back.
  const legacy = out as Resume & { styles?: unknown; style?: unknown };
  delete legacy.styles;
  delete legacy.style;
  return { resume: out, ids };
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
