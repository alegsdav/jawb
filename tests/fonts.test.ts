import { describe, expect, it } from "vitest";
import { cssFontStack, isSansFamily, isSerifFamily } from "@/lib/doc/fonts";
import { pdfFaceKind, pdfFontFor } from "@/lib/pdfFonts";

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
