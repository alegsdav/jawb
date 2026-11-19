import { describe, expect, it } from "vitest";
import { flattenDoc } from "@/lib/doc/model";
import { EMPTY_PDF_MESSAGE, resumeFromPdf } from "@/lib/import/resumeFromPdf";
import { NO_TEXT_MESSAGE, NoTextError } from "@/lib/import/pdfToDoc";
import { importPdfInBrowser } from "@/lib/import/importPdf";
import { HARVARD_PAGE } from "@/lib/template";
import { harvardPdf, imageOnlyPdf } from "./import-fixtures";

const bytes = (b: Buffer) => new Uint8Array(b);

/** The resume without its random ids (each read makes new ones). */
const withoutIds = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(withoutIds)
    : v && typeof v === "object"
      ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "id").map(([k, x]) => [k, withoutIds(x)]))
      : v;

describe("resumeFromPdf: the shared PDF to resume helper", () => {
  it("a text PDF becomes a version 4 resume with its page setup and text", async () => {
    const resume = await resumeFromPdf(bytes(await harvardPdf()));
    expect(resume.version).toBe(4);
    expect(resume.page).toBeTruthy();
    expect(resume.page).not.toEqual(HARVARD_PAGE); // the fixture has its own margins
    expect(resume.doc).toBeTruthy();
    const text = flattenDoc(resume.doc!).map((p) => p.text);
    expect(text).toContain("Ada Lovelace");
    expect(text.some((t) => t.startsWith("Harvard University"))).toBe(true);
  });

  it("a PDF with no text is refused with the export hint", async () => {
    const err = await resumeFromPdf(bytes(await imageOnlyPdf())).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NoTextError);
    expect((err as Error).message).toBe(NO_TEXT_MESSAGE);
  });

  it("the no-text error can carry its own message", () => {
    expect(new NoTextError(EMPTY_PDF_MESSAGE).message).toBe("Couldn't find any text in that file.");
  });
});

describe("importPdfInBrowser: the browser entry reads a File with the same result", () => {
  it("returns the same resume as the server helper for the same bytes", async () => {
    const data = bytes(await harvardPdf());
    const file = new File([data], "resume.pdf", { type: "application/pdf" });
    const fromBrowser = await importPdfInBrowser(file);
    const fromServer = await resumeFromPdf(data);
    expect(withoutIds(fromBrowser)).toEqual(withoutIds(fromServer));
  });

  it("a scan File is refused with the same NoTextError", async () => {
    const file = new File([bytes(await imageOnlyPdf())], "scan.pdf", { type: "application/pdf" });
    await expect(importPdfInBrowser(file)).rejects.toBeInstanceOf(NoTextError);
  });
});
