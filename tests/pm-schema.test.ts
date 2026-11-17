import { describe, it, expect } from "vitest";
import {
  docSchema, lineToNode, linesToDoc, nodeToLine, docToLines, textToLines, partRanges, partAtOffset, parseFontSize,
} from "../src/lib/pmSchema";
import { cleanMarks } from "../src/lib/richText";
import type { DocLine } from "../src/lib/docLineTypes";

const resume: DocLine[] = [
  { kind: "name", text: "Ada Lovelace" },
  { kind: "contact", text: "London • ada@example.com • +44 20 0000" },
  { kind: "heading", text: "EXPERIENCE", sid: "s1" },
  { kind: "entry", text: "Analytical Engines Ltd", right: "London", sid: "s1", iid: "i1" },
  { kind: "role", text: "Engineer", right: "2020 - Present", sid: "s1", iid: "i1" },
  { kind: "bullet", text: "Wrote the first program", sid: "s1", iid: "i1", bid: "b1" },
  { kind: "bullet", text: "Designed the notation", sid: "s1", iid: "i1", bid: "b2" },
  { kind: "heading", text: "EDUCATION", sid: "s2" },
  { kind: "entry", text: "University", right: "", sid: "s2", iid: "i2" },
  { kind: "role", text: "BSc Mathematics", right: "1832 - 1835", sid: "s2", iid: "i2" },
  { kind: "text", text: "Languages: English, French", sid: "s3", iid: "i3" },
];

const toDOMSpec = (node: ReturnType<typeof lineToNode>) =>
  docSchema.nodes.line.spec.toDOM!(node) as [string, Record<string, string>, number];

describe("lineToNode / nodeToLine", () => {
  it("round trips an entry with right text", () => {
    const line: DocLine = { kind: "entry", text: "Acme", right: "Remote" };
    const node = lineToNode(line);
    expect(node.type.name).toBe("line");
    expect(node.childCount).toBe(3);
    expect(node.child(1).type.name).toBe("tab");
    expect(nodeToLine(node)).toEqual(line);
  });

  it("always has a tab for entry and role, even with no right text", () => {
    const node = lineToNode({ kind: "role", text: "Engineer", right: "" });
    expect(node.childCount).toBe(2);
    expect(node.child(1).type.name).toBe("tab");
    expect(nodeToLine(node)).toEqual({ kind: "role", text: "Engineer", right: "" });
  });

  it("handles an empty entry line", () => {
    const node = lineToNode({ kind: "entry", text: "", right: "" });
    expect(node.childCount).toBe(1);
    expect(nodeToLine(node)).toEqual({ kind: "entry", text: "", right: "" });
  });

  it("treats a missing right on entry as empty", () => {
    expect(nodeToLine(lineToNode({ kind: "entry", text: "Acme" }))).toEqual({ kind: "entry", text: "Acme", right: "" });
  });

  it("creates no tab for other kinds", () => {
    const node = lineToNode({ kind: "bullet", text: "Did things" });
    expect(node.childCount).toBe(1);
    expect(node.child(0).isText).toBe(true);
    expect(nodeToLine(node)).toEqual({ kind: "bullet", text: "Did things" });
  });

  it("handles empty non-entry lines", () => {
    const node = lineToNode({ kind: "text", text: "" });
    expect(node.childCount).toBe(0);
    expect(nodeToLine(node)).toEqual({ kind: "text", text: "" });
  });

  it("never creates empty text nodes", () => {
    const node = lineToNode({ kind: "entry", text: "", right: "Remote", rightMarks: [{ from: 0, to: 3, bold: true }] });
    node.forEach((child) => {
      if (child.isText) expect(child.text!.length).toBeGreaterThan(0);
    });
  });

  it("keeps ids on round trip", () => {
    const line: DocLine = { kind: "heading", text: "SKILLS", sid: "s9" };
    expect(nodeToLine(lineToNode(line))).toEqual(line);
  });

  it("keeps all three ids on a bullet", () => {
    const line: DocLine = { kind: "bullet", text: "x", sid: "s", iid: "i", bid: "b" };
    expect(nodeToLine(lineToNode(line))).toEqual(line);
  });

  it("omits null attrs from the line", () => {
    const line = nodeToLine(lineToNode({ kind: "name", text: "Ada" }));
    expect(line).toEqual({ kind: "name", text: "Ada" });
    expect("sid" in line).toBe(false);
    expect("iid" in line).toBe(false);
    expect("bid" in line).toBe(false);
    expect("marks" in line).toBe(false);
    expect("para" in line).toBe(false);
    expect("right" in line).toBe(false);
  });

  it("omits null attrs from a node built by hand", () => {
    const node = docSchema.nodes.line.create({ kind: "bullet" }, docSchema.text("Hi"));
    expect(nodeToLine(node)).toEqual({ kind: "bullet", text: "Hi" });
  });

  it("does not put objects in the DOM", () => {
    const node = lineToNode({ kind: "name", text: "Ada", sid: "s1", para: { align: "center" } });
    const spec = toDOMSpec(node);
    expect(spec[0]).toBe("div");
    expect(spec[1]["data-sid"]).toBe("s1");
    for (const v of Object.values(spec[1])) expect(typeof v).toBe("string");
    expect(JSON.stringify(spec)).not.toContain("[object");
  });

  it("omits null data-* attributes in the DOM", () => {
    const node = lineToNode({ kind: "text", text: "Hi" });
    const spec = toDOMSpec(node);
    expect(spec[1]["data-kind"]).toBe("text");
    expect("data-sid" in spec[1]).toBe(false);
    expect("data-iid" in spec[1]).toBe(false);
    expect("data-bid" in spec[1]).toBe(false);
    expect(JSON.stringify(spec)).not.toContain("null");
  });

  it("falls back to kind text in the DOM for unknown kinds", () => {
    const node = docSchema.nodes.line.create({ kind: "text" }, docSchema.text("Hi"));
    expect(node.attrs.kind).toBe("text");
  });
});

