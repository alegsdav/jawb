import { describe, expect, it } from "vitest";
import { cleanFormat, cleanMarks, cleanPara, joinRich, shiftMarks, toRuns, wholeMarks } from "@/lib/richText";

describe("cleanFormat", () => {
  it("keeps only flags that are exactly true", () => {
    expect(cleanFormat({ bold: true, italic: false, underline: 1 })).toEqual({ bold: true });
    expect(cleanFormat({ bold: false, italic: "yes" })).toBeUndefined();
  });

  it("drops the default size and out-of-range sizes", () => {
    expect(cleanFormat({ size: 11 })).toBeUndefined();
    expect(cleanFormat({ size: 7.9 })).toBeUndefined();
    expect(cleanFormat({ size: 29 })).toBeUndefined();
    expect(cleanFormat({ size: Number.NaN })).toBeUndefined();
    expect(cleanFormat({ size: "14" })).toBeUndefined();
    expect(cleanFormat({ size: 8 })).toEqual({ size: 8 });
    expect(cleanFormat({ size: 28 })).toEqual({ size: 28 });
  });

  it("rounds sizes to one decimal", () => {
    expect(cleanFormat({ size: 10.55 })).toEqual({ size: 10.6 });
    expect(cleanFormat({ bold: true, size: 14.04 })).toEqual({ bold: true, size: 14 });
  });

  it("rejects non-objects", () => {
    expect(cleanFormat(null)).toBeUndefined();
    expect(cleanFormat("bold")).toBeUndefined();
    expect(cleanFormat(undefined)).toBeUndefined();
  });
});

describe("cleanMarks", () => {
  it("returns undefined for non-arrays and garbage elements", () => {
    expect(cleanMarks(undefined, 10)).toBeUndefined();
    expect(cleanMarks({ from: 0, to: 2, bold: true }, 10)).toBeUndefined();
    expect(cleanMarks([null, "x", 3, { from: "a", to: 2, bold: true }, { from: 0, to: 2 }], 10)).toBeUndefined();
  });

  it("clamps to the text length and skips empty ranges", () => {
    expect(cleanMarks([{ from: -5, to: 100, bold: true }], 4)).toEqual([{ from: 0, to: 4, bold: true }]);
    expect(cleanMarks([{ from: 6, to: 9, bold: true }], 4)).toBeUndefined();
    expect(cleanMarks([{ from: 3, to: 3, bold: true }, { from: 4, to: 2, bold: true }], 10)).toBeUndefined();
  });

  it("layers overlapping marks: flags OR together", () => {
    expect(cleanMarks([{ from: 0, to: 5, bold: true }, { from: 3, to: 8, italic: true }], 10)).toEqual([
      { from: 0, to: 3, bold: true },
      { from: 3, to: 5, bold: true, italic: true },
      { from: 5, to: 8, italic: true },
    ]);
  });

  it("lets a later size replace an earlier one", () => {
    expect(cleanMarks([{ from: 0, to: 4, size: 14 }, { from: 2, to: 6, size: 16 }], 10)).toEqual([
      { from: 0, to: 2, size: 14 },
      { from: 2, to: 6, size: 16 },
    ]);
  });

  it("merges adjacent segments with equal formats", () => {
    expect(cleanMarks([{ from: 0, to: 2, bold: true }, { from: 2, to: 4, bold: true }], 10)).toEqual([
      { from: 0, to: 4, bold: true },
    ]);
  });

  it("does not merge across a gap", () => {
    expect(cleanMarks([{ from: 0, to: 2, bold: true }, { from: 3, to: 4, bold: true }], 10)).toEqual([
      { from: 0, to: 2, bold: true },
      { from: 3, to: 4, bold: true },
    ]);
  });

  it("sorts and uses the canonical key order", () => {
    const out = cleanMarks([{ from: 5, to: 7, underline: true }, { from: 0, to: 2, bold: true, italic: true }], 10);
    expect(out).toEqual([
      { from: 0, to: 2, bold: true, italic: true },
      { from: 5, to: 7, underline: true },
    ]);
    expect(Object.keys(out![0])).toEqual(["from", "to", "bold", "italic"]);
  });

  it("returns undefined when nothing is left", () => {
    expect(cleanMarks([{ from: 0, to: 0, bold: true }], 5)).toBeUndefined();
    expect(cleanMarks([{ from: 0, to: 3, bold: false }], 5)).toBeUndefined();
    expect(cleanMarks([], 5)).toBeUndefined();
  });
});

