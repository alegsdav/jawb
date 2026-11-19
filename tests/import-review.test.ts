import { describe, expect, it } from "vitest";
import { buildDoc, emptyDoc, paragraph, type FlatEntry } from "@/lib/doc/model";
import { resumePlainText } from "@/lib/importReview";

const bullet = (text: string, depth = 1): FlatEntry => ({ node: paragraph(text), listType: "bulletList", depth, bullet: true });
const continued = (text: string, depth = 1): FlatEntry => ({ node: paragraph(text), listType: "bulletList", depth, bullet: false });
const line = (text: string): FlatEntry => ({ node: paragraph(text), listType: null, depth: 0, bullet: false });

describe("resumePlainText", () => {
  it("gives nothing without a document", () => {
    expect(resumePlainText(undefined)).toBe("");
    expect(resumePlainText(emptyDoc())).toBe("");
  });

  it("keeps paragraphs in order, one per line", () => {
    const doc = buildDoc([line("Alex Example"), line("Summary"), line("Built things.")]);
    expect(resumePlainText(doc)).toBe("Alex Example\nSummary\nBuilt things.");
  });

  it("prefixes list items with a bullet and lines up continuation paragraphs", () => {
    const doc = buildDoc([bullet("First point"), continued("wrapped text"), bullet("Second point")]);
    expect(resumePlainText(doc)).toBe("• First point\n  wrapped text\n• Second point");
  });

  it("indents nested list items", () => {
    const doc = buildDoc([bullet("Outer"), bullet("Inner", 2)]);
    expect(resumePlainText(doc)).toBe("• Outer\n  • Inner");
  });

  it("turns a tab into an em dash and keeps a hard break as a newline", () => {
    const doc = buildDoc([
      line("Role\tPlace"),
      { node: paragraph("Line one\nLine two"), listType: null, depth: 0, bullet: false },
    ]);
    expect(resumePlainText(doc)).toBe("Role — Place\nLine one\nLine two");
  });
});
