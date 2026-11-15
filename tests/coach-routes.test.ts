import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  reply: null as unknown,
  prompt: "",
  writes: [] as string[],
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
  job: { title: "Data Analyst Intern", company: "Acme", location: "NYC", description: "We want SQL and dashboards." } as Record<string, unknown> | null,
  facts: [] as Record<string, unknown>[],
}));

function fakeSupabase() {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcs.push({ name, args });
      return { data: name === "reserve_ai_call" ? "res" : null, error: null };
    },
    from(table: string) {
      let op = "select";
      const q = {
        select: () => q,
        order: () => q,
        eq: () => q,
        maybeSingle: () => q,
        insert: () => ((op = "insert"), q),
        update: () => ((op = "update"), q),
        delete: () => ((op = "delete"), q),
        then: (res: (v: unknown) => unknown) => {
          if (op !== "select") h.writes.push(`${op} ${table}`);
          if (table === "jobs") return Promise.resolve({ data: h.job, error: null }).then(res);
          if (table === "facts") return Promise.resolve({ data: h.facts, error: null }).then(res);
          return Promise.resolve({ data: null, error: null }).then(res);
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

import { POST as examples } from "@/app/api/coach/examples/route";
import { POST as questions } from "@/app/api/coach/questions/route";

const req = (body: unknown) => new Request("http://x/api/coach", { method: "POST", body: JSON.stringify(body) });
const body = (over: Record<string, unknown> = {}) => ({
  jobId: "j1",
  resumeId: "R",
  entryId: "e1",
  entry: { title: "Learning Center", subtitle: "Math Tutor", location: "", dates: "" },
  bullets: [{ id: "b1", text: "Tutored 30 students in calculus" }],
  bulletId: "b1",
  round: 1,
  ...over,
});
const fact = (text: string, over: Record<string, unknown> = {}) => ({
  id: text, text, source: "manual", active: true, resume_id: null, bullet_id: null, entry_id: null, created_at: "2026-01-01", updated_at: "", ...over,
});

beforeEach(() => {
  h.writes = [];
  h.rpcs = [];
  h.prompt = "";
  h.facts = [fact("Ran 4 review sessions before finals", { entry_id: "e1" }), fact("Draft with [N]", { active: false })];
  h.job = { title: "Data Analyst Intern", company: "Acme", location: "NYC", description: "We want SQL and dashboards." };
});

describe("POST /api/coach/examples", () => {
  it("returns checked examples (stray numbers dropped), angled to the posting read from the job row, and saves nothing", async () => {
    h.reply = {
      examples: [
        { text: "Tutored {{b1}} students a week in calculus", blanks: [{ key: "b1", label: "students per week", example_value: "15" }] },
        { text: "Tutored 30 students, lifting pass rates 25%", blanks: [] },
      ],
    };
    const res = await examples(req(body({ jobDescription: "INJECTED POSTING" })));
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.examples.map((e: { text: string }) => e.text)).toEqual(["Tutored {{b1}} students a week in calculus"]);
    expect(h.prompt).toMatch(/We want SQL and dashboards/);
    expect(h.prompt).not.toMatch(/INJECTED POSTING/);
    expect(h.prompt).toMatch(/- Ran 4 review sessions before finals/);
    expect(h.prompt).not.toMatch(/Draft with/);
    expect(h.writes).toEqual([]);
    expect(h.rpcs.find((r) => r.name === "reserve_ai_call")?.args).toMatchObject({ p_action: "coach_examples", p_weight: "light" });
  });

  it("on the master (no job) the prompt aims at general strength", async () => {
    h.reply = { examples: [{ text: "Tutored {{b1}} students", blanks: [{ key: "b1", label: "students" }] }] };
    await examples(req(body({ jobId: null })));
    expect(h.prompt).toMatch(/master resume \(no specific job\)/);
    expect(h.prompt).not.toMatch(/JOB POSTING/);
  });

  it("422 with a plain message when every example fails the honesty check; 404 for a deleted job; 400 without an entry", async () => {
    h.reply = { examples: [{ text: "Tutored 50 students", blanks: [] }] };
    const res = await examples(req(body()));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("The AI's examples didn't pass our honesty check. Try More examples.");
    h.job = null;
    expect((await examples(req(body()))).status).toBe(404);
    expect((await examples(req({}))).status).toBe(400);
  });
});

describe("POST /api/coach/questions", () => {
  it("returns 3-5 questions and saves nothing", async () => {
    h.reply = { questions: [{ question: "How many students a week?", why: "Scope", tip: "Count a typical week" }, { question: "Which topics?" }] };
    const out = await (await questions(req(body()))).json();
    expect(out.questions.map((q: { question: string }) => q.question)).toEqual(["How many students a week?", "Which topics?"]);
    expect(h.writes).toEqual([]);
    expect(h.rpcs.find((r) => r.name === "reserve_ai_call")?.args).toMatchObject({ p_action: "coach_questions", p_weight: "light" });
  });
});
