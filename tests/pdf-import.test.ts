import { describe, expect, it } from "vitest";
import { flattenDoc, paragraphText } from "@/lib/doc/model";
import { isValidDoc } from "@/lib/doc/extensions";
import type { DocInline, DocJSON, DocMark, DocParagraph, DocText } from "@/lib/doc/types";
import { NO_TEXT_MESSAGE, NoTextError, fontInfo, pdfToDoc } from "@/lib/import/pdfToDoc";
import {
  PAD_SIDES, PAD_TOP_BOTTOM, embeddedFontPdf, harvardPdf, helveticaPdf, imageOnlyPdf, linkedPdf, ruledPdf, shortLinesPdf,
} from "./import-fixtures";

const bytes = (b: Buffer) => new Uint8Array(b);
const PT = 72;

/** The first paragraph whose text starts with `prefix`. */
function paraNamed(doc: DocJSON, prefix: string): DocParagraph {
  const found = flattenDoc(doc).find((p) => p.text.startsWith(prefix));
  if (!found) throw new Error(`no paragraph starts with ${prefix}`);
  return found.node;
}

const marksOfText = (p: DocParagraph, text: string): DocMark[] =>
  (p.content ?? []).find((n): n is DocText => n.type === "text" && n.text === text)?.marks ?? [];

const hasMark = (marks: DocMark[], type: "bold" | "italic") => marks.some((m) => m.type === type);
const textStyle = (marks: DocMark[]) => marks.find((m) => m.type === "textStyle")?.attrs ?? {};

describe("fontInfo", () => {
  it("drops the subset prefix and the style from the family", () => {
    expect(fontInfo("ABCDEF+Calibri-Bold")).toEqual({ family: "Calibri", bold: true, italic: false });
    expect(fontInfo("Garamond,BoldItalic")).toEqual({ family: "Garamond", bold: true, italic: true });
    expect(fontInfo("Helvetica-Oblique")).toEqual({ family: "Helvetica", bold: false, italic: true });
  });

  it("spaces camel case and drops the PostScript suffixes", () => {
    expect(fontInfo("TimesNewRomanPSMT").family).toBe("Times New Roman");
    expect(fontInfo("TimesNewRomanPS-BoldMT")).toEqual({ family: "Times New Roman", bold: true, italic: false });
    expect(fontInfo("ArialMT").family).toBe("Arial");
  });

  it("takes bold and italic from the flags as well as the name", () => {
    expect(fontInfo("Calibri", { bold: true })).toEqual({ family: "Calibri", bold: true, italic: false });
    expect(fontInfo("Calibri", { italic: true }).italic).toBe(true);
    expect(fontInfo("Cambria-Heavy").bold).toBe(true);
  });

  it("has no family for a name pdf.js made up", () => {
    expect(fontInfo("g_d0_f1").family).toBeUndefined();
  });

  it("does not split DejaVu into Deja Vu", () => {
    expect(fontInfo("DejaVuSerif").family).toBe("DejaVu Serif");
    expect(fontInfo("DejaVuSans-Bold")).toEqual({ family: "DejaVu Sans", bold: true, italic: false });
  });
});

