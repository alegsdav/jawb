/**
 * Migration of a version 1-3 resume (normalized to the v3 shape) to the document (version 4). Each line of the old
 * editor becomes one paragraph; consecutive bullets share one bulletList. Ids are deterministic (they come from the
 * stored ids), so migrating the same row twice gives the same document.
 *
 *   name / contact           hdr-name / hdr-contact
 *   heading                  the section id
 *   inline item line         the item id
 *   entry line               the item id          (title ⇥ location)
 *   role line                `${item id}-role`    (subtitle ⇥ dates)
 *   bullet                   the bullet id
 */
import { cleanFormat, DEFAULT_SIZE, joinRich, toRuns, type Rich } from "../richText";
import type { Item, Mark, Para, Resume } from "../types";
import type { DocBlock, DocInline, DocJSON, DocList, DocListItem, DocMark, DocParagraph, ParagraphAttrs } from "./types";

type Line = { p: DocParagraph; bullet: boolean };

/** Uppercases each UTF-16 unit on its own, so the marks' positions stay valid. Units whose upper case differs in length keep their case. */
function upper(text: string): string {
  return text
    .split("")
    .map((c) => {
      const u = c.toUpperCase();
      return u.length === 1 ? u : c;
    })
    .join("");
}

/** Text nodes for `text` with its marks, one node per run (bold, italic, underline, font size). */
function runNodes(text: string, marks: Mark[] | undefined): DocInline[] {
  return toRuns(text, marks).map((run) => {
    const dm: DocMark[] = [];
    if (run.bold) dm.push({ type: "bold" });
    if (run.italic) dm.push({ type: "italic" });
    if (run.underline) dm.push({ type: "underline" });
    if (run.size !== DEFAULT_SIZE) dm.push({ type: "textStyle", attrs: { fontSize: `${run.size}pt` } });
    return dm.length ? { type: "text", text: run.text, marks: dm } : { type: "text", text: run.text };
  });
}

/** One paragraph: the left text, then a tab and the right text when the right part is not empty. */
function line(id: string, left: Rich, right: Rich | undefined, para: Para | undefined): DocParagraph {
  const caps = para?.caps === true;
  const content: DocInline[] = runNodes(caps ? upper(left.text) : left.text, left.marks);
  if (right?.text) {
    content.push({ type: "tab" });
    content.push(...runNodes(caps ? upper(right.text) : right.text, right.marks));
  }
  const attrs: ParagraphAttrs = { id };
  if (para?.align) attrs.textAlign = para.align;
  if (para?.rule) attrs.borderBottom = true;
  if (para?.spaceBefore) attrs.spaceBefore = para.spaceBefore;
  return content.length ? { type: "paragraph", attrs, content } : { type: "paragraph", attrs };
}

/** Same as resume.ts isInlineItem (copied here: resume.ts imports this module). */
const isInlineItem = (it: Item) => !it.bullets.length && !it.dates && !it.location;

/** Groups consecutive bullet lines into one bulletList. */
function group(lines: Line[]): DocBlock[] {
  const out: DocBlock[] = [];
  let open: DocList | undefined;
  for (const { p, bullet } of lines) {
    if (!bullet) {
      open = undefined;
      out.push(p);
      continue;
    }
    if (!open) {
      open = { type: "bulletList", content: [] };
      out.push(open);
    }
    const li: DocListItem = { type: "listItem", content: [p] };
    open.content.push(li);
  }
  return out;
}

/** The document for a version 1-3 resume (already in the v3 shape). */
export function legacyToDoc(r: Resume): DocJSON {
  const lines: Line[] = [];
  const add = (p: DocParagraph, bullet = false) => lines.push({ p, bullet });
  const { name, contact } = r.header;
  const blank = !name && !contact && r.sections.length === 0;
  if (name || blank) add(line("hdr-name", { text: name, marks: r.header.marks?.name }, undefined, r.header.para?.name));
  if (contact || blank) add(line("hdr-contact", { text: contact, marks: r.header.marks?.contact }, undefined, r.header.para?.contact));

  for (const section of r.sections) {
    add(line(section.id, { text: section.title, marks: section.marks }, undefined, section.para));
    for (const item of section.items) {
      if (isInlineItem(item)) {
        const marks = item.marks?.title;
        const rich = item.subtitle
          ? joinRich([
              { text: item.title, marks },
              { text: ": ", marks: separatorMarks(marks, item.title) },
              { text: item.subtitle, marks: item.marks?.subtitle },
            ])
          : { text: item.title, marks };
        add(line(item.id, rich, undefined, item.para?.entry));
        continue;
      }
      add(line(item.id, { text: item.title, marks: item.marks?.title }, { text: item.location, marks: item.marks?.location }, item.para?.entry));
      if (item.subtitle || item.dates) {
        add(line(`${item.id}-role`, { text: item.subtitle, marks: item.marks?.subtitle }, { text: item.dates, marks: item.marks?.dates }, item.para?.role));
      }
      for (const b of item.bullets) add(line(b.id, { text: b.text, marks: b.marks }, undefined, b.para), true);
    }
  }
  const content = group(lines);
  return { type: "doc", content: content.length ? content : [{ type: "paragraph", attrs: { id: "hdr-name" } }] };
}

/** The format of a title's last character, applied to the ": " that joins title and subtitle in one line. */
function separatorMarks(titleMarks: Mark[] | undefined, title: string): Mark[] | undefined {
  if (!title.length || !titleMarks) return undefined;
  const last = title.length - 1;
  const mark = titleMarks.find((m) => m.from <= last && last < m.to);
  const f = cleanFormat(mark);
  return f ? [{ from: 0, to: 2, ...f }] : undefined;
}
