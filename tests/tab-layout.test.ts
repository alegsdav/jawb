import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { flattenDoc } from "@/lib/doc/model";
import { TAB_STOP_PX, indentWidth, tabWidth } from "@/lib/doc/extensions";
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

describe("indentWidth", () => {
  it("ends on the next 0.5in stop", () => {
    expect(indentWidth(0)).toBe(TAB_STOP_PX);
    expect(indentWidth(10)).toBe(TAB_STOP_PX - 10);
    expect(indentWidth(48)).toBe(TAB_STOP_PX);
  });
  it("skips a stop that is almost under the tab", () => {
    expect(indentWidth(44)).toBe(52);
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
