import { describe, expect, it } from "vitest";
import { flattenDoc } from "@/lib/doc/model";
import { isValidDoc } from "@/lib/doc/extensions";
import { textToDoc } from "@/lib/import/textToDoc";

const texts = (text: string) => flattenDoc(textToDoc(text)).map((p) => p.text);

describe("textToDoc", () => {
  it("makes one paragraph per line, as it is", () => {
    expect(texts("Ada Lovelace\nLondon • ada@example.com\nEngineer at Acme")).toEqual([
      "Ada Lovelace",
      "London • ada@example.com",
      "Engineer at Acme",
    ]);
  });

  it("reads CRLF line endings and ignores a trailing newline", () => {
    expect(texts("One\r\nTwo\r\n")).toEqual(["One", "Two"]);
  });

  it("makes a blank line an empty paragraph, never two in a row", () => {
    expect(texts("A\n\n\n\nB")).toEqual(["A", "", "B"]);
  });

  it("makes a line starting with a bullet glyph and a space a bullet, without the glyph", () => {
    const doc = textToDoc("• one\n- two\n* three\n– four\n● five");
    const bullets = flattenDoc(doc);
    expect(bullets.map((p) => p.text)).toEqual(["one", "two", "three", "four", "five"]);
    expect(bullets.every((p) => p.listType === "bulletList" && p.depth === 1 && p.bullet)).toBe(true);
  });

  it("keeps a dash without a space as text", () => {
    const [p] = flattenDoc(textToDoc("-2019 to 2022"));
    expect(p.listType).toBeNull();
    expect(p.text).toBe("-2019 to 2022");
  });

  it("makes a literal tab or a run of 3+ spaces a tab node", () => {
    const [tabbed, tabbedRun] = flattenDoc(textToDoc("Acme\tBoston\nAcme   Boston")).map((p) => p.node.content);
    expect(tabbed?.map((n) => n.type)).toEqual(["text", "tab", "text"]);
    expect(tabbedRun?.map((n) => n.type)).toEqual(["text", "tab", "text"]);
  });

  it("keeps two spaces and an indent as they are", () => {
    expect(texts("Acme  Boston")).toEqual(["Acme  Boston"]);
    expect(texts("   Indented")).toEqual(["   Indented"]);
  });

  it("gives an empty document an empty paragraph", () => {
    expect(texts("")).toEqual([""]);
  });

  it("gives a valid document with a unique id on every paragraph", () => {
    const doc = textToDoc("Name\n\n• a\n• b\nTail");
    const ids = flattenDoc(doc).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(isValidDoc(doc)).toBe(true);
  });
});
