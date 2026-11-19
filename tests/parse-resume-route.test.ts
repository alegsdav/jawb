import { beforeEach, describe, expect, it, vi } from "vitest";
import { flattenDoc } from "@/lib/doc/model";
import { NO_TEXT_MESSAGE } from "@/lib/import/pdfToDoc";
import { harvardPdf, imageOnlyPdf } from "./import-fixtures";

const h = vi.hoisted(() => ({ gemini: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  requireUser: async () => ({ supabase: {}, user: { id: "u1" } }),
}));
vi.mock("@/lib/gemini", () => ({ geminiJSON: h.gemini }));

import { POST } from "@/app/api/parse-resume/route";

const textRequest = (text: string) =>
  new Request("http://localhost/api/parse-resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });

const fileRequest = (name: string, type: string, body: BlobPart) => {
  const form = new FormData();
  form.append("file", new File([body], name, { type }));
  return new Request("http://localhost/api/parse-resume", { method: "POST", body: form });
};

describe("POST /api/parse-resume: the import keeps the document as it is", () => {
  beforeEach(() => {
    h.gemini.mockReset();
  });

  it("a PDF becomes a version 4 resume: its document, its page setup and the sections derived from it", async () => {
    const res = await POST(fileRequest("cv.pdf", "application/pdf", new Uint8Array(await harvardPdf())));
    expect(res.status).toBe(200);
    const { resume } = await res.json();
    expect(resume.version).toBe(4);
    expect(resume.doc.type).toBe("doc");
    expect(flattenDoc(resume.doc)[0].text).toBe("Ada Lovelace");
    expect(resume.page.marginLeft).toBeCloseTo(0.6, 1);
    expect(resume.header.name).toBe("Ada Lovelace");
    expect(resume.sections.map((s: { title: string }) => s.title)).toEqual(
      expect.arrayContaining(["EDUCATION", "EXPERIENCE"]),
    );
    expect(h.gemini).not.toHaveBeenCalled();
  });

  it("pasted text becomes a version 4 resume with the text as its paragraphs", async () => {
    const res = await POST(textRequest("Ada Lovelace\nAcme\t Boston\n• Built a dashboard"));
    expect(res.status).toBe(200);
    const { resume } = await res.json();
    expect(resume.version).toBe(4);
    expect(flattenDoc(resume.doc).map((p: { text: string }) => p.text)).toEqual([
      "Ada Lovelace",
      "Acme\t Boston",
      "Built a dashboard",
    ]);
    expect(resume.page).toBeUndefined();
    expect(h.gemini).not.toHaveBeenCalled();
  });

  it("a .txt upload is imported the same way as pasted text", async () => {
    const res = await POST(fileRequest("cv.txt", "text/plain", "Ada Lovelace"));
    expect(res.status).toBe(200);
    const { resume } = await res.json();
    expect(flattenDoc(resume.doc)[0].text).toBe("Ada Lovelace");
  });

  it("a PDF with no text (a scan) is refused with the export hint", async () => {
    const res = await POST(fileRequest("scan.pdf", "application/pdf", new Uint8Array(await imageOnlyPdf())));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(NO_TEXT_MESSAGE);
  });

  it("a file that is not a PDF is refused without a server error", async () => {
    const res = await POST(fileRequest("cv.pdf", "application/pdf", "%PDF-1.4 garbage"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBeTruthy();
  });

  it("a text file with only spaces has no text to import", async () => {
    const res = await POST(fileRequest("blank.txt", "text/plain", "   \n  "));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("Couldn't find any text in that file.");
  });

  it("other file types are refused", async () => {
    const res = await POST(fileRequest("cv.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x"));
    expect(res.status).toBe(415);
  });

  it("empty pasted text is refused", async () => {
    const res = await POST(textRequest("   "));
    expect(res.status).toBe(400);
  });
});
