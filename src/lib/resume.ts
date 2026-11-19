import { effectiveStyle, cleanStyle } from "./textStyle";
import { TEMPLATE } from "./template";
import { cleanMarks, cleanPara, wholeMarks, type Format } from "./richText";
import type { Bullet, Item, Resume, Section, TextStyle } from "./types";
import { emptyDoc, flattenDoc, newId, normalizeDoc } from "./doc/model";
import { outlineFromDoc } from "./doc/outline";
import { legacyToDoc } from "./doc/legacy";
import type { DocJSON, FlatParagraph, PageSetup } from "./doc/types";

export const uid = () => Math.random().toString(36).slice(2, 10);

export const emptyItem = (): Item => ({
  id: uid(), title: "", subtitle: "", location: "", dates: "", bullets: [{ id: uid(), text: "" }],
});

export const emptySection = (title = "Section"): Section => ({
  id: uid(), title, items: [emptyItem()],
});

/**
 * 4 = the resume is a document (`doc`, see ./doc/types.ts); `header` and `sections` are derived from it.
 * Older data is migrated by normalizeResume: versions 1-3 are read as before and then converted to a document
 * (see ./doc/legacy.ts). Version 3 = explicit formatting (marks/para); version 2 = Harvard look implied by field;
 * version 1 also swaps the title and subtitle of entries.
 */
export const RESUME_VERSION = 4;

/** A resume with the document `doc` and the structure derived from it (header, sections). */
export function withDoc(r: Resume, doc: DocJSON): Resume {
  return { ...r, version: 4, doc, ...outlineFromDoc(doc) };
}

/** The resume's document: `doc` when present, else converted from the structured fields (versions 1-3). */
export function resumeDoc(r: Resume): DocJSON {
  return r.doc ?? legacyToDoc(r);
}

export const emptyResume = (): Resume => withDoc({ header: { name: "", contact: "" }, sections: [] }, emptyDoc());

export function isEmptyResume(r: Resume): boolean {
  return flattenDoc(resumeDoc(r)).every((p) => !p.text.trim());
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const idOf = (v: unknown): string => (typeof v === "string" && v ? v : uid());

/** A copy of `o` without its undefined-valued keys; undefined when nothing is left. */
export function compact<T extends object>(o: T): T | undefined {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== undefined) out[k] = o[k];
  return Object.keys(out).length ? (out as T) : undefined;
}

/** A Format with the effective bold/italic in place of `base`'s (false means regular, so it is dropped). */
function formatWith(base: Format, st: Required<TextStyle>): Format {
  return { ...base, bold: st.bold ? true : undefined, italic: st.italic ? true : undefined };
}

/** The item's inline formatting: explicit marks (version 3) or the implied v2 look made explicit. */
function itemMarks(raw: Obj, it: Item, legacy: boolean): Item["marks"] {
  const st = obj(raw.styles);
  const field = (k: "title" | "subtitle" | "location" | "dates") =>
    legacy
      ? wholeMarks(it[k], formatWith({}, effectiveStyle(k, cleanStyle(st[k]), it)))
      : cleanMarks(obj(raw.marks)[k], it[k].length);
  return compact({ title: field("title"), subtitle: field("subtitle"), location: field("location"), dates: field("dates") });
}

/** The item's paragraph formatting: explicit (version 3), or the template's spacing for a non-inline entry (v2). */
function itemPara(raw: Obj, it: Item, legacy: boolean): Item["para"] {
  if (legacy) return isInlineItem(it) ? undefined : compact({ entry: cleanPara(TEMPLATE.entry.para) });
  const p = obj(raw.para);
  return compact({ entry: cleanPara(p.entry), role: cleanPara(p.role) });
}

/** Facts, baseline and page setup: kept as stored (cleaned) on any version. */
function carryMeta(src: Obj, out: Resume): void {
  if (Array.isArray(src.facts)) out.facts = src.facts.filter((f): f is string => typeof f === "string");
  const base = src.baseline;
  if (typeof base === "object" && base !== null && !Array.isArray(base)) {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(base)) if (typeof v === "string") clean[k] = v;
    out.baseline = clean;
  }
  setOpt(out, "page", cleanPage(src.page));
}

/** Margins in inches, all four required and within 0-2; otherwise undefined (PAGE_DEFAULTS apply). */
function cleanPage(raw: unknown): PageSetup | undefined {
  const p = obj(raw);
  const ok = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 2;
  const { marginTop, marginBottom, marginLeft, marginRight } = p;
  if (!ok(marginTop) || !ok(marginBottom) || !ok(marginLeft) || !ok(marginRight)) return undefined;
  return { marginTop, marginBottom, marginLeft, marginRight };
}

/**
 * Any stored resume as a version 4 resume: `doc` is read as is (version 4 data), otherwise the structured
 * fields of versions 1-3 are read and converted to a document. Ids are kept, so re-reading gives the same result.
 */
