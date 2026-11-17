import { baseKeymap, toggleMark } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { Fragment, Slice, type Mark as PMMark, type Node as PMNode, type ResolvedPos } from "prosemirror-model";
import { Plugin, Selection, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import type { Align, FormatState, MarkName } from "../components/editorTypes";
import type { LineKind, LinePart } from "./docLineTypes";
import { nextKind } from "./docLines";
import { docSchema, lineToNode, partAtOffset, textToLines } from "./pmSchema";
import { DEFAULT_SIZE, MAX_SIZE, MIN_SIZE, cleanPara } from "./richText";
import type { Para } from "./types";

/**
 * Editing commands for the resume text editor (Google-Docs-like). The document is a list of lines; a line's
 * kind says what it IS, its marks and para say how it looks. Any line can be any kind: the only structural
 * rules are "one name, one contact" (headerGuard) and "entry/role lines have one tab".
 * See docLineTypes.ts for the line kinds and pmSchema.ts for the node and mark shapes.
 */

const lineType = docSchema.nodes.line;
const tabType = docSchema.nodes.tab;

const hasTab = (kind: LineKind) => kind === "entry" || kind === "role";
const isHeader = (kind: LineKind) => kind === "name" || kind === "contact";
const isEntryOrRole = (kind: LineKind) => hasTab(kind);

/** Points added or removed by the "space before" toggle. */
const SPACE_BEFORE_PT = 6;

export type CaretInfo = { index: number; pos: number; line: PMNode; kind: LineKind; offset: number; part: LinePart | null };

/** A top-level line: its index, its start position in the doc (before its node token) and the node. */
export type LineRef = { index: number; pos: number; node: PMNode };

/** The line holding a position in the doc. pos is the line's start, before its node token. */
function infoAt(doc: PMNode, $pos: ResolvedPos): CaretInfo {
  const index = $pos.index(0);
  let pos = 0;
  for (let i = 0; i < index; i++) pos += doc.child(i).nodeSize;
  const line = doc.child(index);
  const kind = line.attrs.kind as LineKind;
  const offset = $pos.parentOffset;
  return { index, pos, line, kind, offset, part: partAtOffset(line, offset) };
}

export function caretInfo(state: EditorState): CaretInfo {
  return infoAt(state.doc, state.selection.$from);
}

/** Content offset of the first tab in a line, or null. */
function tabOffset(line: PMNode): number | null {
  let off = 0;
  for (let i = 0; i < line.childCount; i++) {
    const child = line.child(i);
    if (child.type === tabType) return off;
    off += child.nodeSize;
  }
  return null;
}

/**
 * A new empty line of a kind, with the given paragraph formatting and no ids. A header kind (name, contact)
 * becomes "text": the line is a copy of an existing header line, and there is only one of each.
 */
function freshLine(kind: LineKind, para?: unknown): PMNode {
  const k: LineKind = isHeader(kind) ? "text" : kind;
  return lineType.create({ kind: k, para: para ?? null }, hasTab(k) ? tabType.create() : null);
}

/**
 * Makes the tabs in the line at pos match the kind: one tab for entry/role (added at the end when missing),
 * none otherwise. Extra tabs become a space. Edits tr in place; the line's own position is unchanged.
 */
function fixTabs(tr: Transaction, pos: number, kind: LineKind): void {
  const line = tr.doc.nodeAt(pos);
  if (!line) return;
  const tabs: number[] = [];
  let off = 0;
  for (let i = 0; i < line.childCount; i++) {
    const child = line.child(i);
    if (child.type === tabType) tabs.push(off);
    off += child.nodeSize;
  }
  if (hasTab(kind) && tabs.length === 0) tr.insert(pos + line.nodeSize - 1, tabType.create());
  const extra = hasTab(kind) ? tabs.slice(1) : tabs;
  // Last first. Each swap keeps the size, so the earlier offsets stay valid.
  for (const o of extra.reverse()) tr.replaceWith(pos + 1 + o, pos + 2 + o, docSchema.text(" "));
}

const setCaret = (tr: Transaction, at: number): Transaction => tr.setSelection(TextSelection.create(tr.doc, at));

function finish(tr: Transaction, dispatch?: (tr: Transaction) => void): boolean {
  if (dispatch) {
    tr.scrollIntoView();
    dispatch(tr);
  }
  return true;
}

/**
 * The top-level lines a selection touches, in document order. An empty selection touches the caret's line.
 * Works for AllSelection too (it covers every line).
 */
export function linesInSelection(state: EditorState): LineRef[] {
  const { doc, selection } = state;
  const { from, to } = selection;
  const out: LineRef[] = [];
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const node = doc.child(i);
    const end = pos + node.nodeSize;
    // A caret touches the line it is in. A range counts a line only when it reaches past the line's first
    // content position, so a range that ends at offset 0 of the next line leaves that line out (as in Docs).
    const hit = from === to ? pos <= from && from < end : from < end && to > pos + 1;
    if (hit) out.push({ index: i, pos, node });
    pos = end;
  }
  if (!out.length) {
    // Clamp: a position past the last line touches the last line.
    const index = doc.childCount - 1;
    out.push({ index, pos: doc.content.size - doc.child(index).nodeSize, node: doc.child(index) });
  }
  return out;
}

