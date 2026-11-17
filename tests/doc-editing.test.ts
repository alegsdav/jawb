import { describe, it, expect, vi, afterEach } from "vitest";
import { Fragment, Slice, type Node as PMNode } from "prosemirror-model";
import { AllSelection, EditorState, TextSelection, type Command } from "prosemirror-state";
import {
  caretInfo, headerGuard, enterCommand, backspaceCommand, deleteCommand, tabCommand, shiftTabCommand,
  toggleMarkCommand, setSizeCommand, setAlignCommand, toggleParaFlagCommand, toggleSpaceBeforeCommand,
  clearFormattingCommand, setLineKindCommand, formatAt, linesInSelection, replaceLineTextCommand, editorKeymap,
  pasteTextParser, stripPastedIds,
} from "../src/lib/docEditing";
import { docSchema, docToLines, linesToDoc, lineToNode } from "../src/lib/pmSchema";
import type { DocLine } from "../src/lib/docLineTypes";

afterEach(() => {
  vi.restoreAllMocks();
});

const HEADER: DocLine[] = [
  { kind: "name", text: "Ada" },
  { kind: "contact", text: "London" },
];

/** Doc position of (line index, offset inside the line). */
function docPos(doc: PMNode, index: number, offset: number): number {
  let p = 0;
  for (let i = 0; i < index; i++) p += doc.child(i).nodeSize;
  return p + 1 + offset;
}

/** A state from a doc, with the guard plugin and a caret (or a range) given as line/offset pairs. */
function stateOf(doc: PMNode, at: [number, number], to?: [number, number]): EditorState {
  const from = docPos(doc, at[0], at[1]);
  const head = to ? docPos(doc, to[0], to[1]) : from;
  return EditorState.create({ doc, plugins: [headerGuard], selection: TextSelection.create(doc, from, head) });
}

const make = (lines: DocLine[], at: [number, number], to?: [number, number]) => stateOf(linesToDoc(lines), at, to);

/** Runs a command and returns its result and the state after it. */
function run(state: EditorState, cmd: Command): { ok: boolean; state: EditorState } {
  let s = state;
  const ok = cmd(state, (tr) => {
    s = s.apply(tr);
  });
  return { ok, state: s };
}

/** A change that leaves the text as it was, so the guard runs. */
function touch(s: EditorState): EditorState {
  const tr = s.tr.insertText("~", 1);
  return s.apply(tr.delete(1, 2));
}

const lines = (s: EditorState) => docToLines(s.doc);
const caret = (s: EditorState) => {
  const c = caretInfo(s);
  return { index: c.index, offset: c.offset };
};

// Lines used by the Enter, Backspace and Delete tests.
const DOC: DocLine[] = [
  ...HEADER,
  { kind: "heading", text: "EXPERIENCE" },
  { kind: "entry", text: "Acme", right: "Remote" },
  { kind: "role", text: "Engineer", right: "2020" },
  { kind: "bullet", text: "Built it", bid: "b1" },
  { kind: "text", text: "Languages: EN" },
];

describe("caretInfo", () => {
  it("reports the line, offset and part under the caret", () => {
    const s = make(DOC, [3, 6]);
    const c = caretInfo(s);
    expect(c.index).toBe(3);
    expect(c.kind).toBe("entry");
    expect(c.offset).toBe(6);
    expect(c.part).toBe(2);
    expect(c.pos).toBe(docPos(s.doc, 3, 0) - 1);
  });

  it("reports part 1 on a bullet (every kind has part 1)", () => {
    expect(caretInfo(make(DOC, [5, 2])).part).toBe(1);
  });
});

