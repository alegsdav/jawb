/**
 * PDF fixtures for the import tests, drawn with @react-pdf/renderer. The Harvard-style resume has a centered name
 * and contact line, a bold heading with a rule under it, a "Company ⇥ City" row, an italic "Degree ⇥ Date" row,
 * bullets (one wraps), a section heading and a "Skills:" line with a bold label. Its footer sits at the bottom
 * margin, so the page margins are the fixture's padding.
 */
import { createElement as h } from "react";
import { join } from "node:path";
import { Document, Font, Image, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

export const PAD_TOP_BOTTOM = 36; // points (0.5 in)
export const PAD_SIDES = 43; // points (about 0.6 in)

const s = StyleSheet.create({
  page: { paddingTop: PAD_TOP_BOTTOM, paddingBottom: PAD_TOP_BOTTOM, paddingLeft: PAD_SIDES, paddingRight: PAD_SIDES, fontFamily: "Times-Roman", fontSize: 10 },
  name: { fontFamily: "Times-Bold", fontSize: 16, textAlign: "center" },
  center: { textAlign: "center" },
  heading: { fontFamily: "Times-Bold", marginTop: 10, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: "#000", borderBottomStyle: "solid" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  bold: { fontFamily: "Times-Bold" },
  italic: { fontFamily: "Times-Italic" },
  bullet: { flexDirection: "row", paddingLeft: 10 },
  glyph: { width: 10 },
  bulletText: { flex: 1 },
  footer: { position: "absolute", bottom: PAD_TOP_BOTTOM, left: PAD_SIDES, fontSize: 8 },
});

const LONG_BULLET =
  "Built a forecasting model for regional housing prices using twelve years of county records, cutting the mean " +
  "error of the quarterly estimates by a third and presenting the method to the planning committee each spring.";

/** The Harvard-style resume (Times, one page). */
export function harvardPdf(): Promise<Buffer> {
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "LETTER", style: s.page },
        h(Text, { style: s.name }, "Ada Lovelace"),
        h(Text, { style: s.center }, "London • ada@example.com • (555) 010-0199"),
        h(View, { style: s.heading }, h(Text, { style: s.bold }, "EDUCATION")),
        h(
          View,
          { style: s.row },
          h(Text, { style: s.bold }, "Harvard University"),
          h(Text, null, "Cambridge, MA"),
        ),
        h(
          View,
          { style: s.row },
          h(Text, { style: s.italic }, "B.A. in Economics"),
          h(Text, null, "May 2025"),
        ),
        bullet("Graduated with highest honors"),
        bullet(LONG_BULLET),
        h(View, { style: s.heading }, h(Text, { style: s.bold }, "EXPERIENCE")),
        h(Text, null, h(Text, { style: s.bold }, "Skills: "), h(Text, null, "Python, SQL")),
        h(Text, { style: s.footer }, "Ada Lovelace resume"),
      ),
    ),
  );
}

function bullet(text: string) {
  return h(
    View,
    { style: s.bullet },
    h(Text, { style: s.glyph }, "•"),
    h(Text, { style: s.bulletText }, text),
  );
}

/**
 * Bullets whose first line is one text run with its glyph ("• Built ..."), as some exporters write them: the glyph is
 * not a text item of its own. Each wrapped line hangs at the text's left edge (a negative text indent on the first
 * line), so the text starts about a glyph and a space in from the bullet.
 */
export function hangingBulletPdf(): Promise<Buffer> {
  const hang = { marginLeft: 12, textIndent: -12 };
  const second =
    "Shipped a small report generator for the planning committee, which cut the monthly preparation time by half " +
    "across three teams and removed a manual copy step that had caused most of the corrections.";
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "LETTER", style: s.page },
        h(Text, { style: s.bold }, "EXPERIENCE"),
        h(Text, { style: hang }, `• ${LONG_BULLET}`),
        h(Text, { style: hang }, `• ${second}`),
        h(Text, { style: s.bold }, "PROJECTS"),
      ),
    ),
  );
}

/**
 * Bullets whose text starts `indent` points from the margin, the glyph in its own column (as a Word export with a
 * hanging indent writes them). One bullet wraps, so its wrapped line shows where the text starts.
 */
export function indentedBulletPdf(indent = 14): Promise<Buffer> {
  const item = (text: string) =>
    h(
      View,
      { style: { flexDirection: "row" } },
      h(Text, { style: { width: indent } }, "•"),
      h(Text, { style: { flex: 1 } }, text),
    );
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "LETTER", style: s.page },
        h(Text, { style: s.bold }, "EXPERIENCE"),
        item("Graduated with highest honors"),
        item(LONG_BULLET),
        h(Text, { style: s.bold }, "PROJECTS"),
      ),
    ),
  );
}

