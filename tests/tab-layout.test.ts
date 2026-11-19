import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { flattenDoc } from "@/lib/doc/model";
import { tabWidth } from "@/lib/doc/extensions";
import {
  DEFAULT_TAB_STEP_PT, TAB_STOP_PX, firstLineOnNextPage, renderBlocks, splitAtTabs, tabGapPx, tabGapsPx, tabGapsPxFor,
  tabStopLayout, type Run, type RunStyle,
} from "@/lib/docRender";
import { pdfToDoc } from "@/lib/import/pdfToDoc";
import type { DocInline, DocJSON, TabStop } from "@/lib/doc/types";

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
  it("a part that ends at the right margin is a tab; a left column is a tab to a left stop at the value", async () => {
    const { doc } = await pdfToDoc(await columnsPdf());
    expect(shape(doc, "Acme")).toContain("tab");
    expect(shape(doc, "A long job")).toContain("tab");
    const lang = flattenDoc(doc).find((p) => p.text.startsWith("Languages"))!;
    expect(lang.text).toBe("Languages:\tEnglish, Spanish");
    // The value keeps its column: one left stop where it started in the PDF.
    expect(lang.node.attrs.tabStops).toEqual([expect.objectContaining({ align: "left" })]);
  });
});

const left = (pos: number): TabStop => ({ pos, align: "left" });
const center = (pos: number): TabStop => ({ pos, align: "center" });
const right = (pos: number): TabStop => ({ pos, align: "right" });

describe("tabStopLayout (paragraphs with tab stops, in points)", () => {
  it("a left stop starts the next part at the stop", () => {
    // "Name" is 30pt: the tab runs from 30 to the stop at 72, and the next part starts there.
    expect(tabStopLayout([30, 40], [left(72)])).toEqual([42]);
  });

  it("a right stop ends the next part at the stop", () => {
    // The part after the tab is 50pt and must end at 200: it starts at 150, so the tab is 150 - 30 = 120.
    expect(tabStopLayout([30, 50], [right(200)])).toEqual([120]);
  });

  it("a centre stop centres the next part on the stop", () => {
    // A 40pt part centred on 100 spans 80 to 120, so the tab runs from 30 to 80.
    expect(tabStopLayout([30, 40], [center(100)])).toEqual([50]);
  });

  it("reaches the first stop past the text, not an earlier one", () => {
    // The text ends at 30: the stop at 20 is behind it, so the tab goes to 100.
    expect(tabStopLayout([30, 10], [left(20), left(100)])).toEqual([70]);
  });

  it("does not use a stop that is under the text's end (a point of slack)", () => {
    // The text ends at 30.5: a stop at 31 is only half a point away, so the tab takes the default stop at 36.
    expect(tabStopLayout([30.5, 10], [left(31)])).toEqual([5.5]);
  });

  it("takes the next default stop once the text has passed every stop", () => {
    // The text ends at 100, past the only stop (72): the next default stop after it is 108.
    expect(tabStopLayout([100, 20], [left(72)])).toEqual([8]);
  });

  it("uses the default 0.5in stops when there are no stops", () => {
    // Stops at 36, 72, 108: a tab after 10pt goes to 36, and after 46pt to 72.
    expect(tabStopLayout([10, 10, 10], [])).toEqual([26, 26]);
    expect(DEFAULT_TAB_STEP_PT).toBe(36);
  });

  it("a right or centre part that would start before the tab takes the next default stop", () => {
    // The text ends at 100 and a 80pt right part would start at 40, before the tab: the default stop 108 is used.
    expect(tabStopLayout([100, 80], [right(120)])).toEqual([8]);
  });

  it("is at least 1pt wide", () => {
    // A right part of 5pt ending at 15.5 would start at 10.5, half a point after the text: the tab is 1pt.
    expect(tabStopLayout([10, 5], [right(15.5)])).toEqual([1]);
  });

  it("uses each stop once, in order: a second tab reaches the stop after the first", () => {
    // Name ends at 30 and the tab stops at 72; the next 10pt part ends at 82, so the next stop is 200.
    expect(tabStopLayout([30, 10, 10], [left(72), left(200)])).toEqual([42, 118]);
  });

  it("lays out Role, Team and a right-aligned date with a left and a right stop", () => {
    // Role (20pt) then a tab to 144, Team (30pt) to 174, then a tab to the right stop at 540 where the 25pt date ends.
    expect(tabStopLayout([20, 30, 25], [left(144), right(540)])).toEqual([124, 341]);
  });

  it("has no tabs for a single part", () => {
    expect(tabStopLayout([120], [left(72)])).toEqual([]);
  });
});

describe("tabGapsPxFor", () => {
  it("is the default 0.5in rule without stops", () => {
    expect(tabGapsPxFor([30, 40, 20], null)).toEqual(tabGapsPx([30, 40, 20]));
  });

  it("works in px with the stops measured in points: 40px (30pt) before a stop at 72pt is a 42pt, 56px gap", () => {
    expect(tabGapsPxFor([40, 30], [left(72)])[0]).toBeCloseTo(56);
  });
});

describe("paragraphs with tab stops in the shared layout", () => {
  it("puts every tab on the line's left side and no right-aligned part", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "st1", tabStops: [left(72), right(540)] }, content: [{ type: "text", text: "a" }, { type: "tab" }, { type: "text", text: "b" }, { type: "tab" }, { type: "text", text: "c" }] }],
    };
    const [p] = renderBlocks(doc);
    expect(p.tabStops).toEqual([left(72), right(540)]);
    expect(p.lines[0].right).toBeNull();
    expect(splitAtTabs(p.lines[0].left).map((part) => part.map((r) => r.text).join(""))).toEqual(["a", "b", "c"]);
  });

  it("keeps the last-tab rule for a paragraph without stops", () => {
    const doc: DocJSON = {
      type: "doc",
      content: [{ type: "paragraph", attrs: { id: "nost1" }, content: [{ type: "text", text: "a" }, { type: "tab" }, { type: "text", text: "b" }] }],
    };
    const [p] = renderBlocks(doc);
    expect(p.tabStops).toBeNull();
    expect(p.lines[0].right?.map((r) => r.text).join("")).toBe("b");
  });
});
