import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { flattenDoc } from "@/lib/doc/model";
import { tabWidth } from "@/lib/doc/extensions";
import { TAB_STOP_PX, firstLineOnNextPage, splitAtTabs, tabGapPx, tabGapsPx, type Run, type RunStyle } from "@/lib/docRender";
import { pdfToDoc } from "@/lib/import/pdfToDoc";
import type { DocInline, DocJSON } from "@/lib/doc/types";

describe("tabWidth", () => {
  const base = { contentRight: 900, tabLeft: 200, afterWidth: 100, scale: 1, wraps: false };

  it("fills the room between the left part and the right part, with a pixel to spare", () => {
    expect(tabWidth(base)).toBe(599);
  });

  it("is the same at any zoom: measured distances are scaled on screen, the width is in page px", () => {
    // The same line at 75%: every measured distance is 0.75 of the page's.
    const zoomed = { contentRight: 900 * 0.75, tabLeft: 200 * 0.75, afterWidth: 100 * 0.75, scale: 0.75, wraps: false };
    expect(tabWidth(zoomed)).toBe(tabWidth(base));
    expect(tabWidth({ ...zoomed, scale: 1.5, contentRight: 900 * 1.5, tabLeft: 200 * 1.5, afterWidth: 150 })).toBe(tabWidth(base));
  });

  it("stays narrow when the right part does not fit on the line", () => {
    expect(tabWidth({ ...base, afterWidth: 800 })).toBe(8);
    expect(tabWidth({ ...base, wraps: true })).toBe(8);
  });
});

describe("tabGapPx (the shared 0.5in stop rule)", () => {
  it("ends on the next 0.5in stop", () => {
    expect(tabGapPx(0)).toBe(TAB_STOP_PX);
    expect(tabGapPx(10)).toBe(TAB_STOP_PX - 10);
    expect(tabGapPx(48)).toBe(TAB_STOP_PX);
  });
  it("skips a stop that is almost under the tab", () => {
    expect(tabGapPx(44)).toBe(52);
  });
});

const style: RunStyle = { bold: false, italic: false, underline: false, sizePt: 11, fontFamily: "Calibri" };
const run = (text: string): Run => ({ text, style });
const TAB: Run = { text: "", style, tab: true };

describe("tabGapsPx", () => {
  it("gives one gap per earlier tab, each carrying the text before it to the next stop", () => {
    // "Name" is 30px: its tab ends at 48. "Role" then runs 48 to 88, and the next stop (96) is 8px away.
    expect(tabGapsPx([30, 40, 20])).toEqual([18, 8]);
  });
  it("has no gaps without a tab", () => {
    expect(tabGapsPx([120])).toEqual([]);
  });
  it("counts an empty part as a stop: two tabs in a row advance two stops", () => {
    // Part 0 is 10px (gap to 48), part 1 is empty and sits on the stop, so its tab advances a full stop.
    expect(tabGapsPx([10, 0, 5])).toEqual([38, 48]);
  });
});

describe("splitAtTabs", () => {
  it("splits a line's runs at its earlier tabs", () => {
    expect(splitAtTabs([run("A"), TAB, run("B"), run("C")])).toEqual([[run("A")], [run("B"), run("C")]]);
  });
  it("is one part without tabs", () => {
    expect(splitAtTabs([run("A")])).toEqual([[run("A")]]);
  });
});

describe("firstLineOnNextPage", () => {
  const lines = [
    { top: 0, bottom: 17 },
    { top: 17, bottom: 34 },
    { top: 34, bottom: 51 },
  ];
  it("is the top of the first line whose bottom passes the text area's bottom", () => {
    expect(firstLineOnNextPage(lines, 40)).toBe(34);
  });
  it("is the top of the line that straddles the bottom, not the bottom itself", () => {
    expect(firstLineOnNextPage(lines, 20)).toBe(17);
  });
  it("is null when every line fits on page 1", () => {
    expect(firstLineOnNextPage(lines, 51)).toBeNull();
  });
});

const s = StyleSheet.create({
  page: { padding: 50, fontFamily: "Times-Roman", fontSize: 10 },
  row: { flexDirection: "row", justifyContent: "space-between" },
  col: { flexDirection: "row" },
  label: { width: 110, fontFamily: "Times-Bold" },
});

async function columnsPdf(): Promise<Uint8Array> {
  const buf = await renderToBuffer(
    h(Document, null, h(Page, { size: "LETTER", style: s.page },
      h(View, { style: s.row }, h(Text, null, "Acme Corporation"), h(Text, null, "Springfield, IL")),
      h(View, { style: s.col }, h(Text, { style: s.label }, "Languages:"), h(Text, null, "English, Spanish")),
      h(View, { style: s.row }, h(Text, null, "A long job title, Platform Infrastructure Team and more"), h(Text, null, "May 2025")),
    )),
  );
  return new Uint8Array(buf);
}

const shape = (doc: DocJSON, prefix: string): DocInline["type"][] =>
  (flattenDoc(doc).find((p) => p.text.replace(/\t/g, "").startsWith(prefix))?.node.content ?? []).map((n) => n.type);

describe("PDF import: which gaps are right tabs", () => {
  it("a part that ends at the right margin is a tab; a left column is spaces, not a tab", async () => {
    const { doc } = await pdfToDoc(await columnsPdf());
    expect(shape(doc, "Acme")).toContain("tab");
    expect(shape(doc, "A long job")).toContain("tab");
    const lang = flattenDoc(doc).find((p) => p.text.startsWith("Languages"))!;
    expect(shape(doc, "Languages")).not.toContain("tab");
    // The column's spacing survives as spaces between the label and its value.
    expect(lang.text).toMatch(/^Languages:\s{2,}English, Spanish$/);
  });
});
