import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { docxToDoc, DocxError, parseXml } from "@/lib/import/docxToDoc";
import { EMPTY_DOCX_MESSAGE, resumeFromDocx } from "@/lib/import/resumeFromDocx";
import type { DocJSON } from "@/lib/doc/types";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="240" w:after="40"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/>
    <w:rPr><w:sz w:val="24"/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W}>
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="–"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office">
  <a:themeElements><a:fontScheme name="Office">
    <a:majorFont><a:latin typeface="Georgia"/><a:ea typeface=""/></a:majorFont>
    <a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/></a:minorFont>
  </a:fontScheme></a:themeElements>
</a:theme>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:ada@example.com" TargetMode="External"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>
  <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://github.com/ada" TargetMode="External"/>
</Relationships>`;

function makeDocx(body: string, opts: { theme?: boolean; styles?: boolean; numbering?: boolean } = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
    "word/_rels/document.xml.rels": strToU8(RELS),
  };
  if (opts.styles !== false) files["word/styles.xml"] = strToU8(STYLES);
  if (opts.numbering !== false) files["word/numbering.xml"] = strToU8(NUMBERING);
  if (opts.theme !== false) files["word/theme/theme1.xml"] = strToU8(THEME);
  return zipSync(files);
}

/** The document with paragraph ids removed, so expectations stay readable. */
function plain(doc: DocJSON): unknown {
  return JSON.parse(JSON.stringify(doc, (k, v) => (k === "id" ? undefined : v)));
}

const SAMPLE = `
<w:p><w:pPr><w:jc w:val="center"/></w:pPr>
  <w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>Ada Lovelace</w:t></w:r></w:p>
<w:p><w:pPr><w:jc w:val="center"/></w:pPr>
  <w:r><w:t xml:space="preserve">Email: </w:t></w:r>
  <w:hyperlink r:id="rId5"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>ada@example.com</w:t></w:r></w:hyperlink></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr>
  <w:r><w:rPr><w:caps/></w:rPr><w:t>Education</w:t></w:r></w:p>
<w:p><w:pPr><w:spacing w:before="120"/></w:pPr>
  <w:r><w:rPr><w:b/></w:rPr><w:t>Harvard University</w:t></w:r>
  <w:r><w:tab/><w:t>Cambridge, MA</w:t></w:r></w:p>
<w:tbl><w:tblPr/><w:tblGrid/>
  <w:tr>
    <w:tc><w:p><w:r><w:t>Acme &amp; Co</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>2020</w:t></w:r></w:p></w:tc>
  </w:tr>
</w:tbl>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Built X</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Sub point</w:t></w:r></w:p>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>First</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Engineering</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:rFonts w:asciiTheme="minorHAnsi"/></w:rPr><w:t xml:space="preserve">Theme </w:t></w:r><w:r><w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/></w:rPr><w:t>font</w:t></w:r></w:p>
<w:sectPr><w:pgMar w:top="1080" w:right="1080" w:bottom="1440" w:left="1296" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

