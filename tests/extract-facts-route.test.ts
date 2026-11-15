import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  facts: [] as Record<string, unknown>[],
  missing: false,
  inserted: [] as Record<string, unknown>[],
  reply: null as unknown,
  prompt: "",
  reservation: "res" as string | null,
}));

function fakeSupabase() {
  return {
    rpc: async (name: string) => ({ data: name === "reserve_ai_call" ? h.reservation : null, error: null }),
    from(table: string) {
      let insert: Record<string, unknown>[] | null = null;
      const q = {
        select: () => q,
        order: () => q,
        in: () => q,
        gt: () => q,
        eq: () => q,
        insert: (v: Record<string, unknown>[]) => ((insert = v), q),
        then: (res: (v: unknown) => unknown) => {
          if (table === "ai_usage") return Promise.resolve({ data: [], error: null }).then(res);
          if (h.missing) return Promise.resolve({ data: null, error: { code: "42P01", message: "relation does not exist" } }).then(res);
          if (insert) {
            const rows = insert.map((r, i) => ({ id: `new${i}`, created_at: "", updated_at: "", ...r }));
            h.inserted.push(...rows);
            return Promise.resolve({ data: rows, error: null }).then(res);
          }
          return Promise.resolve({ data: h.facts, error: null }).then(res);
        },
      };
      return q;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  requireUser: async () => ({ supabase: fakeSupabase(), user: { id: "u", email: "a@b.c" } }),
}));
vi.mock("@/lib/gemini", () => ({
  geminiJSON: async (prompt: string) => ((h.prompt = prompt), h.reply),
}));

import { POST } from "@/app/api/extract-facts/route";

const req = (body: unknown) => new Request("http://x/api/extract-facts", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  h.facts = [{ id: "old", text: "Tutored calculus for two semesters", source: "manual", active: true, resume_id: null, bullet_id: null, entry_id: null, created_at: "", updated_at: "" }];
  h.missing = false;
  h.inserted = [];
  h.reservation = "res";
  h.reply = {
    facts: [
      "Tutored about 20 students a week in calculus",
      "Tutored calculus for two semesters",
      "Improved exam scores by 30%",
    ],
  };
});

describe("POST /api/extract-facts", () => {
  it("saves the facts that restate the answer (deduplicated), linked to the entry, and drops invented numbers", async () => {
    const res = await POST(
      req({
        answer: "About 20 students a week, for two semesters.",
        question: "How many students did you tutor?",
        context: "Math tutor at the learning center",
        resumeId: "M",
        entryId: "i1",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dropped).toBe(1);
    expect(body.facts.map((f: { text: string }) => f.text)).toEqual(["Tutored about 20 students a week in calculus"]);
    expect(h.inserted).toEqual([
      expect.objectContaining({ text: "Tutored about 20 students a week in calculus", source: "extracted", active: true, resume_id: "M", entry_id: "i1", bullet_id: null }),
    ]);
    // The question and context are labeled as not being sources.
    expect(h.prompt).toMatch(/QUESTION THEY WERE ASKED \(for context only; it is NOT a source of facts\)/);
  });

  it("needs an answer", async () => {
    expect((await POST(req({ answer: "  " }))).status).toBe(400);
  });

  it("before migration 0005: a plain database-update message, and no AI call", async () => {
    h.missing = true;
    h.reply = null;
    const res = await POST(req({ answer: "Something true" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/^Database update needed/);
    expect(h.inserted).toEqual([]);
  });

  it("is a light AI call and respects the limit", async () => {
    h.reservation = null;
    const res = await POST(req({ answer: "Something true" }));
    expect(res.status).toBe(429);
    expect((await res.json()).limit).toBe("light");
  });
});
