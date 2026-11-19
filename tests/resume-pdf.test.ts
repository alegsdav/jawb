import { renderToBuffer } from "@react-pdf/renderer";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { ResumePdf } from "@/components/ResumePdf";
import { pdfFontFor } from "@/lib/pdfFonts";
import { hangingMarkerOf, linesWithMarker, renderBlocks, type RenderParagraph } from "@/lib/docRender";
import { paragraph } from "@/lib/doc/model";
import { pdfToDoc } from "@/lib/import/pdfToDoc";
import type { DocJSON, DocList, DocListItem, DocMark, DocParagraph, DocText, ParagraphAttrs } from "@/lib/doc/types";
import { emptyResume, withDoc } from "@/lib/resume";

const bold: DocMark = { type: "bold" };
const size = (pt: string): DocMark => ({ type: "textStyle", attrs: { fontSize: pt, fontFamily: null } });
const font = (family: string): DocMark => ({ type: "textStyle", attrs: { fontSize: null, fontFamily: family } });

const para = (text: string, attrs: Partial<ParagraphAttrs> = {}, marks?: DocMark[]): DocParagraph =>
  paragraph(text, { attrs, marks });
const item = (...content: (DocParagraph | DocList)[]): DocListItem => ({ type: "listItem", content });
const bullets = (...items: DocListItem[]): DocList => ({ type: "bulletList", content: items });
const numbered = (...items: DocListItem[]): DocList => ({ type: "orderedList", attrs: { start: 1 }, content: items });

/** One of each feature: centered 16pt bold name, a tab line, a bordered heading, lists, a centered bullet, a hard break, an empty paragraph, three font families. */
const doc: DocJSON = {
  type: "doc",
  content: [
    para("Ada Lovelace", { textAlign: "center" }, [bold, size("16pt")]),
    para("London | ada@example.com", { textAlign: "center" }),
    para("Analytical Engine Ltd\tLondon, UK", {}, [bold]),
    para("EXPERIENCE", { borderBottom: true, spaceBefore: 6 }, [bold]),
    bullets(
      item(para("Wrote the first algorithm"), bullets(item(para("Nested detail")))),
      item(para("Documented the instruction set")),
    ),
    numbered(item(para("First step")), item(para("Second step"))),
    bullets(item(para("Centered bullet", { textAlign: "center" }))),
    para("Line one\nLine two"),
    para(""),
    para("Set in Times New Roman", {}, [font("Times New Roman")]),
    para("Set in Verdana", {}, [font("Verdana")]),
    para("Set in Calibri", {}, [font("Calibri")]),
  ],
};

const resume = withDoc(emptyResume(), doc);

describe("pdfFontFor", () => {
  it.each([
    [null, false, false, "Carlito"],
    ["Calibri", false, false, "Carlito"],
    ["Verdana", false, false, "Carlito"],
    ["Times New Roman", false, false, "Times-Roman"],
    ["Georgia", true, false, "Times-Bold"],
    ["Garamond", false, true, "Times-Italic"],
    ["Times", true, true, "Times-BoldItalic"],
    ["Arial", false, false, "Helvetica"],
    ["Helvetica", true, false, "Helvetica-Bold"],
    ["Open Sans", false, true, "Helvetica-Oblique"],
  ])("%s bold=%s italic=%s -> %s", (family, b, i, name) => {
    expect(pdfFontFor(family, b, i).fontFamily).toBe(name);
  });

  it("uses Carlito weight and style props for Calibri", () => {
    expect(pdfFontFor("Calibri", true, true)).toEqual({ fontFamily: "Carlito", fontWeight: 700, fontStyle: "italic" });
    expect(pdfFontFor("Calibri", false, false)).toEqual({ fontFamily: "Carlito" });
  });
});

describe("renderBlocks (the shared layout)", () => {
  const blocks = renderBlocks(doc);
  /** The paragraph whose text starts with `start` (the blocks are in document order). */
  const at = (start: string): RenderParagraph => {
    const found = blocks.find((p) => p.lines.map((l) => l.left.concat(l.right ?? []).map((r) => r.text).join("")).join("\n").startsWith(start));
    if (!found) throw new Error(`no paragraph starts with ${start}`);
    return found;
  };
  const [name, contact, tabLine, heading] = [at("Ada"), at("London"), at("Analytical"), at("EXPERIENCE")];
  const nested = at("Nested detail");
  const ordered = at("First step");
  const centered = at("Centered bullet");
  const hard = at("Line one");
  const empty = blocks[blocks.indexOf(hard) + 1];
  const [times, verdana, calibri] = [at("Set in Times"), at("Set in Verdana"), at("Set in Calibri")];

  it("centers the 16pt bold name", () => {
    expect(name.align).toBe("center");
    expect(name.lines[0].left[0].style).toMatchObject({ bold: true, sizePt: 16 });
    expect(contact.align).toBe("center");
  });

  it("splits a tab line into left and right parts", () => {
    expect(tabLine.lines[0].left.map((r) => r.text).join("")).toBe("Analytical Engine Ltd");
    expect(tabLine.lines[0].right?.map((r) => r.text).join("")).toBe("London, UK");
  });

  it("marks the bordered heading", () => {
    expect(heading.rule).toBe(true);
    expect(heading.spaceBeforePt).toBe(6);
  });

  it("hangs bullet markers per level and indents nested text", () => {
    expect(nested.marker).toMatchObject({ text: "◦", x: 18 });
    expect(nested.textIndentPt).toBe(36);
    const wrote = at("Wrote the first");
    expect(wrote.marker).toMatchObject({ text: "•", x: 0 });
    expect(wrote.textIndentPt).toBe(18);
  });

  it("numbers an ordered list", () => {
    expect(ordered.marker?.text).toBe("1.");
    expect(at("Second step").marker?.text).toBe("2.");
  });

  it("puts a centered bullet's marker inline, with no indent", () => {
    expect(centered.markerInline).toBe(true);
    expect(hangingMarkerOf(centered)).toBeNull();
    expect(centered.textIndentPt).toBe(0);
    expect(linesWithMarker(centered)[0].left.map((r) => r.text).join("")).toBe("• Centered bullet");
  });

  it("breaks a hard break into two lines", () => {
    expect(hard.lines.map((l) => l.left.map((r) => r.text).join(""))).toEqual(["Line one", "Line two"]);
  });

  it("keeps an empty paragraph one line tall", () => {
    expect(empty.lines).toHaveLength(1);
    expect(empty.lines[0].left[0].text).toBe(" ");
  });

  it("draws a horizontal line as an empty paragraph with a bottom border, one line tall", () => {
    const [line] = renderBlocks({ type: "doc", content: [para("", { borderBottom: true })] });
    expect(line.rule).toBe(true);
    expect(line.lines).toHaveLength(1);
    expect(line.lines[0].left[0].text).toBe(" ");
  });

  it("carries the font family of each run", () => {
    expect(times.lines[0].left[0].style.fontFamily).toBe("Times New Roman");
    expect(verdana.lines[0].left[0].style.fontFamily).toBe("Verdana");
    expect(calibri.lines[0].left[0].style.fontFamily).toBe("Calibri");
  });
});

