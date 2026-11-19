import { describe, expect, it } from "vitest";
import { buildDoc, emptyDoc, paragraph, type FlatEntry } from "@/lib/doc/model";
import type { DocInline, DocJSON } from "@/lib/doc/types";
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

  describe("links", () => {
    const linkMark = (href: string) => ({ type: "link" as const, attrs: { href } });
    const withRuns = (content: DocInline[], listType: FlatEntry["listType"] = null): DocJSON =>
      buildDoc([{ node: { type: "paragraph", attrs: { id: "pa000001" }, content }, listType, depth: listType ? 1 : 0, bullet: !!listType }]);

    it("writes a link whose text differs from its address as 'text (address)'", () => {
      const doc = withRuns([
        { type: "text", text: "Contact: " },
        { type: "text", text: "LinkedIn", marks: [linkMark("https://www.linkedin.com/in/x")] },
      ]);
      expect(resumePlainText(doc)).toBe("Contact: LinkedIn (https://www.linkedin.com/in/x)");
    });

    it("leaves a link alone when its text already is the address", () => {
      const doc = withRuns([
        { type: "text", text: "https://github.com/x", marks: [linkMark("https://github.com/x")] },
        { type: "text", text: " | " },
        { type: "text", text: "www.example.org", marks: [linkMark("https://www.example.org")] },
        { type: "text", text: " | " },
        { type: "text", text: "ada@example.com", marks: [linkMark("mailto:ada@example.com")] },
      ]);
      expect(resumePlainText(doc)).toBe("https://github.com/x | www.example.org | ada@example.com");
    });

    it("keeps one link across runs with different marks", () => {
      const doc = withRuns([
        { type: "text", text: "Lin", marks: [linkMark("https://www.linkedin.com/in/x"), { type: "bold" }] },
        { type: "text", text: "kedIn", marks: [linkMark("https://www.linkedin.com/in/x")] },
      ]);
      expect(resumePlainText(doc)).toBe("LinkedIn (https://www.linkedin.com/in/x)");
    });

    it("writes the address inside a list item too", () => {
      const doc = withRuns([{ type: "text", text: "Demo", marks: [linkMark("https://demo.example.com")] }], "bulletList");
      expect(resumePlainText(doc)).toBe("• Demo (https://demo.example.com)");
    });
  });
});