describe("linesInSelection", () => {
  it("returns the caret's line for an empty selection", () => {
    expect(linesInSelection(make(DOC, [3, 2])).map((l) => l.index)).toEqual([3]);
  });

  it("returns every line a range touches", () => {
    expect(linesInSelection(make(DOC, [2, 3], [4, 1])).map((l) => l.index)).toEqual([2, 3, 4]);
  });

  it("leaves out a line that a range ends at offset 0 of", () => {
    const doc: DocLine[] = [{ kind: "text", text: "aaa" }, { kind: "text", text: "bbb" }];
    expect(linesInSelection(make(doc, [0, 1], [1, 0])).map((l) => l.index)).toEqual([0]);
  });

  it("includes a line that a range reaches past offset 0 of", () => {
    const doc: DocLine[] = [{ kind: "text", text: "aaa" }, { kind: "text", text: "bbb" }];
    expect(linesInSelection(make(doc, [0, 1], [1, 1])).map((l) => l.index)).toEqual([0, 1]);
  });

  it("leaves out an empty last line that a range ends at offset 0 of (the range reaches no content in it)", () => {
    const doc: DocLine[] = [{ kind: "text", text: "aaa" }, { kind: "text", text: "" }];
    expect(linesInSelection(make(doc, [0, 1], [1, 0])).map((l) => l.index)).toEqual([0]);
  });

  it("includes an empty last line when the caret is on it", () => {
    const doc: DocLine[] = [{ kind: "text", text: "aaa" }, { kind: "text", text: "" }];
    expect(linesInSelection(make(doc, [1, 0])).map((l) => l.index)).toEqual([1]);
  });

  it("includes an empty line that a range runs through", () => {
    const doc: DocLine[] = [{ kind: "text", text: "" }, { kind: "text", text: "bbb" }];
    expect(linesInSelection(make(doc, [0, 0], [1, 2])).map((l) => l.index)).toEqual([0, 1]);
  });

  it("returns every line for AllSelection", () => {
    const s = EditorState.create({ doc: linesToDoc(DOC), plugins: [headerGuard] });
    const withAll = s.apply(s.tr.setSelection(new AllSelection(s.doc)));
    expect(linesInSelection(withAll).map((l) => l.index)).toEqual(DOC.map((_, i) => i));
  });
});

