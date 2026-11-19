import { Document, Link, Page, Text, View } from "@react-pdf/renderer";
import { createElement as h, type ReactElement } from "react";
import { pdfFontFor, registerPdfFonts } from "@/lib/pdfFonts";
import {
  PX_PER_IN, hangingMarkerOf, linesWithMarker, pageOf, renderBlocks, splitAtTabs, tabGapsPx, type Run, type RenderLine,
  type RenderMarker, type RenderParagraph, type RunStyle,
} from "@/lib/docRender";
import { textWidthPt } from "@/lib/pdfTextWidths";
import { resumeDoc } from "@/lib/resume";
import type { Resume } from "@/lib/types";

const POINTS_PER_INCH = 72;
/** A px at 96dpi is three quarters of a point: the stop math works in px, the PDF in pt. */
const PT_PER_PX = POINTS_PER_INCH / PX_PER_IN;
const RULE = { borderBottomWidth: 0.75, borderBottomColor: "#000" };
/** Carlito has no "◦" or "▪": those markers are drawn as shapes, and inline ones use an en dash. */
const SHAPE_MARKERS = new Set(["◦", "▪"]);
const inlineGlyph = (text: string): string => (SHAPE_MARKERS.has(text) ? "–" : text);

/** The font props of a run style (family, weight, italic), its size and line spacing (react-pdf: a multiplier). */
function fontProps(s: RunStyle, lineHeight: number) {
  return { ...pdfFontFor(s.fontFamily, s.bold, s.italic), fontSize: s.sizePt, lineHeight };
}

/** Links are blue and underlined, as in the editor and the read-only page. */
const LINK_COLOR = "#1155cc";

/**
 * Runs as nested Text, each with its own font, size and underline. A run with a link is a PDF Link around its text, so
 * the link is clickable in the downloaded file.
 */
function runNodes(runs: Run[], lineHeight: number): ReactElement[] {
  return runs.map((run, i) => {
    const underline = run.href || run.style.underline;
    const style = {
      ...fontProps(run.style, lineHeight),
      textDecoration: (underline ? "underline" : "none") as "underline" | "none",
      ...(run.href ? { color: LINK_COLOR } : {}),
    };
    if (!run.href) return h(Text, { key: i, style }, run.text);
    return h(Link, { key: i, src: run.href, style }, run.text);
  });
}

/** The width of a run of text in px, from the PDF face's metrics (see pdfTextWidths). */
function runsWidthPx(runs: Run[]): number {
  const pt = runs.reduce(
    (sum, r) => sum + textWidthPt(r.text, r.style.fontFamily, r.style.bold, r.style.italic, r.style.sizePt),
    0,
  );
  return pt / PT_PER_PX;
}

/**
 * The left side of a line. Without earlier tabs it is one text. With them, each part is drawn where the editor puts
 * it: the parts sit in a row, and a fixed-width gap after each part carries it to the next 0.5in stop (tabGapsPx),
 * so no line is laid out by guesswork.
 */
function leftNode(runs: Run[], p: RenderParagraph): ReactElement {
  const parts = splitAtTabs(runs);
  if (parts.length === 1) return h(Text, { style: { textAlign: p.align, flexShrink: 1 } }, ...runNodes(runs, p.lineHeight));
  const gaps = tabGapsPx(parts.map(runsWidthPx));
  const children: ReactElement[] = [];
  parts.forEach((part, i) => {
    if (part.length) children.push(h(Text, { key: `t${i}` }, ...runNodes(part, p.lineHeight)));
    if (i < gaps.length) children.push(h(View, { key: `g${i}`, style: { width: gaps[i] * PT_PER_PX } }));
  });
  return h(View, { style: { flexDirection: "row", flexShrink: 1 } }, ...children);
}

/** A line: its text, or the text before a tab at the left and after it at the right margin. */
function lineNode(line: RenderLine, p: RenderParagraph, key: number): ReactElement {
  if (!line.right) return h(View, { key }, leftNode(line.left, p));
  return h(
    View,
    { key, style: { flexDirection: "row", justifyContent: "space-between" } },
    leftNode(line.left, p),
    h(Text, { style: { textAlign: "right" } }, ...runNodes(line.right, p.lineHeight)),
  );
}

/**
 * A hanging bullet or number, as wide as the indent before the text. "◦" and "▪" are drawn as shapes (a hollow and
 * a solid dot), centred on the x-height of the first line.
 */
function markerNode(marker: RenderMarker, width: number, lineHeight: number): ReactElement {
  const sizePt = marker.style.sizePt;
  const lineHeightPt = sizePt * lineHeight;
  if (!SHAPE_MARKERS.has(marker.text)) {
    return h(Text, { style: { ...fontProps(marker.style, lineHeight), width } }, marker.text);
  }
  const d = sizePt * 0.32;
  const shape = marker.text === "◦" ? { borderWidth: 0.6, borderColor: "#000", borderRadius: d / 2 } : { backgroundColor: "#000" };
  return h(
    View,
    { style: { width, height: lineHeightPt } },
    h(View, { style: { marginTop: lineHeightPt * 0.58 - d / 2, width: d, height: d, ...shape } }),
  );
}

function paragraphNode(p: RenderParagraph, key: number): ReactElement {
  const lines = h(View, { style: { flex: 1 } }, ...linesWithMarker(p, inlineGlyph).map((line, i) => lineNode(line, p, i)));
  const m = hangingMarkerOf(p);
  const row = h(
    View,
    { style: { flexDirection: "row", paddingLeft: m ? m.x : p.textIndentPt } },
    ...(m ? [markerNode(m, p.textIndentPt - m.x, p.lineHeight)] : []),
    lines,
  );
  return h(
    View,
    {
      key,
      style: {
        marginTop: p.spaceBeforePt,
        marginBottom: p.spaceAfterPt,
        ...(p.rule ? { ...RULE, paddingBottom: 1 } : {}),
      },
    },
    row,
  );
}

/**
 * The resume as a PDF, laid out from the same model as the read-only page (see src/lib/docRender.ts): US Letter
 * with the page setup's margins. Built with createElement (not JSX) so the test runner can import this file
 * (tsconfig sets jsx: preserve).
 */
export function ResumePdf({ resume }: { resume: Resume }) {
  registerPdfFonts();
  const page = pageOf(resume);
  const blocks = renderBlocks(resumeDoc(resume));
  return h(
    Document,
    { title: `${resume.header.name} Resume`, author: resume.header.name },
    h(
      Page,
      {
        size: "LETTER",
        style: {
          paddingTop: page.marginTop * POINTS_PER_INCH,
          paddingBottom: page.marginBottom * POINTS_PER_INCH,
          paddingLeft: page.marginLeft * POINTS_PER_INCH,
          paddingRight: page.marginRight * POINTS_PER_INCH,
        },
      },
      ...blocks.map((p, i) => paragraphNode(p, i)),
    ),
  );
}
