import { describe, expect, it } from "vitest";
import { applyPull } from "@/lib/tailor";
import { normalizeResume, reconcileIds } from "@/lib/resume";
import { cleanStyle, defaultStyle, effectiveStyle, toggleStyle } from "@/lib/textStyle";
import type { Item, Resume } from "@/lib/types";

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

describe("toggleStyle", () => {
  it("returns undefined when the result equals the default", () => {
    expect(toggleStyle("title", undefined, "bold", normal)).toEqual({ bold: false, italic: false });
    expect(toggleStyle("title", { bold: false }, "bold", normal)).toBeUndefined();
    expect(toggleStyle("subtitle", { italic: false }, "italic", normal)).toBeUndefined();
  });

  it("flips the effective value and keeps the other flag", () => {
    expect(toggleStyle("subtitle", undefined, "bold", normal)).toEqual({ bold: true, italic: true });
    expect(toggleStyle("subtitle", undefined, "italic", normal)).toEqual({ bold: false, italic: false });
    expect(toggleStyle("name", undefined, "bold")).toEqual({ bold: false, italic: false });
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

function styled(): Resume {
  return {
    version: 2,
    header: { name: "Ada", contact: "ada@x.io", styles: { name: { italic: true }, contact: { bold: true } } },
    sections: [
      {
        id: "s1",
        title: "Experience",
        style: { bold: false },
        items: [{ ...normal, styles: { title: { italic: true }, dates: { bold: true } } }],
      },
    ],
  };
}

describe("normalizeResume", () => {
  it("round-trips styles", () => {
    const r = styled();
    expect(normalizeResume(JSON.parse(JSON.stringify(r)))).toEqual(r);
  });

  it("drops junk style values and keeps the rest", () => {
    const out = normalizeResume({
      header: { name: "A", contact: "", styles: { name: { bold: "yes" }, contact: { italic: true, x: 2 } } },
      sections: [{ id: "s", title: "T", style: "bold", items: [{ id: "i", title: "", subtitle: "", bullets: [], styles: { dates: { bold: true, italic: null } } }] }],
    });
    expect(out.header.styles).toEqual({ contact: { italic: true } });
    expect(out.sections[0].style).toBeUndefined();
    expect(out.sections[0].items[0].styles).toEqual({ dates: { bold: true } });
  });

  it("omits the style keys entirely when there are none", () => {
    const out = normalizeResume({
      header: { name: "A", contact: "B", styles: {} },
      sections: [{ id: "s", title: "T", style: {}, items: [{ id: "i", title: "x", styles: { title: {} } }] }],
    });
    expect(out.header).toEqual({ name: "A", contact: "B" });
    expect("styles" in out.header).toBe(false);
    expect("style" in out.sections[0]).toBe(false);
    expect("styles" in out.sections[0].items[0]).toBe(false);
  });

  it("keeps styles through reconcileIds when the new version has none", () => {
    const prev = styled();
    const next = normalizeResume({
      version: 2,
      header: { name: "Ada", contact: "ada@x.io" },
      sections: [{ id: "new", title: "Experience", items: [{ id: "n", title: "Acme", subtitle: "Engineer", location: "Boston", dates: "2025", bullets: [] }] }],
    });
    const out = reconcileIds(prev, next);
    expect(out.header.styles).toEqual(prev.header.styles);
    expect(out.sections[0].style).toEqual(prev.sections[0].style);
    expect(out.sections[0].items[0].styles).toEqual(prev.sections[0].items[0].styles);
  });
});

describe("copy sites keep styles", () => {
  it("applyPull keeps the copy's header, section and item styles", () => {
    const copy = styled();
    const master: Resume = {
      version: 2,
      header: { name: "Ada L.", contact: "ada@x.io" },
      sections: [{ id: "s1", title: "Experience", items: [{ ...normal, bullets: [{ id: "b1", text: "Did things" }] }] }],
    };
    const { resume } = applyPull(copy, master);
    expect(resume.header.styles).toEqual(copy.header.styles);
    expect(resume.sections[0].style).toEqual({ bold: false });
    expect(resume.sections[0].items[0].styles).toEqual({ title: { italic: true }, dates: { bold: true } });
  });
});