describe("pdfToDoc: a Harvard-style resume keeps its layout", () => {
  let doc: DocJSON;
  let page: Awaited<ReturnType<typeof pdfToDoc>>["page"];

  // Imported once: the fixture is rendered and read in one go.
  const ready = (async () => {
    ({ doc, page } = await pdfToDoc(bytes(await harvardPdf())));
  })();

  it("gives the paragraphs in reading order, with bullets without their glyph", async () => {
    await ready;
    expect(flattenDoc(doc).map((p) => p.text)).toEqual([
      "Ada Lovelace",
      "London • ada@example.com • (555) 010-0199",
      "EDUCATION",
      "Harvard University\tCambridge, MA",
      "B.A. in Economics\tMay 2025",
      "Graduated with highest honors",
      "Built a forecasting model for regional housing prices using twelve years of county records, cutting the mean error of the quarterly estimates by a third and presenting the method to the planning committee each spring.",
      "EXPERIENCE",
      "Skills: Python, SQL",
      "Ada Lovelace resume",
    ]);
  });

  it("makes the bullets list items, and joins a wrapped bullet into one", async () => {
    await ready;
    const bullets = flattenDoc(doc).filter((p) => p.listType === "bulletList");
    expect(bullets).toHaveLength(2);
    expect(bullets.every((p) => p.bullet && p.depth === 1)).toBe(true);
    expect(bullets[1].text.endsWith("planning committee each spring.")).toBe(true);
  });

  it("puts the first wide gap of a row at a tab", async () => {
    await ready;
    const row = paraNamed(doc, "Harvard University");
    expect(row.content?.map((n) => n.type)).toEqual(["text", "tab", "text"]);
    expect(paraNamed(doc, "B.A. in Economics").content?.[1]).toEqual({ type: "tab" });
  });

  it("centers the name and the contact line", async () => {
    await ready;
    expect(paraNamed(doc, "Ada Lovelace").attrs.textAlign).toBe("center");
    expect(paraNamed(doc, "London").attrs.textAlign).toBe("center");
    expect(paraNamed(doc, "Skills").attrs.textAlign).toBeUndefined();
  });

  it("puts a rule under each heading as the heading's paragraph border", async () => {
    await ready;
    expect(paraNamed(doc, "EDUCATION").attrs.borderBottom).toBe(true);
    expect(paraNamed(doc, "EXPERIENCE").attrs.borderBottom).toBe(true);
    expect(paraNamed(doc, "Skills").attrs.borderBottom).toBeUndefined();
    expect(doc.content.every((b) => b.type === "paragraph" || b.type === "bulletList" || b.type === "orderedList")).toBe(true);
  });

  it("gives the heading the space above it", async () => {
    await ready;
    expect(paraNamed(doc, "EDUCATION").attrs.spaceBefore).toBeGreaterThan(0);
    expect(paraNamed(doc, "Ada Lovelace").attrs.spaceBefore).toBeUndefined();
  });

  it("gives the sizes, families and bold/italic marks of the runs", async () => {
    await ready;
    const name = marksOfText(paraNamed(doc, "Ada Lovelace"), "Ada Lovelace");
    expect(hasMark(name, "bold")).toBe(true);
    expect(textStyle(name)).toEqual({ fontSize: "16pt", fontFamily: "Times New Roman" });

    const row = paraNamed(doc, "Harvard University");
    expect(hasMark(marksOfText(row, "Harvard University"), "bold")).toBe(true);
    expect(textStyle(marksOfText(row, "Cambridge, MA"))).toEqual({ fontSize: "10pt", fontFamily: "Times New Roman" });

    const degree = marksOfText(paraNamed(doc, "B.A. in Economics"), "B.A. in Economics");
    expect(hasMark(degree, "italic")).toBe(true);

    const skills = paraNamed(doc, "Skills");
    expect(hasMark(marksOfText(skills, "Skills: "), "bold")).toBe(true);
    expect(hasMark(marksOfText(skills, "Python, SQL"), "bold")).toBe(false);
  });

  it("gives the page margins of the fixture's padding", async () => {
    await ready;
    expect(page.marginTop).toBeCloseTo(PAD_TOP_BOTTOM / PT, 1);
    expect(page.marginBottom).toBeCloseTo(PAD_TOP_BOTTOM / PT, 1);
    expect(page.marginLeft).toBeCloseTo(PAD_SIDES / PT, 1);
    expect(page.marginRight).toBeCloseTo(PAD_SIDES / PT, 1);
  });

  it("gives a valid document with a unique id on every paragraph", async () => {
    await ready;
    const ids = flattenDoc(doc).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length >= 8)).toBe(true);
    expect(isValidDoc(doc)).toBe(true);
  });
});