describe("docxToDoc", () => {
  it("maps paragraphs, runs, tabs, tables, lists, links and page margins", () => {
    const { doc, page } = docxToDoc(makeDocx(SAMPLE));
    const lh = { lineHeight: 1 };
    expect(plain(doc)).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { ...lh, textAlign: "center" },
          content: [{ type: "text", text: "Ada Lovelace", marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontSize: "16pt" } }] }],
        },
        {
          type: "paragraph",
          attrs: { ...lh, textAlign: "center" },
          content: [
            { type: "text", text: "Email: " },
            { type: "text", text: "ada@example.com", marks: [{ type: "underline" }, { type: "link", attrs: { href: "mailto:ada@example.com" } }] },
          ],
        },
        {
          // Bold and caps from the Heading 1 style and the run; the bottom border is kept.
          type: "paragraph",
          attrs: { ...lh, spaceBefore: 12, spaceAfter: 2, borderBottom: true },
          content: [{ type: "text", text: "EDUCATION", marks: [{ type: "bold" }] }],
        },
        {
          type: "paragraph",
          attrs: { ...lh, spaceBefore: 6 },
          content: [
            { type: "text", text: "Harvard University", marks: [{ type: "bold" }] },
            { type: "tab" },
            { type: "text", text: "Cambridge, MA" },
          ],
        },
        // The table row: "Acme & Co" left, a tab, "2020" (the last cell) on the right margin.
        {
          type: "paragraph",
          attrs: { ...lh },
          content: [{ type: "text", text: "Acme & Co" }, { type: "tab" }, { type: "text", text: "2020" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", attrs: { ...lh }, content: [{ type: "text", text: "Built X" }] },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      content: [{ type: "paragraph", attrs: { ...lh }, content: [{ type: "text", text: "Sub point" }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          type: "orderedList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", attrs: { ...lh }, content: [{ type: "text", text: "First" }] }],
            },
          ],
        },
        // Heading 2 is based on Heading 1: bold is inherited, the size comes from Heading 2 (12pt).
        {
          type: "paragraph",
          attrs: { ...lh, spaceBefore: 12, spaceAfter: 2 },
          content: [{ type: "text", text: "Engineering", marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontSize: "12pt" } }] }],
        },
        {
          type: "paragraph",
          attrs: { ...lh, spaceBefore: 12, spaceAfter: 2 },
          content: [
            { type: "text", text: "Theme ", marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontFamily: "Arial" } }] },
            { type: "text", text: "font", marks: [{ type: "bold" }, { type: "textStyle", attrs: { fontFamily: "Georgia" } }] },
          ],
        },
      ],
    });
    expect(page).toEqual({ marginTop: 0.75, marginRight: 0.75, marginBottom: 1, marginLeft: 0.9 });
  });

  it("drops javascript: links and keeps https links", () => {
    const body = `<w:p><w:hyperlink r:id="rId6"><w:r><w:t>bad</w:t></w:r></w:hyperlink><w:hyperlink r:id="rId7"><w:r><w:t>good</w:t></w:r></w:hyperlink></w:p>`;
    const { doc } = docxToDoc(makeDocx(body));
    const para = (plain(doc) as { content: { content: { text: string; marks?: unknown[] }[] }[] }).content[0];
    expect(para.content[0].marks).toBeUndefined();
    expect(para.content[1].marks).toEqual([{ type: "link", attrs: { href: "https://github.com/ada" } }]);
  });

  it("keeps a document without styles, numbering or theme readable", () => {
    const body = `<w:p><w:pPr><w:pStyle w:val="Missing"/><w:numPr><w:numId w:val="9"/></w:numPr></w:pPr><w:r><w:rPr><w:i/></w:rPr><w:t>Plain</w:t></w:r></w:p>`;
    const { doc } = docxToDoc(makeDocx(body, { styles: false, numbering: false, theme: false }));
    expect(plain(doc)).toEqual({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [{ type: "paragraph", attrs: {}, content: [{ type: "text", text: "Plain", marks: [{ type: "italic" }] }] }] }],
        },
      ],
    });
  });

  it("joins paragraphs inside a table cell with a line break and skips text boxes", () => {
    const body = `
      <w:p><w:drawing><w:txbxContent><w:p><w:r><w:t>Box text</w:t></w:r></w:p></w:txbxContent></w:drawing><w:r><w:t>Body</w:t></w:r></w:p>
      <w:tbl><w:tr>
        <w:tc><w:p><w:r><w:t>Line one</w:t></w:r></w:p><w:p><w:r><w:t>Line two</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Right</w:t></w:r></w:p></w:tc>
      </w:tr></w:tbl>`;
    const { doc } = docxToDoc(makeDocx(body));
    const [first, row] = (plain(doc) as { content: { content: unknown[] }[] }).content;
    expect(first.content).toEqual([{ type: "text", text: "Body" }]);
    expect(row.content).toEqual([
      { type: "text", text: "Line one" },
      { type: "hardBreak" },
      { type: "text", text: "Line two" },
      { type: "tab" },
      { type: "text", text: "Right" },
    ]);
  });

  it("reads a .docx's margins as the page setup, falling back to the defaults", () => {
    const { page } = docxToDoc(makeDocx(`<w:p><w:r><w:t>x</w:t></w:r></w:p>`));
    expect(page).toEqual({ marginTop: 0.5, marginBottom: 0.5, marginLeft: 0.6, marginRight: 0.6 });
  });

  it("parses XML entities, CDATA and self-closing tags", () => {
    const root = parseXml('<?xml version="1.0"?><a x="1 &amp; 2"><b/><c><![CDATA[<raw>]]> &#x41;&#66;</c></a>');
    const a = root.kids[0];
    expect(a.attrs.x).toBe("1 & 2");
    expect(a.kids.map((k) => k.tag)).toEqual(["b", "c"]);
    expect(a.kids[1].text).toBe("<raw> AB");
  });

  it("rejects a file that is not a zip", () => {
    expect(() => docxToDoc(strToU8("not a word file"))).toThrow(DocxError);
  });

  it("rejects a zip without a document body", () => {
    const zip = zipSync({ "word/other.xml": strToU8("<x/>") });
    expect(() => docxToDoc(zip)).toThrow(DocxError);
  });
});

describe("resumeFromDocx", () => {
  it("returns a version 4 resume with the document and page setup", () => {
    const r = resumeFromDocx(makeDocx(SAMPLE));
    expect(r.version).toBe(4);
    expect(r.page).toEqual({ marginTop: 0.75, marginRight: 0.75, marginBottom: 1, marginLeft: 0.9 });
    expect(r.doc?.content.length).toBeGreaterThan(0);
  });

  it("refuses a document with no text", () => {
    expect(() => resumeFromDocx(makeDocx(`<w:p/><w:p><w:r><w:t>   </w:t></w:r></w:p>`))).toThrow(EMPTY_DOCX_MESSAGE);
  });
});
