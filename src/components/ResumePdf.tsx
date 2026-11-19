import { Document, Link, Page, Text, View } from "@react-pdf/renderer";
import { createElement as h, type ReactElement } from "react";
import { pdfFontFor, registerPdfFonts } from "@/lib/pdfFonts";
import {
  PT_PER_PX, hangingMarkerOf, linesWithMarker, pageOf, renderBlocks, splitAtTabs, tabGapsPx, tabStopLayout, type Run,
  type RenderLine, type RenderMarker, type RenderParagraph, type RunStyle,
} from "@/lib/docRender";
import { textWidthPt } from "@/lib/pdfTextWidths";
import { resumeDoc } from "@/lib/resume";
import type { Resume } from "@/lib/types";

const POINTS_PER_INCH = 72;
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

/** The width of a run of text in points, from the PDF face's metrics (see pdfTextWidths). */
function runsWidthPt(runs: Run[]): number {
  return runs.reduce((sum, r) => sum + textWidthPt(r.text, r.style.fontFamily, r.style.bold, r.style.italic, r.style.sizePt), 0);
}

/**
 * The width of each part of a line and the width after it, in points: the paragraph's tab stops when it has them
 * (tabStopLayout), else the editor's 0.5in stops (tabGapsPx, which works in px).
 */
function partsAndGapsPt(parts: Run[][], p: RenderParagraph): { widths: number[]; gaps: number[] } {
  const widths = parts.map(runsWidthPt);
  if (p.tabStops) return { widths, gaps: tabStopLayout(widths, p.tabStops) };
  return { widths, gaps: tabGapsPx(widths.map((w) => w / PT_PER_PX)).map((g) => g * PT_PER_PX) };
}

/**
 * The left side of a line. Without earlier tabs it is one text. Without tab stops, the parts sit in a row with a
 * fixed-width gap after each part (the editor's 0.5in stops). With stops, each part is placed absolutely at the x its
 * stop gives it (partsAndGapsPt): a row would shrink its parts when a stop lies past the text area (react-pdf reads
 * flexShrink 0 as 1), and a part would then move off its stop.
 */
function leftNode(runs: Run[], p: RenderParagraph): ReactElement {
  const parts = splitAtTabs(runs);
  if (parts.length === 1) return h(Text, { style: { textAlign: p.align, flexShrink: 1 } }, ...runNodes(runs, p.lineHeight));
  const { widths, gaps } = partsAndGapsPt(parts, p);
  return p.tabStops ? partsAtStops(runs, parts, widths, gaps, p) : partsInRow(parts, gaps, p);
}

/** Parts in a row, each followed by its gap (the paragraphs without tab stops). */
function partsInRow(parts: Run[][], gaps: number[], p: RenderParagraph): ReactElement {
  const children: ReactElement[] = [];
  parts.forEach((part, i) => {
    if (part.length) children.push(h(Text, { key: `t${i}` }, ...runNodes(part, p.lineHeight)));
    if (i < gaps.length) children.push(h(View, { key: `g${i}`, style: { width: gaps[i] } }));
  });
  return h(View, { style: { flexDirection: "row", flexShrink: 1 } }, ...children);
}

/** Parts placed at their stops: each one absolutely at its x, in a box as tall as the line's text. */
function partsAtStops(runs: Run[], parts: Run[][], widths: number[], gaps: number[], p: RenderParagraph): ReactElement {
  const children: ReactElement[] = [];
  let x = 0;
  parts.forEach((part, i) => {
    // A little slack on the box's width, so that rounding never wraps a part's last character.
    if (part.length) {
      children.push(
        h(
          View,
          { key: `t${i}`, style: { position: "absolute", left: x, top: 0, width: widths[i] + 1 } },
          h(Text, null, ...runNodes(part, p.lineHeight)),
        ),
      );
    }
    x += widths[i] + (i < gaps.length ? gaps[i] : 0);
  });
  const heightPt = Math.max(p.strutPt, ...runs.map((r) => r.style.sizePt)) * p.lineHeight;
  return h(View, { style: { height: heightPt } }, ...children);
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
 * A hanging bullet or number, as wide as the indent before the text. Markers are right-aligned, `gapPt` before the text. "◦" and "▪" are drawn as shapes (a hollow and a solid
 * dot), centred on the x-height of the first line, at the same side of the box.
 */
function markerNode(marker: RenderMarker, width: number, lineHeight: number): ReactElement {
  const sizePt = marker.style.sizePt;
  const lineHeightPt = sizePt * lineHeight;
  const right = marker.align === "right";
  if (!SHAPE_MARKERS.has(marker.text)) {
    return h(
      Text,
      { style: { ...fontProps(marker.style, lineHeight), width, textAlign: marker.align, paddingRight: marker.gapPt } },
      marker.text,
    );
  }
  const d = sizePt * 0.32;
  const shape = marker.text === "◦" ? { borderWidth: 0.6, borderColor: "#000", borderRadius: d / 2 } : { backgroundColor: "#000" };
  const marginLeft = right ? width - marker.gapPt - d : 0;
  return h(
    View,
    { style: { width, height: lineHeightPt } },
    h(View, { style: { marginTop: lineHeightPt * 0.58 - d / 2, marginLeft, width: d, height: d, ...shape } }),
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