describe("headerGuard", () => {
  it("keeps the first name and turns a later one into text", () => {
    const doc = linesToDoc([...HEADER, { kind: "name", text: "Other" }]);
    expect(lines(touch(stateOf(doc, [0, 0])))[2]).toEqual({ kind: "text", text: "Other" });
    expect(lines(touch(stateOf(doc, [0, 0])))[0]).toEqual({ kind: "name", text: "Ada" });
  });

  it("turns a second contact into text", () => {
    const doc = linesToDoc([...HEADER, { kind: "contact", text: "Paris" }]);
    expect(lines(touch(stateOf(doc, [0, 0])))[2]).toEqual({ kind: "text", text: "Paris" });
  });

  it("does not force header kinds: a single text line stays a text line", () => {
    const s = touch(make([{ kind: "text", text: "A" }], [0, 0]));
    expect(lines(s)).toEqual([{ kind: "text", text: "A" }]);
  });

  it("turns a tab in a bullet into a space", () => {
    const bullet = docSchema.nodes.line.create({ kind: "bullet" }, [
      docSchema.text("Left"), tabType(), docSchema.text("Right"),
    ]);
    const doc = docSchema.node("doc", null, [lineToNode(HEADER[0]), lineToNode(HEADER[1]), bullet]);
    expect(lines(touch(stateOf(doc, [0, 0])))[2]).toEqual({ kind: "bullet", text: "Left Right" });
  });

  it("gives an entry without a tab one at the end", () => {
    const entry = docSchema.nodes.line.create({ kind: "entry" }, docSchema.text("Acme"));
    const doc = docSchema.node("doc", null, [lineToNode(HEADER[0]), lineToNode(HEADER[1]), entry]);
    expect(lines(touch(stateOf(doc, [0, 0])))[2]).toEqual({ kind: "entry", text: "Acme", right: "" });
  });

  it("replaces the extra tab of a role with a space", () => {
    const role = docSchema.nodes.line.create({ kind: "role" }, [
      docSchema.text("Eng"), tabType(), docSchema.text("2020"), tabType(), docSchema.text("now"),
    ]);
    const doc = docSchema.node("doc", null, [lineToNode(HEADER[0]), lineToNode(HEADER[1]), role]);
    expect(lines(touch(stateOf(doc, [0, 0])))[2]).toEqual({ kind: "role", text: "Eng", right: "2020 now" });
  });

  it("keeps the caret before the tab it inserts at the caret's line end", () => {
    const entry = docSchema.nodes.line.create({ kind: "entry" }, docSchema.text("Acme"));
    const doc = docSchema.node("doc", null, [lineToNode(HEADER[0]), lineToNode(HEADER[1]), entry]);
    const s = touch(stateOf(doc, [2, 4]));
    expect(caret(s)).toEqual({ index: 2, offset: 4 });
  });

  it("AllSelection survives a guard fix without an invalid-selection warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entry = docSchema.nodes.line.create({ kind: "entry" }, docSchema.text("Acme"));
    const doc = docSchema.node("doc", null, [lineToNode(HEADER[0]), entry]);
    const s = EditorState.create({ doc, plugins: [headerGuard], selection: new AllSelection(doc) });
    const out = s.apply(s.tr.insertText("~", 1).delete(1, 2));
    expect(out.selection).toBeInstanceOf(AllSelection);
    expect(lines(out)[1]).toEqual({ kind: "entry", text: "Acme", right: "" });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("enterCommand", () => {
  it("at the end of the name with an empty contact line after it: the caret moves there, no new line", () => {
    const doc: DocLine[] = [{ kind: "name", text: "Ada" }, { kind: "contact", text: "" }, { kind: "heading", text: "S" }];
    const r = run(make(doc, [0, 3]), enterCommand);
    expect(lines(r.state)).toEqual(doc);
    expect(caret(r.state)).toEqual({ index: 1, offset: 0 });
  });

  it("at the end of an empty name with an empty contact after it: the caret moves to the contact", () => {
    const doc: DocLine[] = [{ kind: "name", text: "" }, { kind: "contact", text: "" }];
    const r = run(make(doc, [0, 0]), enterCommand);
    expect(lines(r.state)).toEqual(doc);
    expect(caret(r.state)).toEqual({ index: 1, offset: 0 });
  });

  it("typing from scratch: name, Enter, email lands in the contact line, not a text line below it", () => {
    const empty: DocLine[] = [{ kind: "name", text: "" }, { kind: "contact", text: "" }];
    let s = make(empty, [0, 0]);
    s = s.apply(s.tr.insertText("Ada"));
    s = run(s, enterCommand).state;
    s = s.apply(s.tr.insertText("ada@example.com"));
    expect(lines(s)).toEqual([{ kind: "name", text: "Ada" }, { kind: "contact", text: "ada@example.com" }]);
  });

  it("at the end of a contact line, Enter adds a text line, not a heading", () => {
    const doc: DocLine[] = [...HEADER, { kind: "heading", text: "S" }];
    const r = run(make(doc, [1, 6]), enterCommand);
    expect(lines(r.state)).toEqual([...HEADER.slice(0, 1), { kind: "contact", text: "London" }, { kind: "text", text: "" }, { kind: "heading", text: "S" }]);
    expect(caret(r.state)).toEqual({ index: 2, offset: 0 });
  });

  it("in the middle of the name splits it: the new line is text, since a contact exists", () => {
    const r = run(make(DOC, [0, 2]), enterCommand);
    expect(r.ok).toBe(true);
    expect(lines(r.state)[0]).toEqual({ kind: "name", text: "Ad" });
    expect(lines(r.state)[1]).toEqual({ kind: "text", text: "a" });
    expect(lines(r.state)[2]).toEqual({ kind: "contact", text: "London" });
    expect(caret(r.state)).toEqual({ index: 1, offset: 0 });
  });

  it("at the end of a name with no contact after it: the new line is a contact", () => {
    const r = run(make([{ kind: "name", text: "Ada" }], [0, 3]), enterCommand);
    expect(lines(r.state)).toEqual([{ kind: "name", text: "Ada" }, { kind: "contact", text: "" }]);
  });

  it("d: at the start of an empty-or-not bullet adds an empty bullet before it", () => {
    const r = run(make(DOC, [5, 0]), enterCommand);
    expect(lines(r.state)[5]).toEqual({ kind: "bullet", text: "" });
    expect(lines(r.state)[6]).toEqual({ kind: "bullet", text: "Built it", bid: "b1" });
    expect(caret(r.state)).toEqual({ index: 6, offset: 0 });
  });

  it("at the start of the name line adds an empty text line, not a second name", () => {
    const r = run(make(DOC, [0, 0]), enterCommand);
    expect(lines(r.state)[0]).toEqual({ kind: "text", text: "" });
    expect(lines(r.state)[1]).toEqual({ kind: "name", text: "Ada" });
    expect(caret(r.state)).toEqual({ index: 1, offset: 0 });
  });

  it("d: at the start of an entry adds an empty entry with a tab", () => {
    const r = run(make(DOC, [3, 0]), enterCommand);
    expect(lines(r.state)[3]).toEqual({ kind: "entry", text: "", right: "" });
    expect(lines(r.state)[4]).toEqual({ kind: "entry", text: "Acme", right: "Remote" });
    expect(caret(r.state)).toEqual({ index: 4, offset: 0 });
  });

  it("c: at the end of an entry's title with a role line after it, the caret moves to the role line", () => {
    const r = run(make(DOC, [3, 4]), enterCommand);
    expect(lines(r.state)).toEqual(DOC);
    expect(caret(r.state)).toEqual({ index: 4, offset: 0 });
  });

  it("c: at the end of an entry's title with no role after it, adds an empty role", () => {
    const doc: DocLine[] = [...HEADER, { kind: "entry", text: "Acme", right: "Remote" }, { kind: "text", text: "X" }];
    const r = run(make(doc, [2, 4]), enterCommand);
    expect(lines(r.state)[2]).toEqual({ kind: "entry", text: "Acme", right: "Remote" });
    expect(lines(r.state)[3]).toEqual({ kind: "role", text: "", right: "" });
    expect(lines(r.state)[4]).toEqual({ kind: "text", text: "X" });
    expect(caret(r.state)).toEqual({ index: 3, offset: 0 });
  });

  it("c: in the middle of an entry's title moves the rest to a new role line", () => {
    const r = run(make(DOC, [3, 2]), enterCommand);
    expect(lines(r.state)[3]).toEqual({ kind: "entry", text: "Ac", right: "Remote" });
    expect(lines(r.state)[4]).toEqual({ kind: "role", text: "me", right: "" });
    expect(lines(r.state)[5]).toEqual({ kind: "role", text: "Engineer", right: "2020" });
    expect(caret(r.state)).toEqual({ index: 4, offset: 0 });
  });

  it("c: a role's left part moves the rest to a new bullet", () => {
    const r = run(make(DOC, [4, 1]), enterCommand);
    expect(lines(r.state)[4]).toEqual({ kind: "role", text: "E", right: "2020" });
    expect(lines(r.state)[5]).toEqual({ kind: "bullet", text: "ngineer" });
    expect(lines(r.state)[6]).toEqual({ kind: "bullet", text: "Built it", bid: "b1" });
    expect(caret(r.state)).toEqual({ index: 5, offset: 0 });
  });

  it("splits a text line at the caret", () => {
    const r = run(make(DOC, [6, 4]), enterCommand);
    expect(lines(r.state)[6]).toEqual({ kind: "text", text: "Lang" });
    expect(lines(r.state)[7]).toEqual({ kind: "text", text: "uages: EN" });
    expect(caret(r.state)).toEqual({ index: 7, offset: 0 });
  });

  it("at the end of a heading adds an entry, with its tab", () => {
    const r = run(make(DOC, [2, 10]), enterCommand);
    expect(lines(r.state)[2]).toEqual({ kind: "heading", text: "EXPERIENCE" });
    expect(lines(r.state)[3]).toEqual({ kind: "entry", text: "", right: "" });
    expect(caret(r.state)).toEqual({ index: 3, offset: 0 });
  });

  it("in the middle of a bullet keeps the bid on the first half only", () => {
    const r = run(make(DOC, [5, 5]), enterCommand);
    expect(lines(r.state)[5]).toEqual({ kind: "bullet", text: "Built", bid: "b1" });
    expect(lines(r.state)[6]).toEqual({ kind: "bullet", text: " it" });
    expect(caret(r.state)).toEqual({ index: 6, offset: 0 });
  });

  it("an empty bullet becomes an entry with a tab", () => {
    const doc: DocLine[] = [...HEADER, { kind: "bullet", text: "", bid: "b1" }];
    const r = run(make(doc, [2, 0]), enterCommand);
    expect(lines(r.state)[2]).toEqual({ kind: "entry", text: "", right: "" });
    expect(caret(r.state)).toEqual({ index: 2, offset: 0 });
  });

  it("keeps the paragraph formatting on the new line", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "Hello", para: { align: "center" } }];
    const r = run(make(doc, [2, 2]), enterCommand);
    expect(lines(r.state)[2]).toEqual({ kind: "text", text: "He", para: { align: "center" } });
    expect(lines(r.state)[3]).toEqual({ kind: "text", text: "llo", para: { align: "center" } });
  });

  it("deletes a selection before splitting", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "Hello world" }];
    const r = run(make(doc, [2, 0], [2, 6]), enterCommand);
    expect(lines(r.state)).toEqual([...HEADER, { kind: "text", text: "" }, { kind: "text", text: "world" }]);
    expect(caret(r.state)).toEqual({ index: 3, offset: 0 });
  });

  it("with AllSelection does not throw and leaves a valid doc", () => {
    const s = EditorState.create({ doc: linesToDoc(DOC), plugins: [headerGuard] });
    const withAll = s.apply(s.tr.setSelection(new AllSelection(s.doc)));
    const r = run(withAll, enterCommand);
    expect(r.ok).toBe(true);
    expect(r.state.doc.childCount).toBeGreaterThanOrEqual(1);
    expect(() => caretInfo(r.state)).not.toThrow();
  });
});