/** Repairs the header lines and the tabs of every line. Returns null when nothing needs fixing. */
function repairTransaction(state: EditorState): Transaction | null {
  const doc = state.doc;

  // The first name and the first contact (in document order) stay; later ones become text.
  const kinds: LineKind[] = [];
  let seenName = false;
  let seenContact = false;
  for (let i = 0; i < doc.childCount; i++) {
    let kind = doc.child(i).attrs.kind as LineKind;
    if (kind === "name") {
      if (seenName) kind = "text";
      seenName = true;
    } else if (kind === "contact") {
      if (seenContact) kind = "text";
      seenContact = true;
    }
    kinds.push(kind);
  }

  const tr = state.tr;
  const starts: number[] = [];
  let p = 0;
  for (let i = 0; i < doc.childCount; i++) {
    starts.push(p);
    p += doc.child(i).nodeSize;
  }

  // From last to first, so the positions of the earlier lines stay valid.
  for (let i = doc.childCount - 1; i >= 0; i--) {
    const pos = starts[i];
    fixTabs(tr, pos, kinds[i]);
    const line = tr.doc.nodeAt(pos);
    if (line && line.attrs.kind !== kinds[i]) tr.setNodeMarkup(pos, undefined, { ...line.attrs, kind: kinds[i] });
  }

  if (!tr.docChanged) return null;

  // Keep the selection where it was. A caret that a tab was inserted at stays before the tab (assoc -1).
  const sel = state.selection;
  if (sel instanceof TextSelection) {
    const anchor = tr.mapping.map(sel.anchor, -1);
    const head = tr.mapping.map(sel.head, -1);
    const valid = tr.doc.resolve(anchor).depth === 1 && tr.doc.resolve(head).depth === 1;
    tr.setSelection(valid ? TextSelection.create(tr.doc, anchor, head) : Selection.atStart(tr.doc));
  } else {
    tr.setSelection(sel.map(tr.doc, tr.mapping));
  }
  return tr;
}

/** Keeps the header lines and the tabs valid after any change. Runs once per changing transaction. */
export const headerGuard: Plugin = new Plugin({
  appendTransaction(trs, _oldState, newState) {
    if (!trs.some((tr) => tr.docChanged)) return null;
    return repairTransaction(newState);
  },
});

