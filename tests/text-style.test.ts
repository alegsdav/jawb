import { describe, expect, it } from "vitest";
import { cleanStyle, defaultStyle, effectiveStyle } from "@/lib/textStyle";
import type { Item } from "@/lib/types";

const normal: Item = {
  id: "i1", title: "Acme", subtitle: "Engineer", location: "Boston", dates: "2025", bullets: [{ id: "b1", text: "Did things" }],
};
const inline: Item = { id: "i2", title: "", subtitle: "", location: "", dates: "", bullets: [] };
const inlineLabel: Item = { ...inline, title: "Languages", subtitle: "Python, SQL" };

describe("defaults", () => {
  it("uses the Harvard defaults for normal items and the header", () => {
    expect(defaultStyle("name")).toEqual({ bold: true, italic: false });
    expect(defaultStyle("contact")).toEqual({ bold: false, italic: false });
    expect(defaultStyle("sectionTitle")).toEqual({ bold: true, italic: false });
    expect(defaultStyle("title", normal)).toEqual({ bold: true, italic: false });
    expect(defaultStyle("subtitle", normal)).toEqual({ bold: false, italic: true });
    expect(defaultStyle("location", normal)).toEqual({ bold: false, italic: false });
    expect(defaultStyle("dates", normal)).toEqual({ bold: false, italic: false });
  });

  it("bolds an inline label only when it has a subtitle, and keeps inline details plain", () => {
    expect(defaultStyle("title", inlineLabel)).toEqual({ bold: true, italic: false });
    expect(defaultStyle("title", inline)).toEqual({ bold: false, italic: false });
    expect(defaultStyle("subtitle", inlineLabel)).toEqual({ bold: false, italic: false });
  });
});

describe("effectiveStyle", () => {
  it("lets override flags win and falls back to the default for the rest", () => {
    expect(effectiveStyle("title", undefined, normal)).toEqual({ bold: true, italic: false });
    expect(effectiveStyle("title", { italic: true }, normal)).toEqual({ bold: true, italic: true });
    expect(effectiveStyle("subtitle", { bold: true, italic: false }, normal)).toEqual({ bold: true, italic: false });
    expect(effectiveStyle("name", { bold: false })).toEqual({ bold: false, italic: false });
  });
});

describe("cleanStyle", () => {
  it("keeps only boolean bold/italic", () => {
    expect(cleanStyle({ bold: true, italic: "yes", extra: 1 })).toEqual({ bold: true });
    expect(cleanStyle({ italic: false })).toEqual({ italic: false });
  });

  it("returns undefined for junk", () => {
    expect(cleanStyle(undefined)).toBeUndefined();
    expect(cleanStyle("bold")).toBeUndefined();
    expect(cleanStyle(null)).toBeUndefined();
    expect(cleanStyle({ bold: 1, italic: "x" })).toBeUndefined();
    expect(cleanStyle({})).toBeUndefined();
  });
});