describe("backspaceCommand", () => {
  it("after a tab moves the caret in front of the tab", () => {
    const r = run(make(DOC, [3, 5]), backspaceCommand);
    expect(r.ok).toBe(true);
    expect(lines(r.state)).toEqual(DOC);
    expect(caret(r.state)).toEqual({ index: 3, offset: 4 });
  });

  it("deletes an empty line and puts the caret at the end of the line above", () => {
    const doc: DocLine[] = [...HEADER, { kind: "heading", text: "EXP" }, { kind: "text", text: "" }, { kind: "text", text: "X" }];
    const r = run(make(doc, [3, 0]), backspaceCommand);
    expect(lines(r.state)).toEqual([...HEADER, { kind: "heading", text: "EXP" }, { kind: "text", text: "X" }]);
    expect(caret(r.state)).toEqual({ index: 2, offset: 3 });
  });

  it("does nothing at the start of the document, even on an empty first line", () => {
    const doc: DocLine[] = [{ kind: "text", text: "" }, { kind: "text", text: "X" }];
    const r = run(make(doc, [0, 0]), backspaceCommand);
    expect(r.ok).toBe(true);
    expect(lines(r.state)).toEqual(doc);
    expect(caret(r.state)).toEqual({ index: 0, offset: 0 });
  });

  it("does nothing at the start of a filled first line", () => {
    const doc: DocLine[] = [{ kind: "text", text: "Hi" }, { kind: "text", text: "X" }];
    const r = run(make(doc, [0, 0]), backspaceCommand);
    expect(r.ok).toBe(true);
    expect(lines(r.state)).toEqual(doc);
  });

  it("turns a bullet into text at offset 0", () => {
    const doc: DocLine[] = [...HEADER, { kind: "heading", text: "EXP" }, { kind: "bullet", text: "Built", bid: "b1" }];
    const r = run(make(doc, [3, 0]), backspaceCommand);
    expect(lines(r.state)[3]).toEqual({ kind: "text", text: "Built" });
    expect(caret(r.state)).toEqual({ index: 3, offset: 0 });
  });

  it("joins two filled entry/role lines with a space (no glue)", () => {
    const doc: DocLine[] = [...HEADER, { kind: "entry", text: "Acme", right: "NYC" }, { kind: "role", text: "Eng", right: "2020" }];
    const r = run(make(doc, [3, 0]), backspaceCommand);
    expect(r.ok).toBe(true);
    expect(lines(r.state)).toEqual([...HEADER, { kind: "entry", text: "Acme", right: "NYC Eng 2020" }]);
    expect(caret(r.state)).toEqual({ index: 2, offset: 9 });
  });

  it("leaves a join of a text line into a heading to the default", () => {
    const doc: DocLine[] = [...HEADER, { kind: "heading", text: "EXP" }, { kind: "text", text: "Lang" }];
    const r = run(make(doc, [3, 0]), backspaceCommand);
    expect(r.ok).toBe(false);
    expect(lines(r.state)).toEqual(doc);
  });

  it("returns false for a non-empty selection", () => {
    expect(run(make(DOC, [6, 0], [6, 4]), backspaceCommand).ok).toBe(false);
  });
});