export const enterCommand: Command = (state, dispatch) => {
  const tr = state.tr;
  if (!state.selection.empty) tr.deleteSelection();
  // Deleting an AllSelection (or a selection across lines) can leave the caret outside a line: start of the first line.
  if (!(tr.selection instanceof TextSelection) || tr.selection.$from.depth !== 1) setCaret(tr, 1);
  const { $from } = tr.selection as TextSelection;
  const { index, pos, line, kind, offset } = infoAt(tr.doc, $from);
  const empty = line.textContent === "";

  // a. An empty bullet becomes an entry, like leaving a list in Docs. Its paragraph formatting stays.
  if (kind === "bullet" && empty) {
    tr.setNodeMarkup(pos, undefined, { ...line.attrs, kind: "entry", sid: null, iid: null, bid: null });
    tr.insert(pos + 1, tabType.create());
    return finish(setCaret(tr, pos + 1), dispatch);
  }

  // b. Enter at the start of a non-empty line adds an empty line of the same kind before it.
  if (offset === 0 && !empty) {
    const fresh = freshLine(kind, line.attrs.para);
    tr.insert(pos, fresh);
    return finish(setCaret(tr, pos + fresh.nodeSize + 1), dispatch);
  }

  // c. Entry or role, caret at or before the tab: the text between the caret and the tab moves to a new line.
  const tabOff = tabOffset(line);
  if (isEntryOrRole(kind) && tabOff !== null && offset <= tabOff) {
    const moved = line.content.cut(offset, tabOff);
    // An entry whose subtitle line already exists: just go there, do not split the entry again.
    if (moved.size === 0 && kind === "entry" && tr.doc.maybeChild(index + 1)?.attrs.kind === "role") {
      return finish(setCaret(tr, pos + line.nodeSize + 1), dispatch);
    }
    const next = nextKind(kind);
    const content = hasTab(next) ? moved.addToEnd(tabType.create()) : moved;
    const newLine = lineType.create({ kind: next, para: line.attrs.para ?? null }, content);
    tr.delete(pos + 1 + offset, pos + 1 + tabOff);
    const insertAt = pos + line.nodeSize - (tabOff - offset);
    tr.insert(insertAt, newLine);
    return finish(setCaret(tr, insertAt + 1), dispatch);
  }

  // d. Otherwise split the line at the caret. The new line keeps the paragraph formatting, not the ids.
  const newKind = nextKind(kind);
  const headerTaken = isHeader(newKind) && hasOtherKind(tr.doc, newKind, index);
  const splitKind: LineKind = headerTaken ? "text" : newKind;
  const caretPos = pos + 1 + offset;
  tr.split(caretPos, 1, [{ type: lineType, attrs: { kind: splitKind, para: line.attrs.para ?? null } }]);
  return finish(setCaret(tr, caretPos + 2), dispatch);
};

/** Whether a line other than the one at `except` has this kind. */
function hasOtherKind(doc: PMNode, kind: LineKind, except: number): boolean {
  for (let i = 0; i < doc.childCount; i++) {
    if (i !== except && doc.child(i).attrs.kind === kind) return true;
  }
  return false;
}

export const backspaceCommand: Command = (state, dispatch) => {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.depth !== 1) return false;
  const { index, pos, line, kind, offset } = infoAt(state.doc, $from);
  const tr = state.tr;

  // The caret is right after a tab: move it in front of the tab instead of deleting it.
  const before = $from.nodeBefore;
  if (before && before.type === tabType) return finish(setCaret(tr, pos + offset), dispatch);

  if (offset !== 0) return false;

  // The start of the document: nothing to join or delete, even when the first line is empty (as in Docs).
  if (index === 0) return true;

  // An empty line goes (unless it is the only line). The caret goes to the end of the line above,
  // or to the start of the next line when it was the first.
  if (line.textContent === "" && state.doc.childCount > 1) {
    tr.delete(pos, pos + line.nodeSize);
    return finish(setCaret(tr, index > 0 ? pos - 1 : 1), dispatch);
  }

  // A bullet becomes plain text, like leaving a list in Docs.
  if (kind === "bullet") {
    tr.setNodeMarkup(pos, undefined, { ...line.attrs, kind: "text", bid: null });
    return finish(setCaret(tr, pos + 1), dispatch);
  }

  // Two filled entry/role lines join with a space between them (not "NYCEng 2020").
  if (index > 0) {
    const prev = state.doc.child(index - 1);
    const prevKind = prev.attrs.kind as LineKind;
    if (isEntryOrRole(prevKind) && isEntryOrRole(kind) && prev.textContent !== "" && line.textContent !== "") {
      tr.join(pos);
      // After the join, the join point is pos - 1: the end of the previous line's text.
      tr.insert(pos - 1, docSchema.text(" "));
      return finish(setCaret(tr, pos), dispatch);
    }
  }

  return false;
};

