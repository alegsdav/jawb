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
  <w:style w:type="paragraph" w:styleId="Ruled"><w:name w:val="Ruled"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="NoRule"><w:name w:val="No rule"/><w:basedOn w:val="Ruled"/>
    <w:pPr><w:pBdr><w:bottom w:val="nil"/></w:pBdr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Entry"><w:name w:val="Entry"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Indented"><w:name w:val="Indented"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="1440"/></w:pPr></w:style>
  <w:style w:type="table" w:styleId="RuledTable"><w:name w:val="Ruled table"/>
    <w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:style>
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
  <w:abstractNum w:abstractNumId="2">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1)"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="3">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="4">
    <w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1."/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>
  <w:num w:numId="4"><w:abstractNumId w:val="3"/></w:num>
  <w:num w:numId="5"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/></w:lvlOverride></w:num>
  <w:num w:numId="6"><w:abstractNumId w:val="4"/></w:num>
  <w:abstractNum w:abstractNumId="5">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="6">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="540" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="7"><w:abstractNumId w:val="5"/></w:num>
  <w:num w:numId="8"><w:abstractNumId w:val="6"/></w:num>
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
  <Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>
</Relationships>`;

/** A section that names the header and footer parts (see RELS): default ones, plus a first-page header with titlePg. */
const SECT_WITH_PARTS = `<w:sectPr><w:headerReference w:type="default" r:id="rId8"/><w:footerReference w:type="default" r:id="rId9"/>
  <w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;

function makeDocx(
  body: string,
  opts: { theme?: boolean; styles?: boolean; numbering?: boolean; parts?: Record<string, string> } = {},
): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`),
    "word/_rels/document.xml.rels": strToU8(RELS),
  };
  if (opts.styles !== false) files["word/styles.xml"] = strToU8(STYLES);
  if (opts.numbering !== false) files["word/numbering.xml"] = strToU8(NUMBERING);
  if (opts.theme !== false) files["word/theme/theme1.xml"] = strToU8(THEME);
  for (const [name, xml] of Object.entries(opts.parts ?? {})) files[name] = strToU8(xml);
  return zipSync(files);
}

/** A header or footer part with the given body paragraphs. */
const PART = (root: "hdr" | "ftr", paras: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${root} ${W}>${paras}</w:${root}>`;
const TEXT_P = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
/** A PAGE field as Word writes it: begin, instruction, separate, the page number, end. */
const PAGE_FIELD_RUNS =
  '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';