describe("pdfToDoc: other documents and edge cases", () => {
  it("reads another font family by its name", async () => {
    const { doc, page } = await pdfToDoc(bytes(await helveticaPdf()));
    const name = paraNamed(doc, "Grace Hopper");
    expect(textStyle(marksOfText(name, "Grace Hopper"))).toEqual({ fontSize: "14pt", fontFamily: "Helvetica" });
    expect(hasMark(marksOfText(name, "Grace Hopper"), "bold")).toBe(true);
    expect(name.attrs.textAlign).toBeUndefined();
    expect(page.marginLeft).toBeCloseTo(60 / PT, 1);
  });

  it("turns a rule far from the text above it into an empty paragraph with a bottom border", async () => {
    const { doc } = await pdfToDoc(bytes(await ruledPdf()));
    const texts = doc.content.map((b) => (b.type === "paragraph" ? paragraphText(b) : b.type));
    expect(texts).toEqual(["Top line", "", "Below line"]);
    expect(doc.content[1]).toMatchObject({ type: "paragraph", attrs: { borderBottom: true } });
    expect(paraNamed(doc, "Top line").attrs.borderBottom).toBeUndefined();
  });

  it("refuses a PDF with no text, as a scan", async () => {
    const err = await pdfToDoc(bytes(await imageOnlyPdf())).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoTextError);
    expect((err as Error).message).toBe(NO_TEXT_MESSAGE);
  });

  it("rejects bytes that are not a PDF", async () => {
    await expect(pdfToDoc(new TextEncoder().encode("not a pdf"))).rejects.toThrow();
  });
});

describe("pdfToDoc: embedded fonts", () => {
  it("keeps bold, italic and the family of an embedded subset font", async () => {
    const { doc } = await pdfToDoc(bytes(await embeddedFontPdf()));
    const bold = marksOfText(paraNamed(doc, "Bold Carlito"), "Bold Carlito line");
    expect(hasMark(bold, "bold")).toBe(true);
    expect(textStyle(bold).fontFamily).toBe("Carlito");
    const italic = marksOfText(paraNamed(doc, "Italic Carlito"), "Italic Carlito line");
    expect(hasMark(italic, "italic")).toBe(true);
    expect(hasMark(marksOfText(paraNamed(doc, "Plain Carlito"), "Plain Carlito line"), "bold")).toBe(false);
  });
});

describe("pdfToDoc: margins and alignment of short lines", () => {
  it("keeps a centered name centered and the margins symmetric when every line is short", async () => {
    const { doc, page } = await pdfToDoc(bytes(await shortLinesPdf()));
    expect(paraNamed(doc, "Ada Lovelace").attrs.textAlign).toBe("center");
    expect(paraNamed(doc, "Skills").attrs.textAlign).toBeUndefined();
    expect(page.marginRight).toBe(page.marginLeft);
  });
});

describe("pdfToDoc: links", () => {
  const linkOf = (n: DocInline): string | undefined => (n.type === "text" ? n.marks?.find((m) => m.type === "link") : undefined)?.attrs.href;

  it("puts a link mark on exactly the link text, and leaves the rest of the line plain", async () => {
    const { doc } = await pdfToDoc(bytes(await linkedPdf()));
    const contact = paraNamed(doc, "London");
    const nodes = (contact.content ?? []).filter((n): n is DocText => n.type === "text");
    const linked = nodes.filter((n) => linkOf(n)).map((n) => [n.text, linkOf(n)]);
    expect(linked).toEqual([
      ["linkedin.com/in/jane", "https://linkedin.com/in/jane"],
      ["jane@example.com", "mailto:jane@example.com"],
    ]);
    const plain = nodes.filter((n) => !linkOf(n)).map((n) => n.text).join("");
    expect(plain.replace(/\s+/g, " ").trim()).toBe("London • •");
  });

  it("keeps the other formatting of a linked line, and leaves an unlinked line plain", async () => {
    const { doc } = await pdfToDoc(bytes(await linkedPdf()));
    expect(paraNamed(doc, "Jane Doe").attrs.textAlign).toBe("center");
    expect(hasMark(marksOfText(paraNamed(doc, "Jane Doe"), "Jane Doe"), "bold")).toBe(true);
    const plain = paraNamed(doc, "Plain text");
    expect((plain.content ?? []).some((n) => n.type === "text" && n.marks?.some((m) => m.type === "link"))).toBe(false);
  });
});