describe("deleteCommand", () => {
  it("before a tab moves the caret past the tab", () => {
    const r = run(make(DOC, [3, 4]), deleteCommand);
    expect(r.ok).toBe(true);
    expect(lines(r.state)).toEqual(DOC);
    expect(caret(r.state)).toEqual({ index: 3, offset: 5 });
  });

  it("at the end of a non-empty line is left to the default", () => {
    expect(run(make(DOC, [6, 14]), deleteCommand).ok).toBe(false);
  });

  it("deletes an empty line in the middle and puts the caret at the start of the line below", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "" }, { kind: "text", text: "B" }];
    const r = run(make(doc, [2, 0]), deleteCommand);
    expect(lines(r.state)).toEqual([...HEADER, { kind: "text", text: "B" }]);
    expect(caret(r.state)).toEqual({ index: 2, offset: 0 });
  });

  it("does not delete the last line", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "A" }, { kind: "text", text: "" }];
    const r = run(make(doc, [3, 0]), deleteCommand);
    expect(r.ok).toBe(false);
    expect(lines(r.state)).toEqual(doc);
  });
});

describe("tabCommand / shiftTabCommand", () => {
  it("Tab in the left part moves the caret past the tab", () => {
    const r = run(make(DOC, [3, 2]), tabCommand);
    expect(caret(r.state)).toEqual({ index: 3, offset: 5 });
  });

  it("Tab in the right part moves the caret to the end of the line", () => {
    const r = run(make(DOC, [3, 7]), tabCommand);
    expect(caret(r.state)).toEqual({ index: 3, offset: 11 });
  });

  it("Shift-Tab moves the caret before the tab", () => {
    const r = run(make(DOC, [3, 7]), shiftTabCommand);
    expect(caret(r.state)).toEqual({ index: 3, offset: 4 });
  });

  it("does nothing on a bullet, heading or text line, and returns true", () => {
    for (const idx of [2, 5, 6]) {
      for (const cmd of [tabCommand, shiftTabCommand]) {
        const r = run(make(DOC, [idx, 2]), cmd);
        expect(r.ok).toBe(true);
        expect(lines(r.state)).toEqual(DOC);
        expect(caret(r.state)).toEqual({ index: idx, offset: 2 });
      }
    }
  });
});

