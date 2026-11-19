import type { Editor } from "@tiptap/react";
import type { EditorState } from "@tiptap/pm/state";
import type { Mark } from "@tiptap/pm/model";
import { outlineFromDoc, outlineGroups } from "@/lib/doc/outline";
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE_PT, DEFAULT_LINE_HEIGHT, type DocJSON } from "@/lib/doc/types";
import type { Align, FormatState, ListKind, DocSelection } from "./editorTypes";

/** The marks of every text run the selection covers; with a caret, the marks typing would use. */
function runMarks(state: EditorState): readonly (readonly Mark[])[] {
  const { from, to, empty, $from } = state.selection;
  if (empty) return [state.storedMarks ?? $from.marks()];
  const runs: (readonly Mark[])[] = [];
  state.doc.nodesBetween(from, to, (node) => {
    if (node.isText) runs.push(node.marks);
    return true;
  });
  return runs.length ? runs : [$from.marks()];
}

const hasMark = (marks: readonly Mark[], name: string) => marks.some((m) => m.type.name === name);

/** The link href on the selection (or at the caret): the one href every text run shares, else null. */
export function linkHref(state: EditorState): string | null {
  const hrefs = runMarks(state).map((marks) => (marks.find((m) => m.type.name === "link")?.attrs.href as string | undefined) ?? null);
  return sameValue(hrefs);
}

/** The distinct values across the runs; a single value, or null when they differ. */
function sameValue<T>(values: T[]): T | null {
  return values.every((v) => v === values[0]) ? values[0] : null;
}

/** Formatting at the selection, with `active` left for the caller to set. */
export function formatAt(editor: Editor): Omit<FormatState, "active"> {
  const { state } = editor;
  const runs = runMarks(state);
  const styles = runs.map((marks) => marks.find((m) => m.type.name === "textStyle")?.attrs ?? {});
  const size = sameValue(styles.map((s) => (s.fontSize ? parseFloat(s.fontSize) : DEFAULT_FONT_SIZE_PT)));
  const family = sameValue(styles.map((s) => (s.fontFamily as string | null) || DEFAULT_FONT_FAMILY));

  const para = state.selection.$from;
  let list: ListKind | null = null;
  for (let d = para.depth; d > 0 && !list; d--) {
    const name = para.node(d).type.name;
    if (name === "bulletList") list = "bullet";
    else if (name === "orderedList") list = "ordered";
  }
  const attrs = para.parent.attrs;

  return {
    bold: runs.length > 0 && runs.every((marks) => hasMark(marks, "bold")),
    italic: runs.length > 0 && runs.every((marks) => hasMark(marks, "italic")),
    underline: runs.length > 0 && runs.every((marks) => hasMark(marks, "underline")),
    fontFamily: family,
    fontSize: size,
    align: ((attrs.textAlign as Align | null) ?? "left"),
    list,
    lineHeight: (attrs.lineHeight as number | null) ?? DEFAULT_LINE_HEIGHT,
    borderBottom: !!attrs.borderBottom,
    link: linkHref(state),
    canUndo: editor.can().undo(),
    canRedo: editor.can().redo(),
  };
}

/**
 * The coaching selection for a paragraph id: the bullet, the entry (item) or the section it belongs to.
 * Null for header paragraphs and anything outside the outline.
 */
export function selectionFor(doc: DocJSON, id: string): DocSelection | null {
  const { sections } = outlineFromDoc(doc);
  const groups = outlineGroups(doc);
  for (const sec of sections) {
    for (const item of sec.items) {
      if (item.bullets.some((b) => b.id === id)) {
        return { kind: "bullet", sectionId: sec.id, entryId: item.id, bulletId: id };
      }
    }
  }
  for (const sec of sections) {
    for (const item of sec.items) {
      if (groups.get(item.id)?.includes(id)) return { kind: "entry", sectionId: sec.id, entryId: item.id };
    }
  }
  for (const sec of sections) {
    if (groups.get(sec.id)?.includes(id)) return { kind: "section", sectionId: sec.id };
  }
  return null;
}