export const deleteCommand: Command = (state, dispatch) => {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.depth !== 1) return false;
  const { index, pos, line, offset } = infoAt(state.doc, $from);
  const tr = state.tr;

  // The caret is right before a tab: move it past the tab.
  const after = $from.nodeAfter;
  if (after && after.type === tabType) return finish(setCaret(tr, pos + offset + 2), dispatch);

  // At the end of an empty line (not the last): the line goes, the caret goes to the start of the line below.
  if (offset !== line.content.size || line.textContent !== "") return false;
  if (index >= state.doc.childCount - 1) return false;
  tr.delete(pos, pos + line.nodeSize);
  return finish(setCaret(tr, pos + 1), dispatch);
};

export const tabCommand: Command = (state, dispatch) => {
  const info = caretInfo(state);
  if (!hasTab(info.kind)) return true;
  const tabOff = tabOffset(info.line);
  if (tabOff === null) return true;
  // At or before the tab: go past it. After it: go to the end of the line.
  const target = info.offset <= tabOff ? info.pos + tabOff + 2 : info.pos + info.line.nodeSize - 1;
  return finish(setCaret(state.tr, target), dispatch);
};

export const shiftTabCommand: Command = (state, dispatch) => {
  const info = caretInfo(state);
  if (!hasTab(info.kind)) return true;
  const tabOff = tabOffset(info.line);
  if (tabOff === null) return true;
  return finish(setCaret(state.tr, info.pos + tabOff + 1), dispatch);
};

/** Sets the paragraph formatting of each line through an edit of a copy of its para. Positions do not change. */
function setParaOf(tr: Transaction, lines: LineRef[], edit: (p: Para) => void): void {
  for (const { pos, node } of lines) {
    const p: Para = { ...(cleanPara(node.attrs.para) ?? {}) };
    edit(p);
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, para: cleanPara(p) ?? null });
  }
}

/** Bold, italic or underline on the selection; with a caret, on what you type next. */
export function toggleMarkCommand(name: MarkName): Command {
  // On a mixed range the mark is added to all of it (Docs); a range that is all marked loses it.
  const cmd = toggleMark(docSchema.marks[name], null, { removeWhenPresent: false });
  return (state, dispatch) => {
    cmd(state, dispatch);
    return true;
  };
}

/** Font size in points. 11 (the default) removes the size mark. Clamped to [8, 28], one decimal. */
export function setSizeCommand(pt: number): Command {
  return (state, dispatch) => {
    if (!Number.isFinite(pt)) return false;
    const size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(pt * 10) / 10));
    const type = docSchema.marks.size;
    const tr = state.tr;
    const { from, to, empty } = state.selection;
    if (empty) {
      tr.removeStoredMark(type);
      if (size !== DEFAULT_SIZE) tr.addStoredMark(type.create({ pt: size }));
    } else {
      tr.removeMark(from, to, type);
      if (size !== DEFAULT_SIZE) tr.addMark(from, to, type.create({ pt: size }));
    }
    return finish(tr, dispatch);
  };
}

/** Aligns every line the selection touches. "left" removes the alignment. */
export function setAlignCommand(align: Align): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    setParaOf(tr, linesInSelection(state), (p) => {
      if (align === "left") delete p.align;
      else p.align = align;
    });
    return finish(tr, dispatch);
  };
}