describe("toggleMarkCommand and formatAt", () => {
  it("bold on a range makes formatAt report bold", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "Hello world" }];
    const r = run(make(doc, [2, 0], [2, 5]), toggleMarkCommand("bold"));
    expect(formatAt(r.state).bold).toBe(true);
    expect(formatAt(r.state).italic).toBe(false);
    expect(lines(r.state)[2].marks).toEqual([{ from: 0, to: 5, bold: true }]);
  });

  it("a partial range that is not all bold reports bold false", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "Hello world" }];
    const bolded = run(make(doc, [2, 0], [2, 5]), toggleMarkCommand("bold")).state;
    const whole = bolded.apply(bolded.tr.setSelection(TextSelection.create(bolded.doc, docPos(bolded.doc, 2, 0), docPos(bolded.doc, 2, 11))));
    expect(formatAt(whole).bold).toBe(false);
  });

  it("on a mixed range makes the whole range bold; a fully bold range toggles off", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "abcd", marks: [{ from: 0, to: 2, bold: true }] }];
    const mixed = make(doc, [2, 0], [2, 4]);
    expect(formatAt(mixed).bold).toBe(false);
    const all = run(mixed, toggleMarkCommand("bold")).state;
    expect(lines(all)[2].marks).toEqual([{ from: 0, to: 4, bold: true }]);
    const selected = all.apply(all.tr.setSelection(TextSelection.create(all.doc, docPos(all.doc, 2, 0), docPos(all.doc, 2, 4))));
    expect(formatAt(selected).bold).toBe(true);
    const off = run(selected, toggleMarkCommand("bold")).state;
    expect(lines(off)[2].marks).toBeUndefined();
    expect(formatAt(off).bold).toBe(false);
  });

  it("with a caret, toggles the stored marks and formatAt reports them", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "Hello" }];
    const r = run(make(doc, [2, 3]), toggleMarkCommand("italic"));
    expect(formatAt(r.state).italic).toBe(true);
    expect(lines(r.state)[2]).toEqual({ kind: "text", text: "Hello" });
  });
});

describe("setSizeCommand", () => {
  const SIZED: DocLine[] = [...HEADER, { kind: "text", text: "Hello world" }];

  it("setSize 11 removes the size mark", () => {
    const sized = run(make(SIZED, [2, 0], [2, 5]), setSizeCommand(14)).state;
    expect(formatAt(sized).size).toBe(14);
    const r = run(sized, setSizeCommand(11));
    expect(formatAt(r.state).size).toBe(11);
    expect(lines(r.state)[2].marks).toBeUndefined();
  });

  it("setSize 14 on a range, then formatAt reports 14", () => {
    const r = run(make(SIZED, [2, 0], [2, 5]), setSizeCommand(14));
    expect(formatAt(r.state).size).toBe(14);
  });

  it("clamps the size to [8, 28]", () => {
    const r = run(make(SIZED, [2, 0], [2, 5]), setSizeCommand(99));
    expect(formatAt(r.state).size).toBe(28);
  });

  it("a range with mixed sizes reports null", () => {
    const sized = run(make(SIZED, [2, 0], [2, 5]), setSizeCommand(14)).state;
    const whole = sized.apply(sized.tr.setSelection(TextSelection.create(sized.doc, docPos(sized.doc, 2, 0), docPos(sized.doc, 2, 11))));
    expect(formatAt(whole).size).toBeNull();
  });

  it("with a caret, sets the stored size", () => {
    const r = run(make(SIZED, [2, 2]), setSizeCommand(16));
    expect(formatAt(r.state).size).toBe(16);
  });
});

describe("setAlignCommand", () => {
  it("a range that ends at offset 0 of the next line centers only the first line", () => {
    const doc: DocLine[] = [{ kind: "text", text: "aaa" }, { kind: "text", text: "bbb" }];
    const r = run(make(doc, [0, 1], [1, 0]), setAlignCommand("center")).state;
    expect(lines(r)[0].para).toEqual({ align: "center" });
    expect(lines(r)[1].para).toBeUndefined();
  });

  it("a range that reaches past offset 0 of the next line centers both lines", () => {
    const doc: DocLine[] = [{ kind: "text", text: "aaa" }, { kind: "text", text: "bbb" }];
    const r = run(make(doc, [0, 1], [1, 1]), setAlignCommand("center")).state;
    expect(lines(r).map((l) => l.para)).toEqual([{ align: "center" }, { align: "center" }]);
  });

  it("aligns every line the selection touches; left removes the alignment", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "A" }, { kind: "text", text: "B" }];
    const centered = run(make(doc, [2, 0], [3, 1]), setAlignCommand("center")).state;
    expect(lines(centered).slice(2).map((l) => l.para)).toEqual([{ align: "center" }, { align: "center" }]);
    expect(formatAt(centered).align).toBe("center");
    const left = run(centered, setAlignCommand("left")).state;
    expect(lines(left)[2].para).toBeUndefined();
    expect(formatAt(left).align).toBe("left");
  });

  it("with AllSelection, updates every line", () => {
    const s = EditorState.create({ doc: linesToDoc(DOC), plugins: [headerGuard] });
    const withAll = s.apply(s.tr.setSelection(new AllSelection(s.doc)));
    const r = run(withAll, setAlignCommand("right"));
    expect(lines(r.state).every((l) => l.para?.align === "right")).toBe(true);
  });
});

