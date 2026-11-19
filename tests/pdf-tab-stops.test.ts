import { renderToBuffer } from "@react-pdf/renderer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { ResumePdf } from "@/components/ResumePdf";
import { paragraph } from "@/lib/doc/model";
import { PAGE_DEFAULTS, type DocJSON } from "@/lib/doc/types";
import { PX_PER_IN, tabGapPx } from "@/lib/docRender";
import { textWidthPt } from "@/lib/pdfTextWidths";
import { emptyResume, withDoc } from "@/lib/resume";

describe("textWidthPt", () => {
  it("uses the standard AFM widths for the built-in faces (1/1000 em)", () => {
    expect(textWidthPt("a", "Times New Roman", false, false, 10)).toBeCloseTo(4.44);
    expect(textWidthPt("ab", "Times New Roman", false, false, 10)).toBeCloseTo(9.44);
    expect(textWidthPt("a", "Arial", false, false, 10)).toBeCloseTo(5.56);
  });

  it("scales with the size and is wider in bold", () => {
    const regular = textWidthPt("Name", "Calibri", false, false, 11);
    expect(textWidthPt("Name", "Calibri", false, false, 22)).toBeCloseTo(regular * 2);
    expect(textWidthPt("Name", "Calibri", true, false, 11)).toBeGreaterThan(regular);
  });

  it("falls back to an average width for a character no table has", () => {
    expect(textWidthPt("é", "Calibri", false, false, 10)).toBeCloseTo(5);
  });
});

/** A line with two earlier tabs and a right-aligned end, in Calibri 11pt (the default). */
const columns: DocJSON = { type: "doc", content: [paragraph("Name\tRole\tDate")] };

describe("PDF tab stops", () => {
  it("starts the text after an earlier tab on the editor's 0.5in stop", async () => {
    const buffer = await renderToBuffer(ResumePdf({ resume: withDoc(emptyResume(), columns) }));
    const task = getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false });
    const page = await (await task.promise).getPage(1);
    const items = (await page.getTextContent()).items.filter((it) => "str" in it) as { str: string; transform: number[] }[];
    const x = (text: string) => items.find((it) => it.str === text)!.transform[4];

    // Name's width in px sets its stop: the editor's rule, from the text's width and the left margin.
    const left = PAGE_DEFAULTS.marginLeft * 72;
    const nameWidthPx = (textWidthPt("Name", "Calibri", false, false, 11) * PX_PER_IN) / 72;
    const roleX = left + ((nameWidthPx + tabGapPx(nameWidthPx)) * 72) / PX_PER_IN;
    expect(x("Name")).toBeCloseTo(left, 1);
    expect(x("Role")).toBeCloseTo(roleX, 1);
    await task.destroy();
  });
});

describe("DejaVu widths", () => {
  it("measures DejaVu runs with their own tables, bold wider than regular", async () => {
    const { textWidthPt } = await import("@/lib/pdfTextWidths");
    const serif = textWidthPt("Resume", "DejaVu Serif", false, false, 10);
    const bold = textWidthPt("Resume", "DejaVu Serif", true, false, 10);
    const sans = textWidthPt("Resume", "DejaVu Sans", false, true, 10);
    expect(serif).toBeGreaterThan(30);
    expect(bold).toBeGreaterThan(serif);
    expect(sans).toBeGreaterThan(0);
  });
});

describe("CMU Serif widths", () => {
  it("measures Latin Modern Roman with the CMU Serif table, not Times", () => {
    // CMU Serif's "a" is 500/1000 em and its space 333/1000 em; Times' "a" is 444.
    expect(textWidthPt("a", "Latin Modern Roman", false, false, 10)).toBeCloseTo(5);
    expect(textWidthPt(" ", "CMU Serif", false, false, 10)).toBeCloseTo(3.33);
    expect(textWidthPt("a", "Times New Roman", false, false, 10)).toBeCloseTo(4.44);
  });

  it("measures bold and italic CMU runs with their own tables", () => {
    const regular = textWidthPt("Resume", "CMU Serif", false, false, 10);
    expect(textWidthPt("Resume", "CMU Serif", true, false, 10)).toBeGreaterThan(regular);
    expect(textWidthPt("Resume", "CMU Serif", false, true, 10)).not.toBeCloseTo(regular);
    expect(textWidthPt("Resume", "LMRoman12", false, false, 10)).toBeCloseTo(regular);
  });
});

describe("LaTeX resume PDF", () => {
  const latin = (text: string) => paragraph(text, { marks: [{ type: "textStyle", attrs: { fontFamily: "Latin Modern Roman" } }] });

  it("embeds CMU Serif, not Times, for a Latin Modern Roman paragraph", async () => {
    const buffer = await renderToBuffer(ResumePdf({ resume: withDoc(emptyResume(), { type: "doc", content: [latin("A paragraph in Latin Modern Roman.")] }) }));
    const fonts = [...Buffer.from(buffer).toString("latin1").matchAll(/\/BaseFont\s*\/([^\s/]+)/g)].map((match) => match[1]);
    expect(fonts.some((name) => name.includes("CMUSerif"))).toBe(true);
    expect(fonts.some((name) => name.startsWith("Times"))).toBe(false);
  });

  it("places tab stops with the CMU Serif widths of the LaTeX run", async () => {
    const doc: DocJSON = { type: "doc", content: [latin("Name\tRole\tDate")] };
    const buffer = await renderToBuffer(ResumePdf({ resume: withDoc(emptyResume(), doc) }));
    const task = getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false });
    const page = await (await task.promise).getPage(1);
    const items = (await page.getTextContent()).items.filter((it) => "str" in it) as { str: string; transform: number[] }[];
    const x = (text: string) => items.find((it) => it.str === text)!.transform[4];

    const left = PAGE_DEFAULTS.marginLeft * 72;
    const nameWidthPx = (textWidthPt("Name", "Latin Modern Roman", false, false, 11) * PX_PER_IN) / 72;
    const roleX = left + ((nameWidthPx + tabGapPx(nameWidthPx)) * 72) / PX_PER_IN;
    expect(x("Role")).toBeCloseTo(roleX, 1);
    await task.destroy();
  });
});
