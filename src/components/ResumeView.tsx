import { Fragment, useLayoutEffect, useRef, type CSSProperties } from "react";
import { cssFontStack } from "@/lib/doc/fonts";
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE_PT, DEFAULT_LINE_HEIGHT } from "@/lib/doc/types";
import {
  hangingMarkerOf, linesWithMarker, pageOf, renderBlocks, splitAtTabs, tabGapsPx, type Run, type RenderLine,
  type RenderParagraph, type RunStyle,
} from "@/lib/docRender";
import { resumeDoc } from "@/lib/resume";
import type { Resume } from "@/lib/types";

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

/** One line: the text, or the text before a tab on the left and the text after it on the right margin. */
function LineView({ line }: { line: RenderLine }) {
  if (!line.right) return <div data-tab-line><LeftRuns runs={line.left} /></div>;
  return (
    <div data-tab-line style={{ display: "flex", justifyContent: "space-between" }}>
      <span><LeftRuns runs={line.left} /></span>
      <span><Runs runs={line.right} /></span>
    </div>
  );
}

/**
 * Sizes every earlier-tab gap under `root` from the measured widths of the parts before it. The same stop rule as the
 * editor (tabGapsPx), so a line reads the same here as in the editor. Parts are measured in order, so each gap's
 * position is known before it is sized.
 */
function layoutTabStops(root: HTMLElement): void {
  for (const line of Array.from(root.querySelectorAll<HTMLElement>("[data-tab-line]"))) {
    const gaps = Array.from(line.querySelectorAll<HTMLElement>("[data-tab-gap]"));
    for (const g of gaps) g.style.width = "0px";
    const widths = Array.from(line.querySelectorAll<HTMLElement>("[data-tab-part]")).map((p) => p.getBoundingClientRect().width);
    tabGapsPx(widths).forEach((w, i) => {
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
        lineHeight: p.lineHeight,
        textAlign: p.align,
        ...(p.rule ? { borderBottom: RULE_BORDER, paddingBottom: "1pt" } : {}),
      }}
    >
      <div style={{ display: "flex", paddingLeft: pt(marker ? marker.x : p.textIndentPt) }}>
        {marker && (
          <span style={{ ...styleCss(marker.style), flex: "none", width: pt(p.textIndentPt - marker.x) }}>
            {marker.text}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap" }}>
          {linesWithMarker(p).map((line, i) => (
            <LineView key={i} line={line} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The resume as a read-only page, laid out like the PDF (see src/lib/docRender.ts). */
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
      <div className="doc-page doc-readonly">
        <div
          ref={contentRef}
          className="doc-content"
          style={{
            padding: `${page.marginTop}in ${page.marginRight}in ${page.marginBottom}in ${page.marginLeft}in`,
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
    </div>
  );
}
