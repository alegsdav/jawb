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