describe("toggleParaFlagCommand", () => {
  const TWO: DocLine[] = [...HEADER, { kind: "text", text: "A" }, { kind: "text", text: "B" }];

  it("rule: on when any touched line lacks it, then off when all have it", () => {
    const first = run(make(TWO, [2, 0]), toggleParaFlagCommand("rule")).state;
    expect(lines(first)[2].para).toEqual({ rule: true });
    expect(lines(first)[3].para).toBeUndefined();

    const both = run(first, toggleParaFlagCommand("rule")).state;
    // The selection is the caret's line only; select both lines to test the any/all rule.
    expect(lines(both)[2].para).toBeUndefined();

    const range = first.apply(first.tr.setSelection(TextSelection.create(first.doc, docPos(first.doc, 2, 0), docPos(first.doc, 3, 1))));
    const on = run(range, toggleParaFlagCommand("rule")).state;
    expect(lines(on)[2].para).toEqual({ rule: true });
    expect(lines(on)[3].para).toEqual({ rule: true });
    expect(formatAt(on).rule).toBe(true);

    const off = run(on, toggleParaFlagCommand("rule")).state;
    expect(lines(off)[2].para).toBeUndefined();
    expect(lines(off)[3].para).toBeUndefined();
    expect(formatAt(off).rule).toBe(false);
  });

  it("caps works the same way", () => {
    const r = run(make(TWO, [2, 0]), toggleParaFlagCommand("caps"));
    expect(lines(r.state)[2].para).toEqual({ caps: true });
  });
});

describe("toggleSpaceBeforeCommand", () => {
  it("adds space before on the line, then removes it", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "A" }];
    const on = run(make(doc, [2, 0]), toggleSpaceBeforeCommand()).state;
    expect(lines(on)[2].para).toEqual({ spaceBefore: 6 });
    expect(formatAt(on).spaceBefore).toBe(true);
    const off = run(on, toggleSpaceBeforeCommand()).state;
    expect(lines(off)[2].para).toBeUndefined();
    expect(formatAt(off).spaceBefore).toBe(false);
  });
});

describe("clearFormattingCommand", () => {
  it("removes marks and paragraph formatting of the selected lines", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "Hello", marks: [{ from: 0, to: 5, bold: true, size: 14 }], para: { align: "center", rule: true } }];
    const r = run(make(doc, [2, 0], [2, 5]), clearFormattingCommand());
    expect(lines(r.state)[2]).toEqual({ kind: "text", text: "Hello" });
  });
});

describe("setLineKindCommand", () => {
  const TWO: DocLine[] = [...HEADER, { kind: "text", text: "Alpha" }, { kind: "text", text: "Beta" }];

  it("text lines become bullets", () => {
    const r = run(make(TWO, [2, 0], [3, 2]), setLineKindCommand("bullet"));
    expect(r.ok).toBe(true);
    expect(lines(r.state)).toEqual([...HEADER, { kind: "bullet", text: "Alpha" }, { kind: "bullet", text: "Beta" }]);
  });

  it("a bullet becomes an entry with a tab and loses its bid", () => {
    const doc: DocLine[] = [...HEADER, { kind: "bullet", text: "Alpha", bid: "b1" }];
    const r = run(make(doc, [2, 1]), setLineKindCommand("entry"));
    expect(lines(r.state)[2]).toEqual({ kind: "entry", text: "Alpha", right: "" });
  });

  it("an entry becomes text and its tab turns into a space", () => {
    const r = run(make(DOC, [3, 1]), setLineKindCommand("text"));
    expect(lines(r.state)[3]).toEqual({ kind: "text", text: "Acme Remote" });
  });

  it("name over two lines only names the first, and demotes the old name line", () => {
    const r = run(make(TWO, [2, 0], [3, 2]), setLineKindCommand("name"));
    expect(lines(r.state)).toEqual([
      { kind: "text", text: "Ada" },
      { kind: "contact", text: "London" },
      { kind: "name", text: "Alpha" },
      { kind: "text", text: "Beta" },
    ]);
  });

  it("with AllSelection, updates every line and does not throw", () => {
    const s = EditorState.create({ doc: linesToDoc(TWO), plugins: [headerGuard] });
    const withAll = s.apply(s.tr.setSelection(new AllSelection(s.doc)));
    const r = run(withAll, setLineKindCommand("bullet"));
    expect(lines(r.state).every((l) => l.kind === "bullet")).toBe(true);
  });
});