describe("cleanPara", () => {
  it("keeps valid fields and drops the rest", () => {
    expect(cleanPara({ align: "left", rule: true, caps: false, spaceBefore: 6.04 })).toEqual({ rule: true, spaceBefore: 6 });
    expect(cleanPara({ align: "center" })).toEqual({ align: "center" });
    expect(cleanPara({ align: "right", caps: true })).toEqual({ align: "right", caps: true });
  });

  it("validates spaceBefore to (0, 48]", () => {
    expect(cleanPara({ spaceBefore: 0 })).toBeUndefined();
    expect(cleanPara({ spaceBefore: -1 })).toBeUndefined();
    expect(cleanPara({ spaceBefore: 49 })).toBeUndefined();
    expect(cleanPara({ spaceBefore: 48 })).toEqual({ spaceBefore: 48 });
    expect(cleanPara({ spaceBefore: "6" })).toBeUndefined();
  });

  it("rejects non-objects and empty input", () => {
    expect(cleanPara(undefined)).toBeUndefined();
    expect(cleanPara("center")).toBeUndefined();
    expect(cleanPara({})).toBeUndefined();
  });
});

describe("wholeMarks", () => {
  it("covers the whole text with the cleaned format", () => {
    expect(wholeMarks("abc", { bold: true, size: 14 })).toEqual([{ from: 0, to: 3, bold: true, size: 14 }]);
  });

  it("is undefined for empty text or an empty format", () => {
    expect(wholeMarks("", { bold: true })).toBeUndefined();
    expect(wholeMarks("abc", { size: 11 })).toBeUndefined();
    expect(wholeMarks("abc", undefined)).toBeUndefined();
  });
});

describe("shiftMarks", () => {
  it("moves every range without cleaning", () => {
    expect(shiftMarks([{ from: 1, to: 2, bold: true }], 3)).toEqual([{ from: 4, to: 5, bold: true }]);
    expect(shiftMarks(undefined, 3)).toEqual([]);
  });
});

describe("joinRich", () => {
  it("shifts marks by the text before them and merges what becomes adjacent", () => {
    const out = joinRich([
      { text: "ab", marks: [{ from: 0, to: 2, bold: true }] },
      { text: "cd", marks: [{ from: 0, to: 2, bold: true }] },
      { text: "ef" },
    ]);
    expect(out).toEqual({ text: "abcdef", marks: [{ from: 0, to: 4, bold: true }] });
  });

  it("omits the marks key when there are none", () => {
    const out = joinRich([{ text: "a" }, { text: "b" }]);
    expect(out).toEqual({ text: "ab" });
    expect("marks" in out).toBe(false);
  });
});

describe("toRuns", () => {
  it("covers the whole text in order with gaps filled by plain runs", () => {
    const text = "abcdefgh";
    const runs = toRuns(text, [
      { from: 5, to: 7, bold: true },
      { from: 0, to: 3, bold: true },
      { from: 2, to: 4, italic: true },
    ]);
    expect(runs.map((r) => r.text).join("")).toBe(text);
    expect(runs).toEqual([
      { text: "ab", bold: true, italic: false, underline: false, size: 11 },
      { text: "c", bold: true, italic: true, underline: false, size: 11 },
      { text: "d", bold: false, italic: true, underline: false, size: 11 },
      { text: "e", bold: false, italic: false, underline: false, size: 11 },
      { text: "fg", bold: true, italic: false, underline: false, size: 11 },
      { text: "h", bold: false, italic: false, underline: false, size: 11 },
    ]);
  });

  it("reports sizes and underline", () => {
    expect(toRuns("ab", [{ from: 1, to: 2, size: 14, underline: true }])).toEqual([
      { text: "a", bold: false, italic: false, underline: false, size: 11 },
      { text: "b", bold: false, italic: false, underline: true, size: 14 },
    ]);
  });

  it("gives no runs for empty text", () => {
    expect(toRuns("", [{ from: 0, to: 3, bold: true }])).toEqual([]);
  });
});
