import type { CSSProperties } from "react";
import { cssFontStack } from "@/lib/doc/fonts";
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE_PT, DEFAULT_LINE_HEIGHT } from "@/lib/doc/types";
import {
  hangingMarkerOf, linesWithMarker, pageOf, renderBlocks, type Run, type RenderLine, type RenderParagraph, type RunStyle,
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

function Runs({ runs }: { runs: Run[] }) {
  return (
    <>
      {runs.map((run, i) => (
        <span key={i} style={styleCss(run.style)}>{run.text}</span>
      ))}
    </>
  );
}

/** One line: the text, or the text before a tab on the left and the text after it on the right margin. */
function LineView({ line }: { line: RenderLine }) {
  if (!line.right) return <div><Runs runs={line.left} /></div>;
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span><Runs runs={line.left} /></span>
      <span><Runs runs={line.right} /></span>
    </div>
  );
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
  return (
    <div className="doc-canvas">
      <div className="doc-page doc-readonly">
        <div
          className="doc-content"
          style={{
            padding: `${page.marginTop}in ${page.marginRight}in ${page.marginBottom}in ${page.marginLeft}in`,
            fontFamily: cssFontStack(DEFAULT_FONT_FAMILY),
            fontSize: pt(DEFAULT_FONT_SIZE_PT),
            lineHeight: DEFAULT_LINE_HEIGHT,
          }}
        >
          {blocks.map((b, i) =>
            b.kind === "rule" ? (
              <hr key={i} style={{ border: 0, borderTop: RULE_BORDER, margin: "4pt 0" }} />
            ) : (
              <ParagraphView key={i} p={b} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
