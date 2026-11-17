import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { createElement as h, type ReactElement } from "react";
import type { DocLine } from "@/lib/docLineTypes";
import { resumeToLines } from "@/lib/docLines";
import { PDF_FONT, registerPdfFonts } from "@/lib/pdfFonts";
import { DEFAULT_SIZE, toRuns, type Run } from "@/lib/richText";
import type { Resume } from "@/lib/types";

// The page setup is the only fixed look: US Letter, 0.2in top and bottom, 0.42in left and right (points),
// Calibri (Carlito) 11pt. Everything else comes from the resume's own marks and paragraph formatting.
// Built with createElement (not JSX) so the test runner can import this file (tsconfig sets jsx: preserve).
const s = StyleSheet.create({
  page: {
    paddingTop: 14.4,
    paddingBottom: 14.4,
    paddingLeft: 30.24,
    paddingRight: 30.24,
    fontFamily: PDF_FONT,
    fontSize: DEFAULT_SIZE,
    lineHeight: 1.15,
  },
  rule: { borderBottomWidth: 0.75, borderBottomColor: "#000", paddingBottom: 1 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  rowLeft: { flexShrink: 1 },
  bullet: { flexDirection: "row", paddingLeft: 8 },
  bulletDot: { width: 10 },
  bulletText: { flex: 1, lineHeight: 1.15 },
});

/** Most lines in one unbreakable entry group; longer groups may break across pages. */
const MAX_UNBROKEN_LINES = 10;

/** One text part as nested Text runs: bold / italic / underline / size, plus ALL CAPS when the line asks. */
function runNodes(text: string, marks: DocLine["marks"], caps: boolean): ReactElement[] {
  return toRuns(text, marks).map((run: Run, i) =>
    h(
      Text,
      {
        key: i,
        style: {
          fontWeight: run.bold ? 700 : 400,
          fontStyle: run.italic ? "italic" : "normal",
          textDecoration: run.underline ? "underline" : "none",
          fontSize: run.size,
          lineHeight: 1.15,
          ...(caps ? { textTransform: "uppercase" as const } : {}),
        },
      },
      run.text,
    ),
  );
}

/** One line of the document: its paragraph formatting as View/Text styles, its runs as nested Text. */
function pdfLine(line: DocLine, key: number): ReactElement {
  const para = line.para;
  const caps = !!para?.caps;
  const textAlign: "left" | "center" | "right" | "justify" = para?.align ?? "left";
  const viewStyle = {
    ...(para?.spaceBefore ? { marginTop: para.spaceBefore } : {}),
    ...(para?.rule ? s.rule : {}),
  };
  const textStyle = { textAlign, lineHeight: 1.15, ...(caps ? { textTransform: "uppercase" as const } : {}) };

  if (line.kind === "bullet") {
    return h(
      View,
      { key, style: [s.bullet, viewStyle] },
      h(Text, { style: s.bulletDot }, "•"),
      h(Text, { style: [s.bulletText, { textAlign }] }, ...runNodes(line.text, line.marks, caps)),
    );
  }

  if (line.kind === "entry" || line.kind === "role") {
    const right = line.right
      ? h(Text, { style: textStyle }, ...runNodes(line.right, line.rightMarks, caps))
      : null;
    // An empty entry/role line still takes one line of height, like a blank text line.
    const left = runNodes(line.text, line.marks, caps);
    return h(
      View,
      { key, style: [s.row, viewStyle] },
      h(Text, { style: [s.rowLeft, textStyle] }, ...(left.length ? left : [" "])),
      right,
    );
  }

  const nodes = runNodes(line.text, line.marks, caps);
  return h(View, { key, style: viewStyle }, h(Text, { style: textStyle }, ...(nodes.length ? nodes : [" "])));
}

/**
 * Lines that belong together and should not split across a page break: an entry with its role line and
 * bullets. Anything else is its own group.
 */
function groupLines(lines: DocLine[]): DocLine[][] {
  const groups: DocLine[][] = [];
  let open: DocLine[] | null = null;
  for (const line of lines) {
    if (line.kind === "entry") {
      open = [line];
      groups.push(open);
    } else if ((line.kind === "role" || line.kind === "bullet") && open) {
      open.push(line);
    } else {
      open = null;
      groups.push([line]);
    }
  }
  return groups;
}

export function ResumePdf({ resume }: { resume: Resume }) {
  registerPdfFonts();
  const groups = groupLines(resumeToLines(resume));
  return h(
    Document,
    { title: `${resume.header.name} Resume`, author: resume.header.name },
    h(
      Page,
      { size: "LETTER", style: s.page },
      ...groups.map((group, g) => {
        const children = group.map((line, i) => pdfLine(line, i));
        const keepTogether = group.length > 1 && group.length <= MAX_UNBROKEN_LINES;
        return h(View, { key: g, wrap: !keepTogether }, ...children);
      }),
    ),
  );
}
