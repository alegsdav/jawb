/**
 * PDF fixtures for the import tests, drawn with @react-pdf/renderer. The Harvard-style resume has a centered name
 * and contact line, a bold heading with a rule under it, a "Company ⇥ City" row, an italic "Degree ⇥ Date" row,
 * bullets (one wraps), a section heading and a "Skills:" line with a bold label. Its footer sits at the bottom
 * margin, so the page margins are the fixture's padding.
 */
import { createElement as h } from "react";
import { Document, Image, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

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
