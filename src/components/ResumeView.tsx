import { Fragment, useLayoutEffect, useRef, type CSSProperties } from "react";
import { cssFontStack } from "@/lib/doc/fonts";
import { formatTabStops, parseTabStops } from "@/lib/doc/model";
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE_PT, DEFAULT_LINE_HEIGHT, type TabStop } from "@/lib/doc/types";
import {
  hangingMarkerOf, linesWithMarker, pageOf, renderBlocks, splitAtTabs, tabGapsPxFor, type Run, type RenderLine,
  type RenderParagraph, type RunStyle,
} from "@/lib/docRender";
import { resumeDoc } from "@/lib/resume";
import type { Resume } from "@/lib/types";
import { EditorCanvas } from "./ZoomFrame";

const pt = (n: number) => `${n}pt`;
const RULE_BORDER = "0.75pt solid #000";

/** CSS for one run: its font, size, weight, style and underline. */
function styleCss(s: RunStyle): CSSProperties {
  return {
    fontFamily: cssFontStack(s.fontFamily),
    fontSize: pt(s.sizePt),
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? "italic" : "normal",
    textDecoration: s.underline ? "underline" : "none",
  };
}

/** Links look like the editor's: blue and underlined. */
const LINK_STYLE: CSSProperties = { color: "#1155cc", textDecoration: "underline" };

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, i) =>
        run.href ? (
          <a
            key={i}
            href={run.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            style={{ ...styleCss(run.style), ...LINK_STYLE }}
          >
            {run.text}
          </a>
        ) : (
          <span key={i} style={styleCss(run.style)}>{run.text}</span>
        ),
      )}
    </>
  );
}

/**
 * The left side of a line. With earlier tabs, each part is a span and a gap span follows it; layoutTabStops sizes the
 * gaps, so the parts start on the editor's 0.5in stops.
 */
function LeftRuns({ runs }: { runs: Run[] }) {
  const parts = splitAtTabs(runs);
  if (parts.length === 1) return <Runs runs={runs} />;
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>
          <span data-tab-part><Runs runs={part} /></span>
          {i < parts.length - 1 && <span data-tab-gap style={{ display: "inline-block" }} />}
        </Fragment>
      ))}
    </>
  );
}

/**
 * One line: the text, or the text before a tab on the left and the text after it on the right margin. A paragraph with
 * tab stops carries them on its line (data-tabs), so layoutTabStops sizes the gaps by them.
 */
function LineView({ line, stops }: { line: RenderLine; stops: TabStop[] | null }) {
  const tabs = stops ? formatTabStops(stops) : undefined;
  if (!line.right) return <div data-tab-line data-tabs={tabs}><LeftRuns runs={line.left} /></div>;
  return (
    <div data-tab-line style={{ display: "flex", justifyContent: "space-between" }}>
      <span><LeftRuns runs={line.left} /></span>
      <span><Runs runs={line.right} /></span>
    </div>
  );
}

/**
 * Sizes every tab gap under `root` from the measured widths of the parts before it: the same rules as the editor
 * (tabGapsPxFor), so a line reads the same here as in the editor. offsetWidth (not getBoundingClientRect) is the unscaled
 * layout width: the page is zoomed by a CSS transform (ZoomFrame), so the stops stay the same at every zoom and need no
 * re-measure.
 */
function layoutTabStops(root: HTMLElement): void {
  for (const line of Array.from(root.querySelectorAll<HTMLElement>("[data-tab-line]"))) {
    const gaps = Array.from(line.querySelectorAll<HTMLElement>("[data-tab-gap]"));
    for (const g of gaps) g.style.width = "0px";
    const widths = Array.from(line.querySelectorAll<HTMLElement>("[data-tab-part]")).map((p) => p.offsetWidth);
    tabGapsPxFor(widths, parseTabStops(line.getAttribute("data-tabs"))).forEach((w, i) => {
      gaps[i].style.width = `${w}px`;
    });
  }
}

function ParagraphView({ p }: { p: RenderParagraph }) {
  const marker = hangingMarkerOf(p);
  return (
    <div
      style={{
        marginTop: pt(p.spaceBeforePt),
        marginBottom: pt(p.spaceAfterPt),
        // The line strut: unsized text keeps the default, and each line is as tall as its text (see paragraphStrutPt).
        fontSize: pt(p.strutPt),
        lineHeight: p.lineHeight,
        textAlign: p.align,
        ...(p.rule ? { borderBottom: RULE_BORDER, paddingBottom: "1pt" } : {}),
      }}
    >
      <div style={{ display: "flex", paddingLeft: pt(marker ? marker.x : p.textIndentPt) }}>
        {marker && (
          <span
            style={{
              ...styleCss(marker.style),
              flex: "none",
              boxSizing: "border-box",
              width: pt(p.textIndentPt - marker.x),
              textAlign: marker.align,
              paddingRight: pt(marker.gapPt),
            }}
          >
            {marker.text}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap" }}>
          {linesWithMarker(p).map((line, i) => (
            <LineView key={i} line={line} stops={p.tabStops} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The resume as a read-only page, laid out like the PDF (see src/lib/docRender.ts). The page is 8.5in wide and scaled
 * to fit its container (Fit), the same as the editor, so the text never re-wraps; only phone widths reflow it.
 */
export function ResumeView({ value }: { value: Resume }) {
  const page = pageOf(value);
  const blocks = renderBlocks(resumeDoc(value));
  const contentRef = useRef<HTMLDivElement>(null);
  // Tab gaps depend on the text's width, which changes when a web font finishes loading.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const relayout = () => layoutTabStops(el);
    relayout();
    const fonts = document.fonts;
    fonts?.addEventListener?.("loadingdone", relayout);
    void fonts?.ready.then(relayout);
    return () => fonts?.removeEventListener?.("loadingdone", relayout);
  }, [value]);
  return (
    <div className="doc-canvas">
      {/* Fit (zoom 0) and no grey backdrop: the page sits on the card or dialog that shows it. */}
      <EditorCanvas zoom={0} plain>
        {/* The margins go on the page box, as in the editor (on the content they'd add to .doc-page's own padding). */}
        <div
          className="doc-page doc-readonly"
          style={{ padding: `${page.marginTop}in ${page.marginRight}in ${page.marginBottom}in ${page.marginLeft}in` }}
        >
          <div
            ref={contentRef}
            className="doc-content"
            style={{
              fontFamily: cssFontStack(DEFAULT_FONT_FAMILY),
              fontSize: pt(DEFAULT_FONT_SIZE_PT),
              lineHeight: DEFAULT_LINE_HEIGHT,
            }}
          >
            {blocks.map((p, i) => (
              <ParagraphView key={i} p={p} />
            ))}
          </div>
        </div>
      </EditorCanvas>
    </div>
  );
}
