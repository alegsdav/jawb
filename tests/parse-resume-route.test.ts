import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  reply: null as unknown,
  prompts: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  requireUser: async () => ({ supabase: {}, user: { id: "u1" } }),
}));
vi.mock("@/lib/gemini", () => ({
  geminiJSON: async (prompt: string) => ((h.prompts.push(prompt)), h.reply),
}));
vi.mock("@/lib/aiBudget", () => ({
  withAiBudget: async (_supabase: unknown, _opts: unknown, fn: (meter: { add: () => void }) => unknown) => fn({ add() {} }),
  budgetErrorResponse: () => null,
}));

import { POST } from "@/app/api/parse-resume/route";

/** What the AI returns: the v2 field layout (title = organization, subtitle = role). */
const aiResume = {
  header: { name: "Ada Lovelace", contact: "ada@example.com" },
  sections: [
    {
      id: "s1",
      title: "Experience",
      items: [
        {
          id: "i1",
          title: "Acme",
          subtitle: "Engineer",
          location: "Boston",
          dates: "2025",
          bullets: [{ id: "b1", text: "Built a dashboard" }],
        },
      ],
    },
  ],
};

const textRequest = (text: string) =>
  new Request("http://localhost/api/parse-resume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });

const fileRequest = (name: string, type: string, body: string) => {
  const form = new FormData();
  form.append("file", new File([body], name, { type }));
  return new Request("http://localhost/api/parse-resume", { method: "POST", body: form });
};

describe("POST /api/parse-resume: template only for text imports", () => {
  beforeEach(() => {
    h.reply = structuredClone(aiResume);
    h.prompts.length = 0;
  });

  it("pasted text gets the Harvard template as explicit formatting", async () => {
    const res = await POST(textRequest("Ada Lovelace\nAcme, Engineer"));
    expect(res.status).toBe(200);
    const { resume } = await res.json();
    expect(resume.version).toBe(3);
    expect(resume.header.marks.name).toEqual([{ from: 0, to: "Ada Lovelace".length, bold: true, size: 16 }]);
    expect(resume.header.para.name).toEqual({ align: "center" });
    expect(resume.sections[0].para).toEqual({ rule: true, caps: true, spaceBefore: 6 });
  });

  it("a .txt upload gets the template too", async () => {
    const res = await POST(fileRequest("cv.txt", "text/plain", "Ada Lovelace"));
    expect(res.status).toBe(200);
    const { resume } = await res.json();
    expect(resume.header.marks.name).toEqual([{ from: 0, to: "Ada Lovelace".length, bold: true, size: 16 }]);
  });

  it("an uploaded PDF gets no formatting, and keeps the fields as the AI returned them", async () => {
    const res = await POST(fileRequest("cv.pdf", "application/pdf", "%PDF-1.4"));
    expect(res.status).toBe(200);
    const { resume } = await res.json();
    expect(resume.version).toBe(3);
    expect(JSON.stringify(resume)).not.toMatch(/"(marks|para|styles?)"/);
    expect(resume.header).toEqual({ name: "Ada Lovelace", contact: "ada@example.com" });
    // v2 layout kept: the organization is the title, the role the subtitle (no swap).
    expect(resume.sections[0].items[0]).toMatchObject({ title: "Acme", subtitle: "Engineer" });
    expect(h.prompts).toHaveLength(1);
  });
});