describe("marks", () => {
  // "Built fast APIs for teams": bold 6..10, italic 8..14 (overlaps bold), size 16 on 15..25.
  const text = "Built fast APIs for teams";
  const line: DocLine = {
    kind: "bullet",
    text,
    marks: [
      { from: 6, to: 10, bold: true },
      { from: 8, to: 14, italic: true },
      { from: 15, to: 25, size: 16 },
    ],
  };

  it("round trips overlapping bold, italic and a size run", () => {
    const back = nodeToLine(lineToNode(line));
    expect(back.text).toBe(text);
    expect(back.marks).toEqual(cleanMarks(line.marks, text.length));
    expect(back.marks).toEqual([
      { from: 6, to: 8, bold: true },
      { from: 8, to: 10, bold: true, italic: true },
      { from: 10, to: 14, italic: true },
      { from: 15, to: 25, size: 16 },
    ]);
  });

  it("keeps the flags as schema marks on the text nodes", () => {
    const node = lineToNode(line);
    const names = node.content.content.map((c) => c.marks.map((m) => m.type.name).join(","));
    expect(names).toContain("bold,italic");
    expect(names).toContain("size");
  });

  it("puts marks on both sides of an entry, with right offsets relative to the right part", () => {
    const entry: DocLine = {
      kind: "entry",
      text: "Analytical Engines",
      marks: [{ from: 0, to: 10, bold: true }],
      right: "London 2020",
      rightMarks: [{ from: 7, to: 11, italic: true }],
    };
    expect(nodeToLine(lineToNode(entry))).toEqual(entry);
  });

  it("writes an empty size mark with pt and no mark for the 11pt base", () => {
    const node = lineToNode({ kind: "text", text: "ab", marks: [{ from: 0, to: 2, size: 11 }] });
    expect(node.firstChild!.marks.length).toBe(0);
  });

  it("renders a size mark as an em value of the 11pt base", () => {
    const mark = docSchema.marks.size.create({ pt: 16 });
    expect(docSchema.marks.size.spec.toDOM!(mark, true)).toEqual(["span", { style: "font-size: 1.4545em" }, 0]);
    const half = docSchema.marks.size.create({ pt: 22 });
    expect(docSchema.marks.size.spec.toDOM!(half, true)).toEqual(["span", { style: "font-size: 2em" }, 0]);
  });

  it("renders bold, italic and underline as strong, em and u", () => {
    const node = lineToNode({
      kind: "text",
      text: "abc",
      marks: [{ from: 0, to: 1, bold: true }, { from: 1, to: 2, italic: true }, { from: 2, to: 3, underline: true }],
    });
    expect(node.child(0).marks[0].type.name).toBe("bold");
    expect(docSchema.marks.bold.spec.toDOM!(docSchema.marks.bold.create(), true)).toEqual(["strong", 0]);
    expect(docSchema.marks.italic.spec.toDOM!(docSchema.marks.italic.create(), true)).toEqual(["em", 0]);
    expect(docSchema.marks.underline.spec.toDOM!(docSchema.marks.underline.create(), true)).toEqual(["u", 0]);
  });
});

