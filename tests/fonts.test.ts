import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Font } from "@react-pdf/renderer";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cssFontStack, isSansFamily, isSerifFamily, wordSingleLineFactor } from "@/lib/doc/fonts";
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
  it.each(["Latin Modern Roman", "LMRoman12", "LMRoman10-Regular", "CMR10", "CMBX12", "CMU Serif"])("%s is set in the registered CMU Serif face", (family) => {
    expect(pdfFaceKind(family)).toBe("cmuSerif");
    expect(pdfFontFor(family, false, false)).toEqual({ fontFamily: "CMU Serif" });
    expect(pdfFontFor(family, true, true)).toEqual({ fontFamily: "CMU Serif", fontWeight: 700, fontStyle: "italic" });
  });

  it("keeps the other serif names on the built-in Times face", () => {
    expect(pdfFaceKind("TeX Gyre Termes")).toBe("times");
    expect(pdfFaceKind("Nimbus Roman")).toBe("times");
    expect(pdfFontFor("Times New Roman", true, false).fontFamily).toBe("Times-Bold");
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

  it("registers Carlito, both DejaVu families and CMU Serif with the four styles each", () => {
    const families = vi.mocked(Font.register).mock.calls.map(([arg]) => (arg as { family: string }).family);
    expect(families.sort()).toEqual(["CMU Serif", "Carlito", "DejaVu Sans", "DejaVu Serif"]);
    for (const [arg] of vi.mocked(Font.register).mock.calls) {
      expect((arg as { fonts: unknown[] }).fonts).toHaveLength(4);
    }
  });

  it("points every registered font at a woff or ttf file that is served from public/fonts", () => {
    for (const [arg] of vi.mocked(Font.register).mock.calls) {
      for (const font of (arg as { fonts: { src: string }[] }).fonts) {
        expect(/\.(woff|ttf)$/.test(font.src)).toBe(true);
        expect(existsSync(font.src), font.src).toBe(true);
      }
    }
    for (const license of ["dejavu-serif", "dejavu-sans", "cmu-serif"]) {
      expect(existsSync(join(process.cwd(), `public/fonts/${license}-OFL.txt`)), license).toBe(true);
    }
  });

  it("registers CMU Serif from its ttf files, which react-pdf reads", () => {
    const cmu = vi.mocked(Font.register).mock.calls.map(([arg]) => arg as { family: string; fonts: { src: string; fontWeight: number; fontStyle?: string }[] }).find((arg) => arg.family === "CMU Serif");
    expect(cmu?.fonts.map((font) => [font.src.split("/").pop(), font.fontWeight, font.fontStyle ?? "normal"])).toEqual([
      ["cmu-serif-400.ttf", 400, "normal"],
      ["cmu-serif-400-italic.ttf", 400, "italic"],
      ["cmu-serif-700.ttf", 700, "normal"],
      ["cmu-serif-700-italic.ttf", 700, "italic"],
    ]);
  });

  it("serves the CMU Serif web faces that the browser loads for the Latin Modern stack", () => {
    const css = readFileSync(join(process.cwd(), "src/app/fonts.css"), "utf8");
    const urls = [...css.matchAll(/url\("\/fonts\/(cmu-serif-[^"]+\.woff2)"\)/g)].map((match) => match[1]);
    expect(urls.sort()).toEqual(["cmu-serif-400-italic.woff2", "cmu-serif-400.woff2", "cmu-serif-700-italic.woff2", "cmu-serif-700.woff2"]);
    for (const file of urls) expect(existsSync(join(process.cwd(), "public/fonts", file)), file).toBe(true);
    expect(css).toContain(`font-family: "CMU Serif";`);
  });
});

/** Every module the browser path loads for the .docx importer: its own imports, read as text, recursively. */
function importGraph(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const queue = entries.map((file) => resolve(process.cwd(), file));
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const [, spec] of source.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+"([^"]+)"/gm)) {
      const local = spec.startsWith("@/") ? join(process.cwd(), "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(file), spec) : null;
      if (!local) continue;
      const candidates = [`${local}.ts`, `${local}.tsx`, join(local, "index.ts")];
      const found = candidates.find((candidate) => existsSync(candidate));
      if (found) queue.push(found);
    }
  }
  return seen;
}

describe("the .docx importer's font path stays free of the PDF renderer", () => {
  it("does not import @react-pdf/renderer from pdfTextWidths or pdfFaces, directly or through their imports", () => {
    const files = importGraph(["src/lib/pdfTextWidths.ts", "src/lib/pdfFaces.ts"]);
    expect(files.has(resolve(process.cwd(), "src/lib/pdfFaces.ts"))).toBe(true);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/["']@react-pdf\/renderer["']/);
    }
  });
});

describe("wordSingleLineFactor", () => {
  it("gives a known family its Word single line height", () => {
    expect(wordSingleLineFactor("Calibri")).toBe(1.2207);
    expect(wordSingleLineFactor("Arial")).toBe(1.1499);
  });

  it("ignores case and surrounding spaces", () => {
    expect(wordSingleLineFactor("  Times New ROMAN ")).toBe(1.1499);
    expect(wordSingleLineFactor("segoe UI")).toBe(1.3301);
  });

  it("gives an unknown family 1.17, and a missing one too", () => {
    expect(wordSingleLineFactor("Brand New Face")).toBe(1.17);
    expect(wordSingleLineFactor(null)).toBe(1.17);
    expect(wordSingleLineFactor("constructor")).toBe(1.17);
  });

  it("gives LaTeX faces 1.2", () => {
    expect(wordSingleLineFactor("CMR10")).toBe(1.2);
    expect(wordSingleLineFactor("Latin Modern Sans")).toBe(1.2);
  });
});