export function normalizeResume(raw: unknown): Resume {
  const r = obj(raw);
  const version = typeof r.version === "number" ? r.version : 1;
  if (version >= 4 && typeof r.doc === "object" && r.doc !== null && !Array.isArray(r.doc)) {
    const base: Resume = { header: { name: "", contact: "" }, sections: [] };
    carryMeta(r, base);
    return withDoc(base, normalizeDoc(r.doc));
  }
  const v3 = normalizeV3(r, version);
  carryMeta(r, v3);
  return withDoc(v3, normalizeDoc(legacyToDoc(v3)));
}

/** Reads a version 1-3 resume into the version 3 shape (the structured fields, before the document). */
function normalizeV3(r: Obj, version: number): Resume {
  const swapTitles = version < 2; // v1 stored role in title and organization in subtitle; Harvard puts the organization first.
  const legacy = version < 3; // v2 and older: formatting is implied by field, so make it explicit.

  const header = obj(r.header);
  const hs = obj(header.styles);
  const name = str(header.name);
  const contact = str(header.contact);
  const out: Resume = { version: 3, header: { name, contact }, sections: [] };
  if (legacy) {
    setOpt(out.header, "marks", compact({
      name: wholeMarks(name, formatWith(TEMPLATE.name.format, effectiveStyle("name", cleanStyle(hs.name)))),
      contact: wholeMarks(contact, formatWith(TEMPLATE.contact.format, effectiveStyle("contact", cleanStyle(hs.contact)))),
    }));
    setOpt(out.header, "para", compact({ name: cleanPara(TEMPLATE.name.para), contact: cleanPara(TEMPLATE.contact.para) }));
  } else {
    setOpt(out.header, "marks", compact({
      name: cleanMarks(obj(header.marks).name, name.length),
      contact: cleanMarks(obj(header.marks).contact, contact.length),
    }));
    setOpt(out.header, "para", compact({ name: cleanPara(obj(header.para).name), contact: cleanPara(obj(header.para).contact) }));
  }
  out.sections = arr(r.sections).map((sv) => {
    const sec = obj(sv);
    const title = str(sec.title);
    const section: Section = { id: idOf(sec.id), title, items: arr(sec.items).map((itv) => normalizeItem(obj(itv), swapTitles, legacy)) };
    if (legacy) {
      setOpt(section, "marks", wholeMarks(title, formatWith(TEMPLATE.heading.format, effectiveStyle("sectionTitle", cleanStyle(sec.style)))));
      setOpt(section, "para", cleanPara(TEMPLATE.heading.para));
    } else {
      setOpt(section, "marks", cleanMarks(sec.marks, title.length));
      setOpt(section, "para", cleanPara(sec.para));
    }
    return section;
  });
  return out;
}

/** Set `key` on `node`, or leave it out when `value` is undefined. */
export function setOpt<T extends object, K extends keyof T>(node: T, key: K, value: T[K] | undefined): void {
  if (value === undefined) delete (node as Partial<T>)[key];
  else node[key] = value;
}

function normalizeItem(raw: Obj, swapTitles: boolean, legacy: boolean): Item {
  const title0 = str(raw.title);
  const subtitle0 = str(raw.subtitle);
  const swap = swapTitles && Boolean(raw.dates || raw.location) && Boolean(subtitle0);
  const it: Item = {
    id: idOf(raw.id),
    title: swap ? subtitle0 : title0,
    subtitle: swap ? title0 : subtitle0,
    location: str(raw.location),
    dates: str(raw.dates),
    bullets: arr(raw.bullets).map((b) => normalizeBullet(b, legacy)),
  };
  setOpt(it, "marks", itemMarks(raw, it, legacy));
  setOpt(it, "para", itemPara(raw, it, legacy));
  return it;
}

function normalizeBullet(v: unknown, legacy: boolean): Bullet {
  if (typeof v === "string") return { id: uid(), text: v };
  const b = obj(v);
  const text = str(b.text);
  if (legacy) return { id: idOf(b.id), text };
  const bullet: Bullet = { id: idOf(b.id), text };
  setOpt(bullet, "marks", cleanMarks(b.marks, text.length));
  setOpt(bullet, "para", cleanPara(b.para));
  return bullet;
}

/** True when an item renders as a single inline line (skills, publications, memberships). */
export const isInlineItem = (it: Item) => !it.bullets.length && !it.dates && !it.location;

/**
 * Plain-text rendering with bullet ids, used in AI prompts. Plain text only: formatting never reaches the AI.
 * An inline item is one line: its title, then ": subtitle" when it has one (data from before version 3).
 */