describe("ResumePdf", () => {
  it("renders the document to a PDF buffer", async () => {
    const buffer = await renderToBuffer(ResumePdf({ resume }));
    expect(buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(2000);
  });

  it("writes each text once, in order, with one marker per bullet", async () => {
    const buffer = await renderToBuffer(ResumePdf({ resume }));
    const task = getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false });
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items.map((it) => ("str" in it ? it.str : "")).join("\n");

    expect(text.split("•").length - 1).toBe(3);
    // "◦" is drawn as a shape (Carlito has no such glyph), so it is not in the text.
    expect(text.split("◦").length - 1).toBe(0);
    expect(text).toContain("1.");
    expect(text).toContain("2.");
    expect(text.indexOf("Ada Lovelace")).toBeLessThan(text.indexOf("Analytical Engine"));
    expect(text.indexOf("Analytical Engine")).toBeLessThan(text.indexOf("Wrote the first algorithm"));
    expect(text.indexOf("Wrote the first algorithm")).toBeLessThan(text.indexOf("Nested detail"));
    expect(text.indexOf("Nested detail")).toBeLessThan(text.indexOf("Set in Verdana"));
    expect(text.split("Wrote the first algorithm").length - 1).toBe(1);
    expect(text).toContain("Set in Times New Roman");
    await task.destroy();
  });
});

/** A paragraph with two links: a web link and a mailto link, among plain text. */
const linked: DocJSON = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { id: "link-line-1", textAlign: "center" },
      content: [
        { type: "text", text: "Jane Doe • " },
        { type: "text", text: "linkedin.com/in/jane", marks: [{ type: "link", attrs: { href: "https://linkedin.com/in/jane" } }] },
        { type: "text", text: " • " },
        { type: "text", text: "jane@example.com", marks: [{ type: "link", attrs: { href: "mailto:jane@example.com" } }] },
      ],
    },
  ],
};
const linkedResume = withDoc(emptyResume(), linked);

describe("links in the read-only layout and the PDF", () => {
  it("carries the href on the runs of a linked text", () => {
    const [line] = renderBlocks(linked)[0].lines;
    const runs = [...line.left, ...(line.right ?? [])];
    expect(runs.filter((r) => r.href).map((r) => [r.text, r.href])).toEqual([
      ["linkedin.com/in/jane", "https://linkedin.com/in/jane"],
      ["jane@example.com", "mailto:jane@example.com"],
    ]);
    expect(runs[0].href).toBeUndefined();
  });

  it("writes a Link annotation with each URL into the PDF", async () => {
    const buffer = await renderToBuffer(ResumePdf({ resume: linkedResume }));
    const task = getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false });
    const pdf = await task.promise;
    const annots = await (await pdf.getPage(1)).getAnnotations();
    const urls = annots.filter((a) => a.subtype === "Link").map((a) => a.url ?? a.unsafeUrl);
    expect(urls).toEqual(["https://linkedin.com/in/jane", "mailto:jane@example.com"]);
    await task.destroy();
  });

  it("keeps the same link marks on the same text after ResumePdf and pdfToDoc", async () => {
    const buffer = await renderToBuffer(ResumePdf({ resume: linkedResume }));
    const { doc } = await pdfToDoc(new Uint8Array(buffer));
    const nodes = doc.content
      .flatMap((b) => (b.type === "paragraph" ? (b.content ?? []) : []))
      .filter((n): n is DocText => n.type === "text" && !!n.marks?.some((m) => m.type === "link"));
    expect(nodes.map((n) => [n.text, n.marks?.find((m) => m.type === "link")])).toEqual([
      ["linkedin.com/in/jane", { type: "link", attrs: { href: "https://linkedin.com/in/jane" } }],
      ["jane@example.com", { type: "link", attrs: { href: "mailto:jane@example.com" } }],
    ]);
  });
});
