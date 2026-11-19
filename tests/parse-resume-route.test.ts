import { beforeEach, describe, expect, it, vi } from "vitest";
import { flattenDoc } from "@/lib/doc/model";
import { NO_TEXT_MESSAGE } from "@/lib/import/pdfToDoc";
import { HARVARD_PAGE } from "@/lib/template";
import { harvardPdf, imageOnlyPdf } from "./import-fixtures";

const h = vi.hoisted(() => ({
  gemini: vi.fn(),
  budgetError: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireUser: async () => ({ supabase: {}, user: { id: "u1" } }),
}));
vi.mock("@/lib/gemini", () => ({ geminiJSON: h.gemini }));
vi.mock("@/lib/aiBudget", async (orig) => {
  const actual = await orig<typeof import("@/lib/aiBudget")>();
  return {
    ...actual,
    withAiBudget: async (_supabase: unknown, _opts: unknown, fn: (meter: { add: () => void }) => unknown) => {
      if (h.budgetError) throw h.budgetError;
      return fn({ add() {} });
    },
  };
});

import { AiBudgetError } from "@/lib/aiBudget";
import { POST } from "@/app/api/parse-resume/route";

/** What the AI returns for a pasted resume. */
const parsed = {
  header: { name: "Ada Lovelace", contact: "London • ada@example.com" },
  sections: [
    {
      title: "Experience",
      items: [
        { title: "Acme", subtitle: "Engineer", location: "Boston", dates: "2025", bullets: ["Built a dashboard"] },
      ],
    },
    { title: "Skills", items: [{ title: "Languages", subtitle: "Python, SQL", location: "", dates: "", bullets: [] }] },
  ],
};

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

describe("POST /api/parse-resume: pasted text goes through the AI into the Harvard template", () => {
  beforeEach(() => {
    h.gemini.mockReset();
    h.gemini.mockImplementation(async () => structuredClone(parsed));
    h.budgetError = null;
  });

  it("pasted text is parsed by the AI and comes back as a Harvard-format version 4 resume", async () => {
    const res = await POST(textRequest("Ada Lovelace\nLondon • ada@example.com\nAcme, Engineer"));
    expect(res.status).toBe(200);
    const { resume } = await res.json();
    expect(resume.version).toBe(4);
    expect(resume.page).toEqual(HARVARD_PAGE);

    const paras = flattenDoc(resume.doc);
    expect(paras[0].text).toBe("Ada Lovelace");
    expect(paras[0].node.attrs.textAlign).toBe("center");
    const name = paras[0].node.content?.[0];
    expect(name).toMatchObject({ type: "text", marks: expect.arrayContaining([{ type: "bold" }]) });
    expect(name && "marks" in name && name.marks?.find((m) => m.type === "textStyle")).toEqual({
      type: "textStyle",
      attrs: { fontFamily: "Times New Roman", fontSize: "16pt" },
    });

    const heading = paras.find((p) => p.text === "EXPERIENCE");
    expect(heading?.node.attrs.borderBottom).toBe(true);
    const entry = paras.find((p) => p.text.startsWith("Acme"));
    expect(entry?.text).toBe("Acme\tBoston");
    expect(paras.find((p) => p.text === "Built a dashboard")).toMatchObject({ listType: "bulletList", bullet: true });
    expect(paras.find((p) => p.text === "Languages: Python, SQL")).toBeTruthy();

    expect(resume.sections.map((s: { title: string }) => s.title)).toEqual(expect.arrayContaining(["EXPERIENCE", "SKILLS"]));
    expect(h.gemini).toHaveBeenCalledTimes(1);
    expect(h.gemini.mock.calls[0][0]).toContain("Ada Lovelace\nLondon • ada@example.com\nAcme, Engineer");
    expect(h.gemini.mock.calls[0][1]).toMatchObject({ temperature: 0 });
  });

  it("a .txt upload is parsed by the AI the same way", async () => {
    const res = await POST(fileRequest("cv.txt", "text/plain", "Ada Lovelace"));
    expect(res.status).toBe(200);
    const { resume } = await res.json();
    expect(flattenDoc(resume.doc)[0].text).toBe("Ada Lovelace");
    expect(h.gemini).toHaveBeenCalledTimes(1);
  });

  it("a .md upload is parsed by the AI too", async () => {
    const res = await POST(fileRequest("cv.md", "", "# Ada Lovelace"));
    expect(res.status).toBe(200);
    expect(h.gemini).toHaveBeenCalledTimes(1);
  });

  it("a text with no sections the AI can find is refused", async () => {
    h.gemini.mockImplementation(async () => ({ header: { name: "Ada" }, sections: [] }));
    const res = await POST(textRequest("Ada"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("Couldn't find any resume sections in that file.");
  });

  it("over the AI budget it answers 429 with the limit and reset time", async () => {
    const { AiBudgetError: Budget } = await vi.importActual<typeof import("@/lib/aiBudget")>("@/lib/aiBudget");
    h.budgetError = new Budget("You've used all 10 of your analyses.", 429, "heavy", "2026-11-20T00:00:00.000Z");
    const res = await POST(textRequest("Ada Lovelace"));
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ limit: "heavy", resetAt: "2026-11-20T00:00:00.000Z" });
    expect(h.gemini).not.toHaveBeenCalled();
  });

  it("an unavailable usage check answers 503 without calling the AI", async () => {
    h.budgetError = new AiBudgetError("Couldn't check your AI usage.", 503, "heavy");
    const res = await POST(textRequest("Ada Lovelace"));
    expect(res.status).toBe(503);
    expect(h.gemini).not.toHaveBeenCalled();
  });

  it("an AI failure answers 502 with a message, not a crash", async () => {
    h.gemini.mockImplementation(async () => {
      throw new Error("boom");
    });
    const res = await POST(textRequest("Ada Lovelace"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBeTruthy();
  });

  it("empty pasted text is refused before the AI is called", async () => {
    const res = await POST(textRequest("   "));
    expect(res.status).toBe(400);
    expect(h.gemini).not.toHaveBeenCalled();
  });

  it("a text file with only spaces has no text to import", async () => {
    const res = await POST(fileRequest("blank.txt", "text/plain", "   \n  "));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("Couldn't find any text in that file.");
    expect(h.gemini).not.toHaveBeenCalled();
  });

  it("other file types are refused", async () => {
    const res = await POST(fileRequest("cv.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x"));
    expect(res.status).toBe(415);
  });
});

describe("POST /api/parse-resume: a PDF is imported as it is, without the AI", () => {
  beforeEach(() => {
    h.gemini.mockReset();
    h.budgetError = null;
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

  it("a PDF with no text (a scan) is refused with the export hint", async () => {
    const res = await POST(fileRequest("scan.pdf", "application/pdf", new Uint8Array(await imageOnlyPdf())));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(NO_TEXT_MESSAGE);
    expect(h.gemini).not.toHaveBeenCalled();
  });

  it("a file that is not a PDF is refused without a server error", async () => {
    const res = await POST(fileRequest("cv.pdf", "application/pdf", "%PDF-1.4 garbage"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBeTruthy();
    expect(h.gemini).not.toHaveBeenCalled();
  });
});