export function resumeToPromptText(r: Resume): string {
  const lines = [r.header.name, r.header.contact, ""];
  for (const s of r.sections) {
    lines.push(`## ${s.title}`);
    for (const it of s.items) {
      const head = isInlineItem(it)
        ? [it.title, it.subtitle].filter(Boolean).join(": ")
        : [it.title, it.subtitle, it.location, it.dates].filter(Boolean).join(" | ");
      if (head) lines.push(`- ${head}`);
      for (const b of it.bullets) if (b.text.trim()) lines.push(`    [b:${b.id}] ${b.text}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Plain text for copy/paste into application forms. */
export function resumeToPlainText(r: Resume): string {
  return resumeToPromptText(r).replace(/\[b:[^\]]+\] /g, "• ");
}

export function bulletTextMap(r: Resume): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of r.sections) for (const it of s.items) for (const b of it.bullets) m.set(b.id, b.text);
  return m;
}

/** Number of bullets in `r` whose text differs from the master bullet with the same id (new bullets count too). */
export function countChangedBullets(r: Resume, master: Map<string, string>): number {
  let n = 0;
  for (const [id, text] of bulletTextMap(r)) if (master.get(id) !== text) n++;
  return n;
}

const wordSet = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]+/g) ?? []);

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

/** Paragraph wording counts as "the same paragraph, edited" at or above this word overlap. */
const SIMILAR = 0.5;

/**
 * Greedy one-to-one matching: repeatedly take the highest-scoring (next, prev) pair whose score is
 * at least `min`, skipping indexes already matched. Ties go to the earliest pair, so order breaks ties.
 */
function greedyMatch<A, B>(
  nexts: A[],
  prevs: B[],
  score: (a: A, b: B) => number,
  min: number,
  matched: Map<number, number>,
): void {
  const usedPrev = new Set(matched.values());
  const pairs: { i: number; j: number; s: number }[] = [];
  nexts.forEach((a, i) => {
    if (matched.has(i)) return;
    prevs.forEach((b, j) => {
      if (usedPrev.has(j)) return;
      const s = score(a, b);
      if (s >= min) pairs.push({ i, j, s });
    });
  });
  pairs.sort((x, y) => y.s - x.s || x.i - y.i || x.j - y.j);
  for (const { i, j } of pairs) {
    if (matched.has(i) || usedPrev.has(j)) continue;
    matched.set(i, j);
    usedPrev.add(j);
  }
}

/**
 * Pairs each paragraph of `next` with the paragraph of `prev` it is: identical text first, then the closest wording.
 * Only paragraphs that are both list items or both not are compared. Each `prev` paragraph is used at most once.
 */
function matchParagraphs(next: FlatParagraph[], prev: FlatParagraph[]): Map<number, number> {
  const m = new Map<number, number>();
  const nIdx = next.map((_, i) => i);
  const pIdx = prev.map((_, j) => j);
  const sameKind = (i: number, j: number) => (next[i].listType !== null) === (prev[j].listType !== null);
  greedyMatch(nIdx, pIdx, (i, j) => (sameKind(i, j) && next[i].text === prev[j].text ? 1 : 0), 1, m);
  const nw = next.map((p) => wordSet(p.text));
  const pw = prev.map((p) => wordSet(p.text));
  greedyMatch(nIdx, pIdx, (i, j) => (sameKind(i, j) ? jaccard(nw[i], pw[j]) : 0), SIMILAR, m);
  return m;
}

/**
 * After a re-import, give each paragraph of `next` the id of the paragraph of `prev` it matches (matchParagraphs), so
 * facts, AI feedback and tailored copies stay linked to the paragraphs they were about. Unmatched paragraphs keep their
 * own ids, or get fresh ones when those are taken, so no id is ever used twice. `next`'s page is kept; the previous
 * version's legacy `facts` JSON is kept as stored (facts live in their own table, migration 0005).
 */
export function reconcileIds(prev: Resume, next: Resume): Resume {
  const prevParas = flattenDoc(resumeDoc(prev));
  const doc = structuredClone(resumeDoc(next));
  const nextParas = flattenDoc(doc);
  const matched = matchParagraphs(nextParas, prevParas);
  const taken = new Set([...matched.values()].map((j) => prevParas[j].id));
  nextParas.forEach((p, i) => {
    const j = matched.get(i);
    let id = j === undefined ? p.id : prevParas[j].id;
    if (j === undefined && (!id || taken.has(id))) {
      do id = newId();
      while (taken.has(id));
    }
    taken.add(id);
    p.node.attrs = { ...p.node.attrs, id };
  });
  const out: Resume = { ...next };
  setOpt(out, "facts", prev.facts);
  return withDoc(out, doc);
}

/** The bullet with new text: its marks belonged to the old text, so they go; the paragraph stays. */
export function withBulletText(b: Bullet, text: string): Bullet {
  const out: Bullet = { ...b, text };
  setOpt(out, "marks", undefined);
  return out;
}