/** The text of each top-level block, in order (lists flattened to their paragraphs). */
function blockTexts(doc: DocJSON): string[] {
  const out: string[] = [];
  const walk = (blocks: unknown[]) => {
    for (const b of blocks as { type: string; content?: unknown[] }[]) {
      if (b.type === "paragraph") {
        out.push(((b.content ?? []) as { text?: string }[]).map((n) => n.text ?? "").join(""));
      } else {
        walk(b.content ?? []);
      }
    }
  };
  walk(doc.content);
  return out;
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
          // No right-aligned stop: the tab only lines the text up in a column, so it becomes spaces.
          type: "paragraph",
          attrs: { ...lh, spaceBefore: 6 },
          content: [
            { type: "text", text: "Harvard University", marks: [{ type: "bold" }] },
            { type: "text", text: "    Cambridge, MA" },
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

  it("joins paragraphs inside a table cell with a line break", () => {
    const body = `
      <w:p><w:r><w:t>Body</w:t></w:r></w:p>
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

/** Per top-level paragraph (table rows included): whether a rule is drawn under it. */
function rules(body: string): boolean[] {
  const { doc } = docxToDoc(makeDocx(body));
  return (plain(doc) as { content: { attrs?: { borderBottom?: boolean } }[] }).content.map((p) => p.attrs?.borderBottom === true);
}

const para = (ppr: string, text = "x") => `<w:p><w:pPr>${ppr}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const RULE = '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>';

describe("paragraph rules", () => {
  it("reads nil, none and zero-width borders as no rule, also over a rule from the style", () => {
    const body = [
      para('<w:pStyle w:val="Ruled"/>'),
      para('<w:pStyle w:val="Ruled"/><w:pBdr><w:bottom w:val="nil"/></w:pBdr>'),
      para('<w:pStyle w:val="Ruled"/><w:pBdr><w:bottom w:val="none"/></w:pBdr>'),
      para('<w:pStyle w:val="Ruled"/><w:pBdr><w:bottom w:val="single" w:sz="0" w:space="1" w:color="auto"/></w:pBdr>'),
      para('<w:pStyle w:val="NoRule"/>'),
      para('<w:pBdr><w:bottom w:val="nil"/></w:pBdr>'),
    ].join("");
    expect(rules(body)).toEqual([true, false, false, false, false, false]);
  });

  it("draws one rule under a group of paragraphs with the same border and indent: the last one", () => {
    const body = [
      para(RULE),
      para(RULE),
      para(RULE),
      para(RULE + '<w:ind w:left="360"/>'), // another indent: a group of its own
      para('<w:spacing w:after="0"/>'),
      para('<w:pStyle w:val="Ruled"/>'),
      para('<w:pStyle w:val="Ruled"/>'),
    ].join("");
    expect(rules(body)).toEqual([false, false, true, true, false, false, true]);
  });

  it("draws a between border under each paragraph of the group", () => {
    const between = '<w:pBdr><w:between w:val="single" w:sz="4" w:space="1" w:color="auto"/></w:pBdr>';
    expect(rules(para(between) + para(between))).toEqual([true, true]);
  });

  it("never makes a top, side or box border a rule", () => {
    const body = [
      para('<w:pBdr><w:top w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr>'),
      para(
        '<w:pBdr><w:top w:val="single" w:sz="6" w:space="1" w:color="auto"/><w:left w:val="single" w:sz="6" w:space="4" w:color="auto"/>' +
          '<w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/><w:right w:val="single" w:sz="6" w:space="4" w:color="auto"/></w:pBdr>',
      ),
      para('<w:pBdr><w:left w:val="single" w:sz="18" w:space="4" w:color="auto"/></w:pBdr>'),
    ].join("");
    expect(rules(body)).toEqual([false, false, false]);
  });

  it("keeps table and cell borders out of paragraph rules, and table styles give no rules", () => {
    const body = `<w:tbl><w:tblPr><w:tblBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr>
      <w:tr>
        <w:tc><w:tcPr><w:tcBorders><w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/></w:tcBorders></w:tcPr>
          <w:p><w:pPr>${RULE}</w:pPr><w:r><w:t>Cell</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Right</w:t></w:r></w:p></w:tc>
      </w:tr></w:tbl>` +
      para('<w:pStyle w:val="RuledTable"/>') +
      para(RULE);
    expect(rules(body)).toEqual([false, false, true]);
  });
});

describe("tabs", () => {
  const firstContent = (body: string) => (plain(docxToDoc(makeDocx(body)).doc) as { content: { content: unknown[] }[] }).content[0].content;

  it("keeps a tab that has a right-aligned stop in the paragraph", () => {
    const body = `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr><w:r><w:t>Acme</w:t></w:r><w:r><w:tab/><w:t>Austin</w:t></w:r></w:p>`;
    expect(firstContent(body)).toEqual([{ type: "text", text: "Acme" }, { type: "tab" }, { type: "text", text: "Austin" }]);
  });

  it("turns a tab with no tab stops into spaces", () => {
    const body = `<w:p><w:r><w:t>Languages:</w:t></w:r><w:r><w:tab/><w:t>Python, Java</w:t></w:r></w:p>`;
    expect(firstContent(body)).toEqual([{ type: "text", text: "Languages:    Python, Java" }]);
  });

  it("turns a tab at a left-aligned stop into spaces", () => {
    const body = `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs></w:pPr><w:r><w:t>Skills:</w:t></w:r><w:r><w:tab/><w:t>SQL</w:t></w:r></w:p>`;
    expect(firstContent(body)).toEqual([{ type: "text", text: "Skills:    SQL" }]);
  });

  it("keeps a tab when the right-aligned stop is in the paragraph style", () => {
    const body = `<w:p><w:pPr><w:pStyle w:val="Entry"/></w:pPr><w:r><w:t>Acme</w:t></w:r><w:r><w:tab/><w:t>Austin</w:t></w:r></w:p>`;
    expect(firstContent(body)).toEqual([{ type: "text", text: "Acme" }, { type: "tab" }, { type: "text", text: "Austin" }]);
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

describe("docxToDoc limits", () => {
  it("refuses a zip whose parts inflate past the limit, before inflating them", () => {
    const huge = new Uint8Array(40 * 1024 * 1024); // zeros compress to a few KB
    const zip = zipSync({ "word/document.xml": huge });
    expect(zip.length).toBeLessThan(1024 * 1024);
    expect(() => docxToDoc(zip)).toThrow(/too large/);
  });

  it("refuses absurdly deep XML", () => {
    const deep = "<w:document><w:body>" + "<w:p>".repeat(5000) + "</w:body></w:document>";
    const zip = zipSync({ "word/document.xml": new TextEncoder().encode(deep) });
    expect(() => docxToDoc(zip)).toThrow(/readable Word/);
  });
});

describe("numbered list formats", () => {
  const firstList = (body: string) => (plain(docxToDoc(makeDocx(body)).doc) as { content: { type: string; attrs?: unknown }[] }).content[0];
  const item = (numId: number, text: string) =>
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

  it("maps a lowercase letter level to type a and an uppercase Roman level to type I", () => {
    expect(firstList(item(3, "a")).attrs).toEqual({ type: "a" });
    expect(firstList(item(4, "I")).attrs).toEqual({ type: "I" });
  });

  it("keeps the start of a level, from its own start or from a num's start override", () => {
    expect(firstList(item(6, "c")).attrs).toEqual({ type: "a", start: 3 });
    expect(firstList(item(5, "3")).attrs).toEqual({ start: 3 });
  });

  it("leaves a decimal list from 1 with no list attributes", () => {
    expect(firstList(item(2, "one")).attrs).toBeUndefined();
  });

  it("gives each numbered list its own format when a paragraph separates them", () => {
    const body = item(3, "a") + para("", "between") + item(4, "I");
    const content = (plain(docxToDoc(makeDocx(body)).doc) as { content: { type: string; attrs?: unknown }[] }).content;
    expect(content.map((b) => [b.type, b.attrs])).toEqual([
      ["orderedList", { type: "a" }],
      ["paragraph", { lineHeight: 1 }],
      ["orderedList", { type: "I" }],
    ]);
  });
});

describe("text boxes", () => {
  const box = (text: string) => `<w:txbxContent><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:txbxContent>`;

  it("imports a text box's paragraph once when the run has a Choice and a Fallback", () => {
    const run =
      `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wps:wsp><wps:txbx>${box("Sidebar")}</wps:txbx></wps:wsp></w:drawing></mc:Choice>` +
      `<mc:Fallback><w:pict><v:shape><v:textbox>${box("Sidebar")}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`;
    const { doc } = docxToDoc(makeDocx(`<w:p>${run}<w:r><w:t>Anchor</w:t></w:r></w:p>`));
    expect(blockTexts(doc)).toEqual(["Anchor", "Sidebar"]);
    expect(plain(doc)).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", attrs: { lineHeight: 1 }, content: [{ type: "text", text: "Anchor" }] },
        { type: "paragraph", attrs: { lineHeight: 1 }, content: [{ type: "text", text: "Sidebar" }] },
      ],
    });
  });

  it("puts a text box before its anchoring paragraph when that paragraph is empty", () => {
    const run = `<w:r><w:pict><v:shape><v:textbox>${box("Contact")}</v:textbox></v:shape></w:pict></w:r>`;
    const { doc } = docxToDoc(makeDocx(`${TEXT_P("Body")}<w:p>${run}</w:p>`));
    expect(blockTexts(doc)).toEqual(["Body", "Contact", ""]);
  });
});

describe("headers and footers", () => {
  it("imports the default header's paragraphs at the top of the document", () => {
    const parts = { "word/header1.xml": PART("hdr", TEXT_P("Ada Lovelace")) };
    const { doc } = docxToDoc(makeDocx(`${TEXT_P("Body")}${SECT_WITH_PARTS}`, { parts }));
    expect(blockTexts(doc)).toEqual(["Ada Lovelace", "Body"]);
  });

  it("uses the first-page header when the section has a different first page", () => {
    const parts = {
      "word/header1.xml": PART("hdr", TEXT_P("Default header")),
      "word/header2.xml": PART("hdr", TEXT_P("First page header")),
    };
    const sect = SECT_WITH_PARTS.replace("<w:sectPr>", '<w:sectPr><w:titlePg/>').replace('w:type="default" r:id="rId8"', 'w:type="first" r:id="rId10"');
    const { doc } = docxToDoc(makeDocx(`${TEXT_P("Body")}${sect}`, { parts }));
    expect(blockTexts(doc)).toEqual(["First page header", "Body"]);
  });

  it("reads hyperlinks in a header from the header's own relationships", () => {
    const parts = {
      "word/header1.xml": PART("hdr", `<w:p><w:hyperlink r:id="rId1"><w:r><w:t>Portfolio</w:t></w:r></w:hyperlink></w:p>`),
      "word/_rels/header1.xml.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/ada" TargetMode="External"/></Relationships>',
    };
    const { doc } = docxToDoc(makeDocx(`${TEXT_P("Body")}${SECT_WITH_PARTS}`, { parts }));
    const header = (plain(doc) as { content: { content: { marks?: unknown[] }[] }[] }).content[0];
    expect(header.content[0].marks).toEqual([{ type: "link", attrs: { href: "https://example.com/ada" } }]);
  });

  it("ignores a footer whose only text is a page number", () => {
    const parts = {
      "word/footer1.xml": PART("ftr", `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${PAGE_FIELD_RUNS}</w:p>`),
    };
    const { doc } = docxToDoc(makeDocx(`${TEXT_P("Body")}${SECT_WITH_PARTS}`, { parts }));
    expect(blockTexts(doc)).toEqual(["Body"]);
  });

  it("keeps a footer with text at the end, without its page number", () => {
    const footer = `<w:p><w:r><w:t>Confidential</w:t></w:r><w:r><w:t xml:space="preserve"> · </w:t></w:r>${PAGE_FIELD_RUNS}</w:p>`;
    const parts = { "word/footer1.xml": PART("ftr", footer) };
    const { doc } = docxToDoc(makeDocx(`${TEXT_P("Body")}${SECT_WITH_PARTS}`, { parts }));
    expect(blockTexts(doc)).toEqual(["Body", "Confidential · "]);
  });

  it("ignores a header with no text", () => {
    const parts = { "word/header1.xml": PART("hdr", "<w:p/>") };
    const { doc } = docxToDoc(makeDocx(`${TEXT_P("Body")}${SECT_WITH_PARTS}`, { parts }));
    expect(blockTexts(doc)).toEqual(["Body"]);
  });
});

describe("list indents from the numbering level and the paragraph", () => {
  const listsOf = (body: string) => (plain(docxToDoc(makeDocx(body)).doc) as { content: { type: string; attrs?: Record<string, unknown> }[] }).content;
  /** A list item of a numbering (numId), with optional paragraph properties (pPr) inside its own pPr. */
  const item = (numId: number, text: string, pPr = "") =>
    `<w:p><w:pPr>${pPr}<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

  it("takes the indent of a list from its level's text indent: 360 twips (0.25 in) is 18 points", () => {
    expect(listsOf(item(7, "a"))[0].attrs).toEqual({ indentPt: 18 });
  });

  it("lets the paragraph's own indent override the level's: 720 twips is 36 points", () => {
    expect(listsOf(item(7, "a", '<w:ind w:left="720" w:hanging="360"/>'))[0].attrs).toEqual({ indentPt: 36 });
  });

  it("does not let a paragraph style's indent override the level's, as Word takes the indent from the numbering", () => {
    const styled = `<w:p><w:pPr><w:pStyle w:val="Indented"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr><w:r><w:t>b</w:t></w:r></w:p>`;
    expect(listsOf(styled)[0].attrs).toEqual({ indentPt: 18 });
  });

  it("takes the median of its items' indents, so one item with a larger own indent does not move the list", () => {
    const body = item(7, "a") + item(7, "b") + item(7, "c", '<w:ind w:left="720" w:hanging="360"/>');
    expect(listsOf(body)[0].attrs).toEqual({ indentPt: 18 });
  });

  it("keeps the type and start of a numbered list with its indent: a lowercase list at 540 twips is 27 points", () => {
    expect(listsOf(item(8, "a"))[0].attrs).toEqual({ type: "a", indentPt: 27 });
  });

  it("gives no indent when neither the paragraph nor its level sets one", () => {
    expect(listsOf(item(1, "a"))[0].attrs).toBeUndefined();
  });
});
