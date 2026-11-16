import { baseKeymap } from "prosemirror-commands";
import { keymap } from "prosemirror-keymap";
import { Fragment, Slice, type Node as PMNode, type ResolvedPos } from "prosemirror-model";
import { Plugin, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import type { LineKind, LinePart } from "./docLineTypes";
import { nextKind, resetLineStyle, toggleLineStyle } from "./docLines";
import { docSchema, lineToNode, nodeToLine, partAtOffset, textToLines } from "./pmSchema";

/** Editing commands for the resume text editor. See docLineTypes.ts for the line kinds. */

const lineType = docSchema.nodes.line;
const tabType = docSchema.nodes.tab;

const hasTab = (kind: LineKind) => kind === "entry" || kind === "role";

export type CaretInfo = { index: number; pos: number; line: PMNode; kind: LineKind; offset: number; part: LinePart | null };

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

/** A new empty line of this kind: one tab for entry/role, no ids or styles. */
function emptyLine(kind: LineKind): PMNode {
  return lineType.create({ kind }, hasTab(kind) ? tabType.create() : null);
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

/** Repairs the header lines and the tabs of every line. Returns null when nothing needs fixing. */
function repairTransaction(state: EditorState): Transaction | null {
  const tr = state.tr;
  const doc = state.doc;

  // Fewer than two lines: add empty ones at the end. They already have their header kinds.
  for (let i = doc.childCount; i < 2; i++) {
    tr.insert(tr.doc.content.size, lineType.create({ kind: i === 0 ? "name" : "contact" }));
  }

  const starts: number[] = [];
  let p = 0;
  for (let i = 0; i < doc.childCount; i++) {
    starts.push(p);
    p += doc.child(i).nodeSize;
  }

  // From last to first, so the positions of the earlier lines stay valid.
  for (let i = doc.childCount - 1; i >= 0; i--) {
    const node = doc.child(i);
    const pos = starts[i];
    const current = node.attrs.kind as LineKind;
    let kind: LineKind = current;
    if (i === 0) kind = "name";
    else if (i === 1) kind = "contact";
    else if (current === "name" || current === "contact") kind = "text";

    fixTabs(tr, pos, kind);

    const attrs: Record<string, unknown> = { ...node.attrs, kind };
    if (i < 2) {
      attrs.sid = null;
      attrs.iid = null;
      attrs.bid = null;
    }
    if (kind === "bullet") {
      attrs.style = null;
      attrs.style2 = null;
    }
    if (Object.keys(attrs).some((k) => attrs[k] !== node.attrs[k])) tr.setNodeMarkup(pos, undefined, attrs);
  }

  if (!tr.docChanged) return null;
  // Keep the caret where it was, before any tab inserted at the caret.
  const sel = state.selection;
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(sel.anchor, -1), tr.mapping.map(sel.head, -1)));
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
  const { $from } = tr.selection;
  if ($from.depth !== 1) return false;
  const { index, pos, line, kind, offset } = infoAt(tr.doc, $from);
  const empty = line.textContent === "";

  // a. The name line: Enter moves to the contact line.
  if (index === 0) return finish(setCaret(tr, pos + line.nodeSize + 1), dispatch);

  // b. The contact line: use the empty line after it, or add a heading.
  if (index === 1) {
    const afterPos = pos + line.nodeSize;
    const next = tr.doc.childCount > 2 ? tr.doc.child(2) : null;
    if (!next || next.textContent !== "") tr.insert(afterPos, lineType.create({ kind: "heading" }));
    return finish(setCaret(tr, afterPos + 1), dispatch);
  }

  // c. An empty bullet becomes an entry, like leaving a list in Docs.
  if (kind === "bullet" && empty) {
    tr.setNodeMarkup(pos, undefined, { kind: "entry", sid: null, iid: null, bid: null, style: null, style2: null });
    tr.insert(pos + 1, tabType.create());
    return finish(setCaret(tr, pos + 1), dispatch);
  }

  // d. Enter at the start of a line adds an empty line of the same kind before it.
  if (offset === 0 && !empty) {
    const fresh = emptyLine(kind);
    tr.insert(pos, fresh);
    return finish(setCaret(tr, pos + fresh.nodeSize + 1), dispatch);
  }

  // e. Enter in an entry or role's left part: the text after the caret moves to a new line below.
  const tabOff = tabOffset(line);
  if (hasTab(kind) && tabOff !== null && offset <= tabOff) {
    const moved = line.content.cut(offset, tabOff);
    const next = nextKind(kind);
    const content = hasTab(next) ? moved.addToEnd(tabType.create()) : moved;
    const newLine = lineType.create({ kind: next }, content);
    tr.delete(pos + 1 + offset, pos + 1 + tabOff);
    const insertAt = pos + line.nodeSize - (tabOff - offset);
    tr.insert(insertAt, newLine);
    return finish(setCaret(tr, insertAt + 1), dispatch);
  }

  // f. Otherwise split the line. headerGuard fixes the new line's tab, if it needs one.
  const caretPos = pos + 1 + offset;
  tr.split(caretPos, 1, [{ type: lineType, attrs: { kind: nextKind(kind) } }]);
  return finish(setCaret(tr, caretPos + 2), dispatch);
};