/** The rule line or ALL CAPS: on if any touched line lacks it, otherwise off (like Docs). */
export function toggleParaFlagCommand(flag: "rule" | "caps"): Command {
  return (state, dispatch) => {
    const lines = linesInSelection(state);
    const on = lines.some(({ node }) => !cleanPara(node.attrs.para)?.[flag]);
    const tr = state.tr;
    setParaOf(tr, lines, (p) => {
      if (on) p[flag] = true;
      else delete p[flag];
    });
    return finish(tr, dispatch);
  };
}

/** Extra space above: on if any touched line lacks it, otherwise off. */
export function toggleSpaceBeforeCommand(): Command {
  return (state, dispatch) => {
    const lines = linesInSelection(state);
    const on = lines.some(({ node }) => !cleanPara(node.attrs.para)?.spaceBefore);
    const tr = state.tr;
    setParaOf(tr, lines, (p) => {
      if (on) p.spaceBefore = SPACE_BEFORE_PT;
      else delete p.spaceBefore;
    });
    return finish(tr, dispatch);
  };
}

/** Removes every inline mark in the selection (and the stored marks), and the paragraph formatting of the lines it touches. */
export function clearFormattingCommand(): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    const { from, to, empty } = state.selection;
    if (empty) tr.setStoredMarks([]);
    else tr.removeMark(from, to);
    for (const { pos, node } of linesInSelection(state)) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, para: null });
    }
    return finish(tr, dispatch);
  };
}

/**
 * Changes the kind of every line the selection touches. A line keeps its ids and paragraph formatting; the
 * bullet id is kept only for bullets; entry/role get their tab, other kinds lose tabs (to a space).
 * name and contact apply to the first touched line only, and any other line of that kind becomes text.
 */
export function setLineKindCommand(kind: LineKind): Command {
  return (state, dispatch) => {
    const touched = linesInSelection(state);
    type Change = LineRef & { next: LineKind };
    const changes: Change[] = [];

    if (isHeader(kind)) {
      const first = touched[0];
      if (first.node.attrs.kind !== kind) changes.push({ ...first, next: kind });
      state.doc.forEach((node, offset, index) => {
        if (index !== first.index && node.attrs.kind === kind) changes.push({ index, pos: offset, node, next: "text" });
      });
    } else {
      for (const t of touched) {
        if (t.node.attrs.kind !== kind) changes.push({ ...t, next: kind });
      }
    }

    const tr = state.tr;
    // From last to first, so the positions of the earlier lines stay valid.
    changes.sort((a, b) => b.pos - a.pos);
    for (const c of changes) {
      fixTabs(tr, c.pos, c.next);
      const line = tr.doc.nodeAt(c.pos);
      if (!line) continue;
      tr.setNodeMarkup(c.pos, undefined, {
        ...line.attrs,
        kind: c.next,
        bid: c.next === "bullet" ? line.attrs.bid : null,
      });
    }
    return finish(tr, dispatch);
  };
}

/** Formatting state at the selection, for the toolbar and the Format menu. active is added by the page. */
export function formatAt(state: EditorState): Omit<FormatState, "active"> {
  const { doc, selection } = state;
  const info = caretInfo(state);
  const para = cleanPara(info.line.attrs.para);
  const base = {
    lineKind: info.kind,
    align: (para?.align ?? "left") as Align,
    rule: !!para?.rule,
    caps: !!para?.caps,
    spaceBefore: !!para?.spaceBefore,
  };

  // The marks of the text in a range (tabs are not text). With a caret, or a range with no text: the marks typing would get.
  const texts = selection.empty ? [] : textMarksIn(doc, selection.from, selection.to);
  if (!texts.length) {
    const marks = state.storedMarks ?? selection.$from.marks();
    return {
      ...base,
      bold: hasMark(marks, "bold"),
      italic: hasMark(marks, "italic"),
      underline: hasMark(marks, "underline"),
      size: sizeOf(marks),
    };
  }

  const sizes = texts.map(sizeOf);
  return {
    ...base,
    bold: texts.every((m) => hasMark(m, "bold")),
    italic: texts.every((m) => hasMark(m, "italic")),
    underline: texts.every((m) => hasMark(m, "underline")),
    size: sizes.every((s) => s === sizes[0]) ? sizes[0] : null,
  };
}