/** A second document in Helvetica: a bold left-aligned name and a plain line. */
export function helveticaPdf(): Promise<Buffer> {
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "LETTER", style: { paddingTop: 50, paddingBottom: 50, paddingLeft: 60, paddingRight: 60, fontFamily: "Helvetica", fontSize: 11 } },
        h(Text, { style: { fontFamily: "Helvetica-Bold", fontSize: 14 } }, "Grace Hopper"),
        h(Text, null, "Arlington, VA"),
      ),
    ),
  );
}

/** A rule drawn far below the text above it: it is a rule block, not a paragraph border. */
export function ruledPdf(): Promise<Buffer> {
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "LETTER", style: { paddingTop: 36, paddingLeft: 43, paddingRight: 43, fontFamily: "Times-Roman", fontSize: 10 } },
        h(Text, null, "Top line"),
        h(View, { style: { marginTop: 60, height: 1, backgroundColor: "#000" } }),
        h(Text, null, "Below line"),
      ),
    ),
  );
}

/**
 * A centered contact line with two links among plain text: a web link (LinkedIn) and a mailto link. Each link is a
 * PDF Link annotation around exactly its own text.
 */
export function linkedPdf(): Promise<Buffer> {
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "LETTER", style: s.page },
        h(Text, { style: s.name }, "Jane Doe"),
        h(
          Text,
          { style: s.center },
          "London • ",
          h(Link, { src: "https://linkedin.com/in/jane" }, "linkedin.com/in/jane"),
          " • ",
          h(Link, { src: "mailto:jane@example.com" }, "jane@example.com"),
        ),
        h(Text, null, "Plain text with no link."),
      ),
    ),
  );
}

/**
 * A centered contact line of four links separated by " | " in one text run, as a resume's header writes them. The
 * separators and the spaces around each label are not part of its link.
 */
export function linkSeparatorsPdf(): Promise<Buffer> {
  const link = (label: string, src: string) => h(Link, { src }, label);
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "LETTER", style: s.page },
        h(
          Text,
          { style: s.center },
          link("Email", "mailto:jane@example.com"),
          " | ",
          link("LinkedIn", "https://linkedin.com/in/jane"),
          " | ",
          link("GitHub", "https://github.com/jane"),
          " | ",
          link("Portfolio", "https://jane.example.com/"),
        ),
      ),
    ),
  );
}

/**
 * A line with an underlined phrase, a plain phrase, and an underlined link; then a heading with a full-width rule.
 * The underlines are drawn by the viewer's text decoration, so they are thin rules under the text.
 */
export function underlinePdf(): Promise<Buffer> {
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "LETTER", style: s.page },
        h(
          Text,
          null,
          "Plain then ",
          h(Text, { style: { textDecoration: "underline" } }, "Underlined phrase"),
          " and ",
          h(Link, { src: "https://example.com/" }, h(Text, { style: { textDecoration: "underline" } }, "linked")),
          " end.",
        ),
        h(View, { style: s.heading }, h(Text, { style: s.bold }, "SUMMARY")),
      ),
    ),
  );
}

/**
 * Two pages with a page number at the top, and at the bottom a page number ("Page 1 of 2") above a repeated line
 * ("Jane Doe resume"). The body is three lines a page; the furniture is drawn in the header and footer zones.
 */
export function pagedPdf(): Promise<Buffer> {
  const pageNumber = ({ pageNumber: n }: { pageNumber: number }) => String(n);
  const pageOf = ({ pageNumber: n, totalPages: t }: { pageNumber: number; totalPages: number }) => `Page ${n} of ${t}`;
  const page = (n: number) =>
    h(
      Page,
      { key: n, size: "LETTER", style: s.page },
      h(Text, { fixed: true, render: pageNumber, style: { position: "absolute", top: 20, left: PAD_SIDES, fontSize: 8 } }),
      h(Text, null, `Body line one on page ${n}.`),
      h(Text, null, `Body line two on page ${n}.`),
      h(Text, null, `Body line three on page ${n}.`),
      h(Text, { fixed: true, render: pageOf, style: { position: "absolute", bottom: 36, left: PAD_SIDES, fontSize: 8 } }),
      h(Text, { fixed: true, style: { position: "absolute", bottom: 22, left: PAD_SIDES, fontSize: 8 } }, "Jane Doe resume"),
    );
  return renderToBuffer(h(Document, null, page(1), page(2)));
}

/**
 * A paragraph in a box narrower than the page's content, which ends at a right-aligned date: its lines wrap inside
 * the box, so each line ends short of the date's edge. A new sentence after it starts a new paragraph.
 */