describe("replaceLineTextCommand", () => {
  const doc: DocLine[] = [...HEADER, { kind: "text", text: "X" }, { kind: "bullet", text: "Old text", bid: "b1", marks: [{ from: 0, to: 3, bold: true }] }];

  it("replaces the text of the line with the bid and puts the caret at its end, with no marks", () => {
    const r = run(make(doc, [3, 0]), replaceLineTextCommand("b1", "New text"));
    expect(r.ok).toBe(true);
    expect(lines(r.state)[3]).toEqual({ kind: "bullet", text: "New text", bid: "b1" });
    expect(caret(r.state)).toEqual({ index: 3, offset: 8 });
  });

  it("an empty text leaves an empty line", () => {
    const r = run(make(doc, [3, 0]), replaceLineTextCommand("b1", ""));
    expect(lines(r.state)[3]).toEqual({ kind: "bullet", text: "", bid: "b1" });
  });

  it("returns false when no line has the bid", () => {
    expect(run(make(doc, [3, 0]), replaceLineTextCommand("nope", "x")).ok).toBe(false);
  });
});

describe("editorKeymap", () => {
  it("returns the custom keymap and the base keymap", () => {
    expect(editorKeymap()).toHaveLength(2);
  });
});

describe("pasteTextParser", () => {
  it("a single plain line pastes as inline text", () => {
    const slice = pasteTextParser("Hello there");
    expect(slice.openStart).toBe(0);
    expect(slice.openEnd).toBe(0);
    expect(slice.content.childCount).toBe(1);
    expect(slice.content.firstChild?.isText).toBe(true);
    expect(slice.content.firstChild?.text).toBe("Hello there");
  });

  it("several lines paste as open line nodes", () => {
    const slice = pasteTextParser("Alpha\n\nBeta");
    expect(slice.openStart).toBe(1);
    expect(slice.openEnd).toBe(1);
    expect(slice.content.childCount).toBe(2);
    expect(slice.content.child(0).attrs.kind).toBe("text");
    expect(slice.content.child(1).textContent).toBe("Beta");
  });

  it("a bullet marker makes a bullet, even for one line", () => {
    const slice = pasteTextParser("• Built X");
    expect(slice.openStart).toBe(1);
    expect(slice.content.child(0).attrs.kind).toBe("bullet");
    expect(slice.content.child(0).textContent).toBe("Built X");
  });

  it("empty text gives an empty slice", () => {
    expect(pasteTextParser("  \n ").size).toBe(0);
  });
});

describe("stripPastedIds", () => {
  it("clears the ids of every line and keeps the open sides", () => {
    const slice = new Slice(
      Fragment.from([lineToNode({ kind: "bullet", text: "A", sid: "s", iid: "i", bid: "b" })]),
      1,
      1,
    );
    const out = stripPastedIds(slice);
    expect(out.openStart).toBe(1);
    expect(out.openEnd).toBe(1);
    expect(out.content.child(0).attrs).toMatchObject({ kind: "bullet", sid: null, iid: null, bid: null });
    expect(out.content.child(0).textContent).toBe("A");
  });

  it("keeps the tab of an entry", () => {
    const slice = new Slice(Fragment.from([lineToNode({ kind: "entry", text: "A", right: "B", sid: "s" })]), 1, 1);
    const out = stripPastedIds(slice);
    expect(out.content.child(0).childCount).toBe(3);
    expect(out.content.child(0).attrs.sid).toBeNull();
  });

  it("keeps the marks and paragraph formatting", () => {
    const slice = new Slice(
      Fragment.from([lineToNode({ kind: "bullet", text: "AB", marks: [{ from: 0, to: 1, bold: true }], para: { align: "right" }, bid: "b" })]),
      1,
      1,
    );
    const out = stripPastedIds(slice);
    const line = out.content.child(0);
    expect(line.attrs.bid).toBeNull();
    expect(line.attrs.para).toEqual({ align: "right" });
    expect(line.firstChild?.marks.some((m) => m.type.name === "bold")).toBe(true);
  });
});

function tabType() {
  return docSchema.nodes.tab.create();
}