/** The marks of each text node overlapping [from, to]. */
function textMarksIn(doc: PMNode, from: number, to: number): (readonly PMMark[])[] {
  const out: (readonly PMMark[])[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) {
      const overlap = Math.min(to, pos + node.nodeSize) - Math.max(from, pos);
      if (overlap > 0) out.push(node.marks);
    }
    return true;
  });
  return out;
}

const hasMark = (marks: readonly PMMark[], name: MarkName) => marks.some((m) => m.type.name === name);

/** The point size of a set of marks; the default size when there is no size mark. */
function sizeOf(marks: readonly PMMark[]): number {
  const mark = marks.find((m) => m.type.name === "size");
  return mark ? Number(mark.attrs.pt) : DEFAULT_SIZE;
}

/** Replaces the text of the bullet (or other line) whose id is bid. Used by "Accept suggestion" / "Revert". The new text has no marks. */
export function replaceLineTextCommand(bid: string, text: string): Command {
  return (state, dispatch) => {
    let pos = 0;
    let target: { pos: number; node: PMNode } | null = null;
    for (let i = 0; i < state.doc.childCount; i++) {
      const node = state.doc.child(i);
      if (node.attrs.bid === bid) {
        target = { pos, node };
        break;
      }
      pos += node.nodeSize;
    }
    if (!target) return false;
    const tr = state.tr.replaceWith(
      target.pos + 1,
      target.pos + target.node.nodeSize - 1,
      text ? docSchema.text(text) : Fragment.empty,
    );
    return finish(setCaret(tr, target.pos + 1 + text.length), dispatch);
  };
}

export function editorKeymap(): Plugin[] {
  return [
    keymap({
      Enter: enterCommand,
      Backspace: backspaceCommand,
      "Shift-Backspace": backspaceCommand,
      Delete: deleteCommand,
      Tab: tabCommand,
      "Shift-Tab": shiftTabCommand,
      "Mod-b": toggleMarkCommand("bold"),
      "Mod-i": toggleMarkCommand("italic"),
      "Mod-u": toggleMarkCommand("underline"),
      "Mod-Shift-l": setAlignCommand("left"),
      "Mod-Shift-e": setAlignCommand("center"),
      "Mod-Shift-r": setAlignCommand("right"),
      "Mod-Shift-j": setAlignCommand("justify"),
      "Mod-\\": clearFormattingCommand(),
    }),
    keymap(baseKeymap),
  ];
}

/** Pasted text as a slice. A single plain line stays inline; anything else opens both ends. */
export function pasteTextParser(text: string): Slice {
  const lines = textToLines(text);
  if (lines.length === 0) return Slice.empty;
  if (lines.length === 1 && lines[0].kind === "text") {
    return new Slice(Fragment.from(docSchema.text(lines[0].text)), 0, 0);
  }
  return new Slice(Fragment.from(lines.map(lineToNode)), 1, 1);
}

/** The same slice with the line ids cleared, so pasted lines get fresh ids. Marks and paragraph formatting stay. */
export function stripPastedIds(slice: Slice): Slice {
  const out: PMNode[] = [];
  slice.content.forEach((node) => {
    out.push(
      node.type === lineType
        ? lineType.create({ ...node.attrs, sid: null, iid: null, bid: null }, node.content, node.marks)
        : node,
    );
  });
  return new Slice(Fragment.fromArray(out), slice.openStart, slice.openEnd);
}
