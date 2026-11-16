import { describe, it, expect } from "vitest";
import { Fragment, Slice, type Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection, type Command } from "prosemirror-state";
import {
  caretInfo, headerGuard, enterCommand, backspaceCommand, deleteCommand, tabCommand, shiftTabCommand,
  toggleStyleCommand, resetStyleCommand, setLineKindCommand, replaceLineTextCommand, editorKeymap,
  pasteTextParser, stripPastedIds,
} from "../src/lib/docEditing";
import { docSchema, docToLines, linesToDoc, lineToNode } from "../src/lib/pmSchema";
import type { DocLine } from "../src/lib/docLineTypes";

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

/** Any change that leaves the text as it was, so the guard runs. */
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

  it("reports part null on a bullet", () => {
    expect(caretInfo(make(DOC, [5, 2])).part).toBeNull();
  });
});

describe("headerGuard", () => {
  it("adds the contact line to a one-line doc", () => {
    const s = touch(make([{ kind: "name", text: "Ada" }], [0, 0]));
    expect(lines(s)).toEqual([{ kind: "name", text: "Ada" }, { kind: "contact", text: "" }]);
  });

  it("turns a third name line into text", () => {
    const doc = linesToDoc([...HEADER, { kind: "name", text: "Other" }]);
    expect(lines(touch(stateOf(doc, [0, 0])))[2]).toEqual({ kind: "text", text: "Other" });
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

  it("replaces the second tab of a role with a space", () => {
    const role = docSchema.nodes.line.create({ kind: "role" }, [
      docSchema.text("Eng"), tabType(), docSchema.text("2020"), tabType(), docSchema.text("now"),
    ]);
    const doc = docSchema.node("doc", null, [lineToNode(HEADER[0]), lineToNode(HEADER[1]), role]);
    expect(lines(touch(stateOf(doc, [0, 0])))[2]).toEqual({ kind: "role", text: "Eng", right: "2020 now" });
  });

  it("keeps the caret in place when it inserts a tab at the caret", () => {
    const entry = docSchema.nodes.line.create({ kind: "entry" }, docSchema.text("Acme"));
    const doc = docSchema.node("doc", null, [lineToNode(HEADER[0]), lineToNode(HEADER[1]), entry]);
    const s = touch(stateOf(doc, [2, 0]));
    expect(caret(s)).toEqual({ index: 2, offset: 0 });
  });
});

describe("enterCommand", () => {
  it("a: on the name line moves the caret to the contact line", () => {
    const r = run(make(DOC, [0, 2]), enterCommand);
    expect(r.ok).toBe(true);
    expect(lines(r.state)).toEqual(DOC);
    expect(caret(r.state)).toEqual({ index: 1, offset: 0 });
  });

  it("b: on the contact line adds a heading after it when the next line is not empty", () => {
    const r = run(make(DOC, [1, 3]), enterCommand);
    expect(lines(r.state)[2]).toEqual({ kind: "heading", text: "" });
    expect(lines(r.state)[3]).toEqual({ kind: "heading", text: "EXPERIENCE" });
    expect(caret(r.state)).toEqual({ index: 2, offset: 0 });
  });

  it("b: on the contact line moves into the empty line below instead of adding one", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "" }, { kind: "text", text: "X" }];
    const r = run(make(doc, [1, 0]), enterCommand);
    expect(lines(r.state)).toEqual(doc);
    expect(caret(r.state)).toEqual({ index: 2, offset: 0 });
  });

  it("c: an empty bullet becomes an entry with a tab", () => {
    const doc: DocLine[] = [...HEADER, { kind: "bullet", text: "", bid: "b1" }];
    const r = run(make(doc, [2, 0]), enterCommand);
    expect(lines(r.state)[2]).toEqual({ kind: "entry", text: "", right: "" });
    expect(caret(r.state)).toEqual({ index: 2, offset: 0 });
  });

  it("d: at the start of a non-empty line adds an empty line of the same kind before it", () => {
    const r = run(make(DOC, [5, 0]), enterCommand);
    expect(lines(r.state)[5]).toEqual({ kind: "bullet", text: "" });
    expect(lines(r.state)[6]).toEqual({ kind: "bullet", text: "Built it", bid: "b1" });
    expect(caret(r.state)).toEqual({ index: 6, offset: 0 });
  });

  it("d: at the start of an entry adds an empty entry with a tab", () => {
    const r = run(make(DOC, [3, 0]), enterCommand);
    expect(lines(r.state)[3]).toEqual({ kind: "entry", text: "", right: "" });
    expect(lines(r.state)[4]).toEqual({ kind: "entry", text: "Acme", right: "Remote" });
    expect(caret(r.state)).toEqual({ index: 4, offset: 0 });
  });

  it("e: at the end of an entry's left part keeps the location and adds an empty role", () => {
    const r = run(make(DOC, [3, 4]), enterCommand);
    expect(lines(r.state)[3]).toEqual({ kind: "entry", text: "Acme", right: "Remote" });
    expect(lines(r.state)[4]).toEqual({ kind: "role", text: "", right: "" });
    expect(caret(r.state)).toEqual({ index: 4, offset: 0 });
  });

  it("e: in the middle of an entry's left part moves the rest to a new role line", () => {
    const r = run(make(DOC, [3, 2]), enterCommand);
    expect(lines(r.state)[3]).toEqual({ kind: "entry", text: "Ac", right: "Remote" });
    expect(lines(r.state)[4]).toEqual({ kind: "role", text: "me", right: "" });
    expect(caret(r.state)).toEqual({ index: 4, offset: 0 });
  });

  it("e: a role's left part moves the rest to a new bullet", () => {
    const r = run(make(DOC, [4, 1]), enterCommand);
    expect(lines(r.state)[4]).toEqual({ kind: "role", text: "E", right: "2020" });
    expect(lines(r.state)[5]).toEqual({ kind: "bullet", text: "ngineer" });
    expect(lines(r.state)[6]).toEqual({ kind: "bullet", text: "Built it", bid: "b1" });
    expect(caret(r.state)).toEqual({ index: 5, offset: 0 });
  });

  it("f: splits a text line at the caret", () => {
    const r = run(make(DOC, [6, 4]), enterCommand);
    expect(lines(r.state)[6]).toEqual({ kind: "text", text: "Lang" });
    expect(lines(r.state)[7]).toEqual({ kind: "text", text: "uages: EN" });
    expect(caret(r.state)).toEqual({ index: 7, offset: 0 });
  });

  it("f: at the end of a heading adds an entry, with its tab", () => {
    const r = run(make(DOC, [2, 10]), enterCommand);
    expect(lines(r.state)[2]).toEqual({ kind: "heading", text: "EXPERIENCE" });
    expect(lines(r.state)[3]).toEqual({ kind: "entry", text: "", right: "" });
    expect(caret(r.state)).toEqual({ index: 3, offset: 0 });
  });

  it("f: in the middle of a bullet keeps the bid on the first half only", () => {
    const r = run(make(DOC, [5, 5]), enterCommand);
    expect(lines(r.state)[5]).toEqual({ kind: "bullet", text: "Built", bid: "b1" });
    expect(lines(r.state)[6]).toEqual({ kind: "bullet", text: " it" });
    expect(caret(r.state)).toEqual({ index: 6, offset: 0 });
  });

  it("deletes a selection before splitting", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "Hello world" }];
    const r = run(make(doc, [2, 0], [2, 6]), enterCommand);
    expect(lines(r.state)).toEqual([...HEADER, { kind: "text", text: "" }, { kind: "text", text: "world" }]);
    expect(caret(r.state)).toEqual({ index: 3, offset: 0 });
  });
});