describe("paragraph formatting", () => {
  it("round trips para", () => {
    const line: DocLine = {
      kind: "heading",
      text: "EXPERIENCE",
      sid: "s1",
      para: { align: "center", rule: true, caps: true, spaceBefore: 6 },
    };
    expect(nodeToLine(lineToNode(line))).toEqual(line);
  });

  it("writes para as classes and an em margin-top in the DOM", () => {
    const node = lineToNode({
      kind: "heading",
      text: "EXPERIENCE",
      para: { align: "center", rule: true, caps: true, spaceBefore: 6 },
    });
    const spec = toDOMSpec(node);
    expect(spec[1].class).toBe("doc-line doc-line-heading doc-align-center doc-rule doc-caps");
    expect(spec[1].style).toBe("margin-top: 0.5455em");
    expect(spec[1]["data-kind"]).toBe("heading");
  });

  it("writes no class or style for an empty para", () => {
    const spec = toDOMSpec(lineToNode({ kind: "text", text: "x", para: {} }));
    expect(spec[1].class).toBe("doc-line doc-line-text");
    expect("style" in spec[1]).toBe(false);
  });
});

describe("parseFontSize", () => {
  it("reads pt, px and em values", () => {
    expect(parseFontSize("12pt")).toBe(12);
    expect(parseFontSize("16px")).toBe(12);
    expect(parseFontSize("2em")).toBe(22);
    expect(parseFontSize("14")).toBe(14);
  });

  it("ignores 11pt and sizes outside 8 to 28", () => {
    expect(parseFontSize("11pt")).toBeNull();
    expect(parseFontSize("40pt")).toBeNull();
    expect(parseFontSize("6pt")).toBeNull();
    expect(parseFontSize("garbage")).toBeNull();
  });
});

describe("linesToDoc / docToLines", () => {
  it("round trips a realistic resume", () => {
    const doc = linesToDoc(resume);
    expect(doc.type.name).toBe("doc");
    expect(doc.childCount).toBe(resume.length);
    expect(docToLines(doc)).toEqual(resume);
  });

  it("returns a doc with one empty line for no lines", () => {
    const doc = linesToDoc([]);
    expect(doc.childCount).toBe(1);
    expect(docToLines(doc)).toEqual([{ kind: "text", text: "" }]);
    expect(docSchema.nodes.doc.create(null, []).childCount).toBe(0);
    expect(() => docSchema.node("doc", null, [])).toThrow();
  });
});

describe("tabs in text", () => {
  it("turns a second tab in an entry's right part into a space", () => {
    const node = docSchema.nodes.line.create(
      { kind: "entry" },
      [docSchema.text("Left"), tab(), docSchema.text("Mid"), tab(), docSchema.text("Right")],
    );
    expect(nodeToLine(node)).toEqual({ kind: "entry", text: "Left", right: "Mid Right" });
  });

  it("turns a second tab in a role's right part into a space", () => {
    const node = docSchema.nodes.line.create(
      { kind: "role" },
      [docSchema.text("R"), tab(), docSchema.text("2020"), tab(), docSchema.text("now")],
    );
    expect(nodeToLine(node)).toEqual({ kind: "role", text: "R", right: "2020 now" });
  });

  it("turns a tab in a text line into a space", () => {
    const node = docSchema.nodes.line.create(
      { kind: "text" },
      [docSchema.text("Skills:"), tab(), docSchema.text("SQL")],
    );
    expect(nodeToLine(node)).toEqual({ kind: "text", text: "Skills: SQL" });
  });

  it("turns a tab in a bullet into a space", () => {
    const node = docSchema.nodes.line.create({ kind: "bullet" }, [docSchema.text("a"), tab(), docSchema.text("b")]);
    expect(nodeToLine(node).text).toBe("a b");
  });
});

