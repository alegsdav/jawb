import { existsSync } from "node:fs";
import { join } from "node:path";
import { Font } from "@react-pdf/renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cssFontStack, isSansFamily, isSerifFamily } from "@/lib/doc/fonts";
import { pdfFaceKind, pdfFontFor, registerPdfFonts } from "@/lib/pdfFonts";

vi.mock("@react-pdf/renderer", () => ({
  Font: { register: vi.fn(), registerHyphenationCallback: vi.fn() },
}));

const LATIN_MODERN_SERIF = `"Latin Modern Roman", "LM Roman 10", "CMU Serif", Tinos, "Times New Roman", serif`;
const LATIN_MODERN_SANS = `"Latin Modern Sans", "LM Sans 10", "CMU Sans Serif", Arial, Helvetica, sans-serif`;

describe("LaTeX font families", () => {
  it.each(["Latin Modern Roman", "LMRoman12", "LMRoman10-Regular", "LM Roman 10", "CMR10", "CMBX12", "CMTI10", "CMSL10", "CMU Serif", "Computer Modern"])(
    "%s is serif and gets the Latin Modern serif stack",
    (name) => {
      expect(isSerifFamily(name)).toBe(true);
      expect(isSansFamily(name)).toBe(false);
      expect(cssFontStack(name)).toBe(LATIN_MODERN_SERIF);
    },
  );

  it.each(["Latin Modern Sans", "LMSans10", "LM Sans 10", "CMSS10", "CMU Sans Serif", "Computer Modern Sans"])(
    "%s is sans and gets the Latin Modern sans stack",
    (name) => {
      expect(isSansFamily(name)).toBe(true);
      expect(isSerifFamily(name)).toBe(false);
      expect(cssFontStack(name)).toBe(LATIN_MODERN_SANS);
    },
  );

  it("treats TeX Gyre and Nimbus Roman names as serif", () => {
    for (const name of ["TeX Gyre Termes", "TeX Gyre Pagella", "Nimbus Roman"]) {
      expect(isSerifFamily(name)).toBe(true);
    }
  });

  it("does not match names that only contain similar letters", () => {
    expect(isSerifFamily("CMRX")).toBe(false);
    expect(isSerifFamily("Lmao Gothic")).toBe(false);
    expect(cssFontStack("Calibri")).toBe(`Calibri, Carlito, "Segoe UI", Arial, sans-serif`);
  });

  it("leaves the menu fonts and unknown names unchanged", () => {
    expect(cssFontStack("Times New Roman")).toBe(`"Times New Roman", Times, Tinos, serif`);
    expect(cssFontStack("Verdana")).toBe(`"Verdana", sans-serif`);
  });
});

describe("PDF face for LaTeX families", () => {
  it.each(["Latin Modern Roman", "LMRoman12", "LMRoman10", "CMR10", "CMU Serif"])("%s is set in the PDF Times face", (family) => {
    expect(pdfFaceKind(family)).toBe("times");
    expect(pdfFontFor(family, false, false).fontFamily).toBe("Times-Roman");
    expect(pdfFontFor(family, true, true).fontFamily).toBe("Times-BoldItalic");
  });

  it.each(["Latin Modern Sans", "LMSans10", "CMSS10"])("%s is set in the PDF Helvetica face", (family) => {
    expect(pdfFaceKind(family)).toBe("helvetica");
    expect(pdfFontFor(family, true, false).fontFamily).toBe("Helvetica-Bold");
  });

  it("keeps Calibri and unknown sans families on Carlito", () => {
    expect(pdfFaceKind("Calibri")).toBe("carlito");
    expect(pdfFaceKind("Verdana")).toBe("carlito");
    expect(pdfFaceKind(null)).toBe("carlito");
  });
});

describe("DejaVu families", () => {
  it("names the DejaVu faces with the Times-like or sans fallbacks after them", () => {
    expect(cssFontStack("DejaVu Serif")).toBe(`"DejaVu Serif", Tinos, "Times New Roman", serif`);
    expect(cssFontStack("DejaVu Sans")).toBe(`"DejaVu Sans", Arial, Helvetica, sans-serif`);
  });

  it("classifies DejaVu Serif as serif and DejaVu Sans as sans", () => {
    expect(isSerifFamily("DejaVu Serif")).toBe(true);
    expect(isSansFamily("DejaVu Sans")).toBe(true);
    expect(isSansFamily("DejaVu Serif")).toBe(false);
  });

  it("sets DejaVu runs in the registered DejaVu families, not the built-in faces", () => {
    expect(pdfFaceKind("DejaVu Serif")).toBe("dejavuSerif");
    expect(pdfFaceKind("DejaVu Sans")).toBe("dejavuSans");
    expect(pdfFontFor("DejaVu Serif", false, false)).toEqual({ fontFamily: "DejaVu Serif" });
    expect(pdfFontFor("dejavu serif", true, true)).toEqual({ fontFamily: "DejaVu Serif", fontWeight: 700, fontStyle: "italic" });
    expect(pdfFontFor("DejaVu Sans", true, false)).toEqual({ fontFamily: "DejaVu Sans", fontWeight: 700 });
    expect(pdfFontFor("DejaVu Sans", false, true)).toEqual({ fontFamily: "DejaVu Sans", fontStyle: "italic" });
  });
});

describe("registerPdfFonts", () => {
  beforeAll(() => {
    registerPdfFonts();
  });

  it("registers Carlito and both DejaVu families with the four woff styles each", () => {
    const families = vi.mocked(Font.register).mock.calls.map(([arg]) => (arg as { family: string }).family);
    expect(families.sort()).toEqual(["Carlito", "DejaVu Sans", "DejaVu Serif"]);
    for (const [arg] of vi.mocked(Font.register).mock.calls) {
      expect((arg as { fonts: unknown[] }).fonts).toHaveLength(4);
    }
  });

  it("points every registered font at a woff file that is served from public/fonts", () => {
    for (const [arg] of vi.mocked(Font.register).mock.calls) {
      for (const font of (arg as { fonts: { src: string }[] }).fonts) {
        expect(font.src.endsWith(".woff")).toBe(true);
        expect(existsSync(font.src), font.src).toBe(true);
      }
    }
    expect(existsSync(join(process.cwd(), "public/fonts/dejavu-serif-OFL.txt"))).toBe(true);
    expect(existsSync(join(process.cwd(), "public/fonts/dejavu-sans-OFL.txt"))).toBe(true);
  });
});
