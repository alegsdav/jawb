import { describe, it, expect } from "vitest";
import {
  docSchema, lineToNode, linesToDoc, nodeToLine, docToLines, textToLines, partRanges, partAtOffset,
} from "../src/lib/pmSchema";
import type { DocLine } from "../src/lib/docLineTypes";

const bold = { bold: true };

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

  it("keeps ids and styles on round trip", () => {
    const line: DocLine = {
      kind: "heading", text: "SKILLS", sid: "s9", style: bold, style2: { italic: true },
    };
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
    expect("style" in line).toBe(false);
    expect("style2" in line).toBe(false);
    expect("right" in line).toBe(false);
  });

  it("omits null attrs from a node built by hand", () => {
    const node = docSchema.nodes.line.create({ kind: "bullet" }, docSchema.text("Hi"));
    expect(nodeToLine(node)).toEqual({ kind: "bullet", text: "Hi" });
  });

  it("does not put style objects in the DOM", () => {
    const node = lineToNode({ kind: "name", text: "Ada", style: bold, sid: "s1" });
    const spec = docSchema.nodes.line.spec.toDOM!(node) as [string, Record<string, string>, number];
    expect(spec[0]).toBe("div");
    expect(spec[1]["data-sid"]).toBe("s1");
    expect(Object.values(spec[1]).some((v) => v.includes("bold"))).toBe(false);
  });

  it("omits null data-* attributes in the DOM", () => {
    const node = lineToNode({ kind: "text", text: "Hi" });
    const spec = docSchema.nodes.line.spec.toDOM!(node) as [string, Record<string, string>, number];
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

describe("parseDOM", () => {
  it("defines rules on the line and tab nodes", () => {
    const rules = docSchema.nodes.line.spec.parseDOM!;
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0].tag).toBe("[data-kind]");
    expect(docSchema.nodes.tab.spec.parseDOM![0].tag).toBe("span.doc-tab");
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
    // An unchecked doc with no lines is not what linesToDoc returns.
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

  it("returns no ids or styles", () => {
    const lines = textToLines("• a\nb\tc");
    for (const l of lines) {
      expect(l.sid).toBeUndefined();
      expect(l.iid).toBeUndefined();
      expect(l.bid).toBeUndefined();
      expect(l.style).toBeUndefined();
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

  it("splits a text line at the first colon-space", () => {
    const node = lineToNode({ kind: "text", text: "Languages: English, French" });
    // "Languages" is 0..9, ": " at 9..11
    expect(partRanges(node)).toEqual({ part1: [0, 9], part2: [11, 26] });
    expect(partAtOffset(node, 9)).toBe(1);
    expect(partAtOffset(node, 11)).toBe(2);
    expect(partAtOffset(node, 20)).toBe(2);
  });

  it("uses only the first colon-space in a text line", () => {
    const node = lineToNode({ kind: "text", text: "A: B: C" });
    expect(partRanges(node)).toEqual({ part1: [0, 1], part2: [3, 7] });
  });

  it("treats a text line without colon-space as one part", () => {
    const node = lineToNode({ kind: "text", text: "Just a line" });
    expect(partRanges(node)).toEqual({ part1: [0, 11], part2: null });
    expect(partAtOffset(node, 5)).toBe(1);
  });

  it("does not match a colon followed by a tab", () => {
    const node = docSchema.nodes.line.create(
      { kind: "text" },
      [docSchema.text("A:"), tab(), docSchema.text("B")],
    );
    expect(partRanges(node)).toEqual({ part1: [0, 4], part2: null });
  });

  it("counts a tab as one position in a text line", () => {
    const node = docSchema.nodes.line.create(
      { kind: "text" },
      [docSchema.text("Skill"), tab(), docSchema.text(": x")],
    );
    // "Skill" 0..5, tab at 5, ": " at 6..8, "x" at 8
    expect(partRanges(node)).toEqual({ part1: [0, 6], part2: [8, 9] });
  });

  it("gives heading, name and contact one part", () => {
    for (const kind of ["heading", "name", "contact"] as const) {
      const node = lineToNode({ kind, text: "Hello: world" });
      expect(partRanges(node)).toEqual({ part1: [0, 12], part2: null });
      expect(partAtOffset(node, 12)).toBe(1);
    }
  });

  it("returns no part for a bullet", () => {
    const node = lineToNode({ kind: "bullet", text: "Did: things" });
    expect(partRanges(node)).toEqual({ part1: [0, 11], part2: null });
    expect(partAtOffset(node, 0)).toBeNull();
    expect(partAtOffset(node, 5)).toBeNull();
  });
});

function tab() {
  return docSchema.nodes.tab.create();
}