export function wrappedPdf(): Promise<Buffer> {
  const body =
    "Relevant coursework includes compilers, distributed systems, databases, operating systems, machine learning, " +
    "and numerical methods, taught in small seminars over several terms.";
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "LETTER", style: { paddingTop: PAD_TOP_BOTTOM, paddingLeft: PAD_SIDES, paddingRight: PAD_SIDES, fontFamily: "Times-Roman", fontSize: 10 } },
        h(Text, { style: { textAlign: "right" } }, "May 2025"),
        h(View, { style: { width: 480 } }, h(Text, null, body)),
        h(Text, null, "Another entry follows."),
      ),
    ),
  );
}

/**
 * Two full-width "Label: list" lines at normal pitch, under a right-aligned date: each is a separate item, not one
 * wrapped paragraph, though the line above each one runs nearly to the edge.
 */
export function labelledLinesPdf(): Promise<Buffer> {
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "LETTER", style: { paddingTop: PAD_TOP_BOTTOM, paddingLeft: PAD_SIDES, paddingRight: PAD_SIDES, fontFamily: "Times-Roman", fontSize: 10 } },
        h(Text, { style: { textAlign: "right" } }, "May 2025"),
        h(View, { style: { width: 500 } }, h(Text, null, "Languages: Python, Java, C++, JavaScript, TypeScript, SQL, Go, Rust, Kotlin, Swift, Bash, MATLAB, R, Scala, Haskell")),
        h(View, { style: { width: 500 } }, h(Text, null, "Frameworks: React, Node.js, Django, FastAPI, Spring Boot, Flask, Express, Next.js, Tailwind, Vue")),
      ),
    ),
  );
}

let carlitoRegistered = false;

/** Carlito (regular, bold, italic) from public/fonts, so the PDF embeds a real subset font, as Word and Docs do. */
function registerCarlito(): void {
  if (carlitoRegistered) return;
  const dir = join(process.cwd(), "public", "fonts");
  Font.register({
    family: "Carlito",
    fonts: [
      { src: join(dir, "carlito-400.woff") },
      { src: join(dir, "carlito-700.woff"), fontWeight: 700 },
      { src: join(dir, "carlito-400-italic.woff"), fontStyle: "italic" },
    ],
  });
  carlitoRegistered = true;
}

/** Three lines in an embedded font: bold, italic and plain. */
export function embeddedFontPdf(): Promise<Buffer> {
  registerCarlito();
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "LETTER", style: { paddingTop: PAD_TOP_BOTTOM, paddingLeft: PAD_SIDES, paddingRight: PAD_SIDES, fontFamily: "Carlito", fontSize: 11 } },
        h(Text, { style: { fontWeight: 700 } }, "Bold Carlito line"),
        h(Text, { style: { fontStyle: "italic" } }, "Italic Carlito line"),
        h(Text, null, "Plain Carlito line"),
      ),
    ),
  );
}

/** A resume whose lines are all short: a centered name and short left-aligned lines, no full-width line. */
export function shortLinesPdf(): Promise<Buffer> {
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "LETTER", style: s.page },
        h(Text, { style: s.name }, "Ada Lovelace"),
        h(Text, null, "Skills"),
        h(Text, null, "SQL"),
      ),
    ),
  );
}

/** A page with a picture and no text (a scan, or an image-only export). */
export function imageOnlyPdf(): Promise<Buffer> {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
    "base64",
  );
  return renderToBuffer(
    h(Document, null, h(Page, { size: "LETTER" }, h(Image, { src: png, style: { width: 100, height: 100 } }))),
  );
}

/**
 * Lines of columns: a "Languages:" label with its value at 110 points (a left column), a four-part row whose last
 * part is set against the right margin (English, a column of stars, Chinese, stars), and a "Company ⇥ City" row whose
 * one gap goes to text at the margin.
 */
export function columnsPdf(): Promise<Buffer> {
  const row = { flexDirection: "row" } as const;
  return renderToBuffer(
    h(
      Document,
      null,
      h(
        Page,
        { size: "LETTER", style: s.page },
        h(View, { style: row }, h(Text, { style: { width: 110 } }, "Languages:"), h(Text, null, "Python, SQL")),
        h(
          View,
          { style: row },
          h(Text, { style: { width: 90 } }, "English"),
          h(Text, { style: { width: 90 } }, "*****"),
          h(Text, { style: { width: 90 } }, "Chinese"),
          h(Text, { style: { flex: 1, textAlign: "right" } }, "*****"),
        ),
        h(View, { style: { ...row, justifyContent: "space-between" } }, h(Text, null, "Company"), h(Text, null, "City, ST")),
      ),
    ),
  );
}