describe("backspaceCommand", () => {
  it("after a tab moves the caret in front of the tab", () => {
    const r = run(make(DOC, [3, 5]), backspaceCommand);
    expect(r.ok).toBe(true);
    expect(lines(r.state)).toEqual(DOC);
    expect(caret(r.state)).toEqual({ index: 3, offset: 4 });
  });

  it("at offset 0 does nothing on the name and contact lines", () => {
    for (const idx of [0, 1]) {
      const r = run(make(DOC, [idx, 0]), backspaceCommand);
      expect(r.ok).toBe(true);
      expect(lines(r.state)).toEqual(DOC);
    }
  });

  it("at offset 0 of a non-empty heading does nothing", () => {
    const r = run(make(DOC, [2, 0]), backspaceCommand);
    expect(r.ok).toBe(true);
    expect(lines(r.state)).toEqual(DOC);
  });

  it("deletes an empty line under the header and puts the caret at the end of the contact line", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "" }, { kind: "text", text: "X" }];
    const r = run(make(doc, [2, 0]), backspaceCommand);
    expect(lines(r.state)).toEqual([...HEADER, { kind: "text", text: "X" }]);
    expect(caret(r.state)).toEqual({ index: 1, offset: 6 });
  });

  it("deletes an empty line and puts the caret at the end of the line above", () => {
    const doc: DocLine[] = [...HEADER, { kind: "heading", text: "EXP" }, { kind: "text", text: "" }, { kind: "text", text: "X" }];
    const r = run(make(doc, [3, 0]), backspaceCommand);
    expect(lines(r.state)).toEqual([...HEADER, { kind: "heading", text: "EXP" }, { kind: "text", text: "X" }]);
    expect(caret(r.state)).toEqual({ index: 2, offset: 3 });
  });

  it("turns a bullet into text at offset 0", () => {
    const doc: DocLine[] = [...HEADER, { kind: "heading", text: "EXP" }, { kind: "bullet", text: "Built", bid: "b1" }];
    const r = run(make(doc, [3, 0]), backspaceCommand);
    expect(lines(r.state)[3]).toEqual({ kind: "text", text: "Built" });
    expect(caret(r.state)).toEqual({ index: 3, offset: 0 });
  });

  it("leaves a join of a text line into the line above to the default", () => {
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

  it("at the end of the contact line is blocked", () => {
    const r = run(make(DOC, [1, 6]), deleteCommand);
    expect(r.ok).toBe(true);
    expect(lines(r.state)).toEqual(DOC);
  });

  it("at the end of a text line is left to the default", () => {
    const r = run(make(DOC, [6, 14]), deleteCommand);
    expect(r.ok).toBe(false);
  });

  it("deletes an empty line in the middle and puts the caret at the start of the line below", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "" }, { kind: "text", text: "B" }];
    const r = run(make(doc, [2, 0]), deleteCommand);
    expect(lines(r.state)).toEqual([...HEADER, { kind: "text", text: "B" }]);
    expect(caret(r.state)).toEqual({ index: 2, offset: 0 });
  });

  it("deletes an empty last line and puts the caret at the end of the line above", () => {
    const doc: DocLine[] = [...HEADER, { kind: "text", text: "A" }, { kind: "text", text: "" }];
    const r = run(make(doc, [3, 0]), deleteCommand);
    expect(lines(r.state)).toEqual([...HEADER, { kind: "text", text: "A" }]);
    expect(caret(r.state)).toEqual({ index: 2, offset: 1 });
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

describe("toggleStyleCommand / resetStyleCommand", () => {
  it("toggles bold on the entry's left part only", () => {
    const r = run(make(DOC, [3, 1]), toggleStyleCommand("bold"));
    expect(r.ok).toBe(true);
    expect(lines(r.state)[3]).toEqual({ kind: "entry", text: "Acme", right: "Remote", style: { bold: false, italic: false } });
  });

  it("toggles italic on the entry's right part only", () => {
    const r = run(make(DOC, [3, 8]), toggleStyleCommand("italic"));
    expect(lines(r.state)[3]).toEqual({ kind: "entry", text: "Acme", right: "Remote", style2: { bold: false, italic: true } });
  });

  it("does nothing on a bullet and returns true", () => {
    const r = run(make(DOC, [5, 2]), toggleStyleCommand("bold"));
    expect(r.ok).toBe(true);
    expect(lines(r.state)).toEqual(DOC);
  });

  it("reset removes the part's override", () => {
    const toggled = run(make(DOC, [3, 1]), toggleStyleCommand("bold")).state;
    const r = run(toggled, resetStyleCommand);
    expect(lines(r.state)[3]).toEqual({ kind: "entry", text: "Acme", right: "Remote" });
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
    const r = run(make(DOC, [3, 1], [3, 1]), setLineKindCommand("text"));
    expect(lines(r.state)[3]).toEqual({ kind: "text", text: "Acme Remote" });
  });

  it("skips the header lines", () => {
    const r = run(make(TWO, [0, 0], [3, 2]), setLineKindCommand("bullet"));
    expect(r.ok).toBe(true);
    expect(lines(r.state).slice(0, 2)).toEqual(HEADER);
    expect(lines(r.state)[2]).toEqual({ kind: "bullet", text: "Alpha" });
  });

  it("returns false when only header lines are selected, or for name and contact", () => {
    expect(run(make(TWO, [0, 0]), setLineKindCommand("bullet")).ok).toBe(false);
    expect(run(make(TWO, [2, 0], [3, 2]), setLineKindCommand("contact")).ok).toBe(false);
  });
});

describe("replaceLineTextCommand", () => {
  const doc: DocLine[] = [...HEADER, { kind: "text", text: "X" }, { kind: "bullet", text: "Old text", bid: "b1" }];

  it("replaces the text of the line with the bid and puts the caret at its end", () => {
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
});

function tabType() {
  return docSchema.nodes.tab.create();
}
