import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paragraph } from "@/lib/doc/model";
import type { DocJSON, DocListItem, ParagraphAttrs } from "@/lib/doc/types";
import { renderBlocks } from "@/lib/docRender";

const para = (text: string, attrs: Partial<ParagraphAttrs> = {}) => paragraph(text, { attrs });
const item = (...content: DocListItem["content"]): DocListItem => ({ type: "listItem", content });

/** One job: a first bullet with 6pt before it, and a last bullet with 12pt after it (the gap before the next job). */
const job: DocJSON = {
  type: "doc",
  content: [
    {
      type: "bulletList",
      content: [
        item(para("First bullet of the job", { spaceBefore: 6 })),
        item(para("Last bullet of the job", { spaceAfter: 12 })),
      ],
    },
  ],
};

// The view draws every paragraph block with these margins, list items included (ResumeView's ParagraphView), so the
// render model carries the spacing the view and the PDF need.
describe("list items carry their paragraphs' spacing to the view and the PDF", () => {
  const [first, last] = renderBlocks(job);

  it("keeps a list item's spaceBefore", () => {
    expect(first.spaceBeforePt).toBe(6);
  });

  it("keeps a list item's spaceAfter", () => {
    expect(last.spaceAfterPt).toBe(12);
  });
});

// Inline boxes ignore vertical margins, so a list item paragraph that is inline in the editor drops its spacing.
describe("the editor lets list item paragraphs take their spacing", () => {
  const css = readFileSync(`${process.cwd()}/src/app/globals.css`, "utf8");

  it("sets list item paragraphs to block, so their margins apply (inline boxes ignore vertical margins)", () => {
    const rule = /\.doc-content li > p \{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/display:\s*block/);
    expect(css).not.toMatch(/\.doc-content li > p \{[^}]*display:\s*inline/);
  });
});
