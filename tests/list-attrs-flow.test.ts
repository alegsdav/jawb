import { describe, expect, it } from "vitest";
import { buildDoc, flattenDoc, normalizeDoc, paragraph } from "@/lib/doc/model";
import type { DocJSON } from "@/lib/doc/types";

/** List attributes (indent, numbering style) survive the flatten → rebuild round trip the app's merges use. */
describe("list attributes through flatten and rebuild", () => {
  const doc: DocJSON = normalizeDoc({
    type: "doc",
    content: [
      { type: "bulletList", attrs: { indentPt: 13 }, content: [{ type: "listItem", content: [paragraph("One")] }, { type: "listItem", content: [paragraph("Two")] }] },
      { type: "orderedList", attrs: { type: "a", indentPt: 20 }, content: [{ type: "listItem", content: [paragraph("Alpha")] }] },
    ],
  } as DocJSON);

  it("keeps indentPt and type when every paragraph is rebuilt", () => {
    const rebuilt = buildDoc(flattenDoc(doc));
    expect(rebuilt.content[0]).toMatchObject({ type: "bulletList", attrs: { indentPt: 13 } });
    expect(rebuilt.content[1]).toMatchObject({ type: "orderedList", attrs: { type: "a", indentPt: 20 } });
  });

  it("keeps them when a subset is rebuilt the way tailoring does", () => {
    const rebuilt = buildDoc(flattenDoc(doc).filter((p) => p.text !== "Two"));
    expect(rebuilt.content[0]).toMatchObject({ type: "bulletList", attrs: { indentPt: 13 } });
  });
});