describe("textToLines", () => {
  it("reads each bullet marker", () => {
    const markers = ["•", "◦", "▪", "-", "–", "*", "·"];
    const lines = textToLines(markers.map((m) => `${m} item ${m}`).join("\n"));
    expect(lines).toEqual(markers.map((m) => ({ kind: "bullet", text: `item ${m}` })));
  });

  it("does not treat a marker without whitespace after it as a bullet", () => {
    expect(textToLines("-item")).toEqual([{ kind: "text", text: "-item" }]);
  });

  it("reads a tab line as an entry", () => {
    expect(textToLines("  Acme Corp \t  Remote\t2020")).toEqual([
      { kind: "entry", text: "Acme Corp", right: "Remote 2020" },
    ]);
  });

  it("reads a plain line as text", () => {
    expect(textToLines("   Languages: English  ")).toEqual([{ kind: "text", text: "Languages: English" }]);
  });

  it("drops blank lines", () => {
    expect(textToLines("\n  \nHello\n\t\n\nWorld\n")).toEqual([
      { kind: "text", text: "Hello" },
      { kind: "text", text: "World" },
    ]);
  });

  it("splits CRLF and CR line endings", () => {
    expect(textToLines("One\r\nTwo\rThree\nFour")).toEqual([
      { kind: "text", text: "One" },
      { kind: "text", text: "Two" },
      { kind: "text", text: "Three" },
      { kind: "text", text: "Four" },
    ]);
  });

  it("returns no ids or formatting", () => {
    const lines = textToLines("• a\nb\tc");
    for (const l of lines) {
      expect(l.sid).toBeUndefined();
      expect(l.iid).toBeUndefined();
      expect(l.bid).toBeUndefined();
      expect(l.marks).toBeUndefined();
    }
  });
});

describe("partRanges / partAtOffset", () => {
  it("splits an entry at its tab", () => {
    const node = lineToNode({ kind: "entry", text: "Acme", right: "London" });
    // "Acme" is 0..4, tab at offset 4 (size 1), "London" from 5 to 11
    expect(partRanges(node)).toEqual({ part1: [0, 4], part2: [5, 11] });
    expect(partAtOffset(node, 0)).toBe(1);
    expect(partAtOffset(node, 4)).toBe(1);
    expect(partAtOffset(node, 5)).toBe(2);
    expect(partAtOffset(node, 11)).toBe(2);
  });

  it("gives an entry with no right text an empty part2", () => {
    const node = lineToNode({ kind: "entry", text: "Acme", right: "" });
    expect(partRanges(node)).toEqual({ part1: [0, 4], part2: [5, 5] });
  });

  it("gives an entry without a tab one part", () => {
    const node = docSchema.nodes.line.create({ kind: "entry" }, docSchema.text("Acme"));
    expect(partRanges(node)).toEqual({ part1: [0, 4], part2: null });
    expect(partAtOffset(node, 2)).toBe(1);
  });

  it("splits a role at its tab", () => {
    const node = lineToNode({ kind: "role", text: "BSc", right: "2020" });
    expect(partRanges(node)).toEqual({ part1: [0, 3], part2: [4, 8] });
    expect(partAtOffset(node, 3)).toBe(1);
    expect(partAtOffset(node, 4)).toBe(2);
  });

  it("gives a text line with ': ' one part (the whole line)", () => {
    const node = lineToNode({ kind: "text", text: "Languages: English, French" });
    expect(partRanges(node)).toEqual({ part1: [0, 26], part2: null });
    expect(partAtOffset(node, 9)).toBe(1);
    expect(partAtOffset(node, 20)).toBe(1);
  });

  it("does not match a colon followed by a tab", () => {
    const node = docSchema.nodes.line.create(
      { kind: "text" },
      [docSchema.text("A:"), tab(), docSchema.text("B")],
    );
    expect(partRanges(node)).toEqual({ part1: [0, 4], part2: null });
  });

  it("gives heading, name and contact one part", () => {
    for (const kind of ["heading", "name", "contact"] as const) {
      const node = lineToNode({ kind, text: "Hello: world" });
      expect(partRanges(node)).toEqual({ part1: [0, 12], part2: null });
      expect(partAtOffset(node, 12)).toBe(1);
    }
  });

  it("gives a bullet one part", () => {
    const node = lineToNode({ kind: "bullet", text: "Did: things" });
    expect(partRanges(node)).toEqual({ part1: [0, 11], part2: null });
    expect(partAtOffset(node, 0)).toBe(1);
    expect(partAtOffset(node, 5)).toBe(1);
  });
});

function tab() {
  return docSchema.nodes.tab.create();
}