export const backspaceCommand: Command = (state, dispatch) => {
  const { selection } = state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.depth !== 1) return false;
  const { index, pos, line, offset } = infoAt(state.doc, $from);
  const tr = state.tr;

  // The caret is right after a tab: move it in front of the tab instead of deleting it.
  const before = $from.nodeBefore;
  if (before && before.type === tabType) return finish(setCaret(tr, pos + offset), dispatch);

  if (offset !== 0) return false;
  if (index <= 1) return true;

  if (line.textContent === "") {
    // An empty line goes; the caret goes to the end of the line above.
    tr.delete(pos, pos + line.nodeSize);
    return finish(setCaret(tr, pos - 1), dispatch);
  }
  if (index === 2) return true;
  if (line.attrs.kind === "bullet") {
    tr.setNodeMarkup(pos, undefined, { ...line.attrs, kind: "text", bid: null });
    return finish(setCaret(tr, pos + 1), dispatch);
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

  if (offset !== line.content.size) return false;
  if (index <= 1) return true;
  if (line.textContent !== "") return false;

  // An empty line goes; the caret goes to the start of the line below, or the end of the line above.
  tr.delete(pos, pos + line.nodeSize);
  const hasNext = index + 1 < state.doc.childCount;
  return finish(setCaret(tr, hasNext ? pos + 1 : pos - 1), dispatch);
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

/** Puts a line's new part styles on the line node, keeping its other attrs. */
function setPartStyles(state: EditorState, info: CaretInfo, next: { style?: unknown; style2?: unknown }): Transaction {
  return state.tr.setNodeMarkup(info.pos, undefined, {
    ...info.line.attrs,
    style: next.style ?? null,
    style2: next.style2 ?? null,
  });
}

export function toggleStyleCommand(key: "bold" | "italic"): Command {
  return (state, dispatch) => {
    const info = caretInfo(state);
    if (info.part === null) return true;
    const next = toggleLineStyle(nodeToLine(info.line), info.part, key);
    return finish(setPartStyles(state, info, next), dispatch);
  };
}

export const resetStyleCommand: Command = (state, dispatch) => {
  const info = caretInfo(state);
  if (info.part === null) return true;
  const next = resetLineStyle(nodeToLine(info.line), info.part);
  return finish(setPartStyles(state, info, next), dispatch);
};

export function setLineKindCommand(kind: LineKind): Command {
  return (state, dispatch) => {
    if (kind === "name" || kind === "contact") return false;
    const { $from, $to } = state.selection;
    const first = Math.max(2, $from.index(0));
    const last = $to.index(0);
    if (last < first) return false;

    const starts: number[] = [];
    let p = 0;
    for (let i = 0; i < state.doc.childCount; i++) {
      starts.push(p);
      p += state.doc.child(i).nodeSize;
    }

    const tr = state.tr;
    // From last to first, so the positions of the earlier lines stay valid.
    for (let i = last; i >= first; i--) {
      const node = state.doc.child(i);
      if (node.attrs.kind === kind) continue;
      const pos = starts[i];
      fixTabs(tr, pos, kind);
      tr.setNodeMarkup(pos, undefined, {
        kind,
        sid: node.attrs.sid,
        iid: node.attrs.iid,
        bid: kind === "bullet" ? node.attrs.bid : null,
        style: null,
        style2: null,
      });
    }
    return finish(tr, dispatch);
  };
}

/** Replaces the text of the bullet (or other line) whose id is bid. Used by "Accept suggestion" / "Revert". */
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
      Delete: deleteCommand,
      Tab: tabCommand,
      "Shift-Tab": shiftTabCommand,
      "Mod-b": toggleStyleCommand("bold"),
      "Mod-i": toggleStyleCommand("italic"),
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

/** The same slice with the line ids cleared, so pasted lines get fresh ids. */
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
