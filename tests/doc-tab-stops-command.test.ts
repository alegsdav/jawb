import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { docExtensions } from "@/lib/doc/extensions";
import type { DocJSON, TabStop } from "@/lib/doc/types";

/** A headless editor over three paragraphs with the given ids; the selection covers from the first to the second. */
function editorWith(): Editor {
  const para = (id: string, text: string) => ({ type: "paragraph", attrs: { id }, content: [{ type: "text", text }] });
  const content: DocJSON = {
    type: "doc",
    content: [para("aaaaaaaa", "one"), para("bbbbbbbb", "two"), para("cccccccc", "three")],
  } as DocJSON;
  return new Editor({ extensions: docExtensions, content });
}

/** The tabStops attr of each paragraph, in document order. */
function stopsOf(editor: Editor): (TabStop[] | null)[] {
  const out: (TabStop[] | null)[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "paragraph") out.push((node.attrs.tabStops as TabStop[] | null) ?? null);
    return true;
  });
  return out;
}

/** Selects from the start of the first paragraph's text to the end of the second's (positions 2 to 7 in this doc). */
function selectFirstTwo(editor: Editor) {
  editor.commands.setTextSelection({ from: 2, to: 7 });
}

describe("setTabStops", () => {
  it("sets the stops on every paragraph the selection touches, and no others", () => {
    const editor = editorWith();
    selectFirstTwo(editor);
    expect(editor.commands.setTabStops([{ pos: 216, align: "right" }, { pos: 72, align: "center" }])).toBe(true);
    expect(stopsOf(editor)).toEqual([
      [{ pos: 72, align: "center" }, { pos: 216, align: "right" }],
      [{ pos: 72, align: "center" }, { pos: 216, align: "right" }],
      null,
    ]);
  });

  it("clears the stops with null, so the paragraphs use the default tab rule again", () => {
    const editor = editorWith();
    selectFirstTwo(editor);
    editor.commands.setTabStops([{ pos: 72, align: "left" }]);
    editor.commands.setTabStops(null);
    expect(stopsOf(editor)).toEqual([null, null, null]);
  });

  it("stores only the stops the schema keeps: bad ones are dropped, the rest sorted", () => {
    const editor = editorWith();
    selectFirstTwo(editor);
    editor.commands.setTabStops([
      { pos: 540, align: "right" },
      { pos: -5, align: "left" },
      { pos: 72, align: "sideways" as "left" },
      { pos: 72, align: "center" },
    ]);
    expect(stopsOf(editor)[0]).toEqual([{ pos: 72, align: "center" }, { pos: 540, align: "right" }]);
  });

  it("stores null when the list is empty", () => {
    const editor = editorWith();
    editor.commands.setTextSelection(3);
    editor.commands.setTabStops([]);
    expect(stopsOf(editor)[0]).toBeNull();
  });

  it("changes only the paragraph under a caret", () => {
    const editor = editorWith();
    editor.commands.setTextSelection(3);
    editor.commands.setTabStops([{ pos: 144, align: "left" }]);
    expect(stopsOf(editor)).toEqual([[{ pos: 144, align: "left" }], null, null]);
  });
});
