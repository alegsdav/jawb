import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Resume } from "@/lib/types";

const h = vi.hoisted(() => ({
  updateError: null as null | { message: string },
  updates: [] as { table: string; values: Record<string, unknown>; ifUpdatedAt: unknown; matched: boolean }[],
  gemini: { json: null as unknown, text: "" },
  /** The job row; updates only land when `updated_at` still matches (like the real conditional write). */
  job: {} as Record<string, unknown>,
  /** Runs before the next update lands (another device writing while the AI ran). */
  before: null as null | (() => void),
}));
let clock = 1;
const freshJob = () => ({
  id: "j1", title: "Intern", company: "Acme", location: "NYC", description: "Founded in 2010, 50 engineers.", analysis: null, updated_at: "t1",
});

const tailored: Resume = {
  version: 2,
  header: { name: "Ann", contact: "" },
  sections: [
    {
      id: "s",
      title: "Experience",
      items: [{ id: "i", title: "Acme", subtitle: "", location: "", dates: "", bullets: [{ id: "b1", text: "Built a tool for 300 students" }] }],
    },
  ],
};

/** Fake Supabase: one job, its tailored copy and a master with one fact; updates can be made to fail. */
function fakeSupabase() {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let values: Record<string, unknown> | null = null;
      const b = {
        select: () => b,
        update: (v: Record<string, unknown>) => ((values = v), b),
        eq: (k: string, v: unknown) => ((filters[k] = v), b),
        maybeSingle: () => b,
        single: () => b,
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
          let out: unknown;
          if (values) {
            const run = h.before;
            h.before = null;
            run?.();
            const matched = !h.updateError && filters.updated_at === h.job.updated_at;
            h.updates.push({ table, values, ifUpdatedAt: filters.updated_at, matched });
            if (matched) Object.assign(h.job, values, { updated_at: `t${++clock}` });
            out = { data: h.updateError ? null : matched ? [{ updated_at: h.job.updated_at }] : [], error: h.updateError };
          } else if (table === "jobs") {
            out = { data: { ...h.job }, error: null };
          } else if (filters.is_master) {
            out = { data: { content: { ...tailored, facts: ["Saved $1,200 a month (re: savings?)"] } }, error: null };
          } else {
            out = { data: { content: tailored }, error: null };
          }
          return Promise.resolve(out).then(res, rej);
        },
      };
      return b;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  requireUser: async () => ({ supabase: fakeSupabase(), user: { id: "u", email: "a@b.c" } }),
}));
vi.mock("@/lib/gemini", () => ({
  geminiJSON: async () => h.gemini.json,
  geminiText: async () => h.gemini.text,
}));

import { POST as analyze } from "@/app/api/analyze/route";
import { POST as coverLetter } from "@/app/api/cover-letter/route";

const req = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  h.updateError = null;
  h.updates = [];
  h.job = freshJob();
  h.before = null;
});

describe("POST /api/analyze", () => {
  beforeEach(() => {
    h.gemini.json = {
      fit: "possible",
      verdict: "ok",
      bullets: [{ bullet_id: "b1", rating: "weak", note: "", rewrite: "Built a tool for 300 students, cutting grading time 40% and saving $1,200" }],
      questions: [],
    };
  });

  it("turns invented numbers in rewrites into placeholders (numbers from the resume and facts stay)", async () => {
    const res = await analyze(req({ jobId: "j1" }));
    const body = await res.json();
    expect(body.saved).toBe(true);
    expect(body.analysis.bullets[0].rewrite).toBe("Built a tool for 300 students, cutting grading time [X%] and saving $1,200");
    expect(body.analysis.questions).toEqual([expect.objectContaining({ bullet_id: "b1", placeholder: "[X%]" })]);
    expect(h.updates[0].values.analysis).toEqual(body.analysis);
  });

  it("returns saved: false (with the analysis) when the server-side write fails", async () => {
    h.updateError = { message: "upstream connect error or disconnect/reset before headers" };
    const res = await analyze(req({ jobId: "j1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(false);
    expect(body.analysis.bullets).toHaveLength(1);
  });

  it("writes only over the row it read", async () => {
    await analyze(req({ jobId: "j1" }));
    expect(h.updates.map((u) => [u.ifUpdatedAt, u.matched])).toEqual([["t1", true]]);
  });

  it("an answer given on another device while the AI ran is kept: re-read, merge, write once more", async () => {
    const phoneAnalysis = {
      fit: "possible",
      verdict: "",
      questions: [{ id: "q1", question: "How many users?", why: "" }],
      answers: { q1: "300" },
    };
    h.before = () => Object.assign(h.job, { analysis: phoneAnalysis, updated_at: "t-phone" });
    const body = await (await analyze(req({ jobId: "j1" }))).json();
    expect(h.updates.map((u) => [u.ifUpdatedAt, u.matched])).toEqual([
      ["t1", false],
      ["t-phone", true],
    ]);
    expect(body.saved).toBe(true);
    expect(body.analysis.answers).toEqual({ q1: "300" });
    expect(body.analysis.questions.map((q: { id: string }) => q.id)).toContain("q1");
    expect((h.job.analysis as { answers: unknown }).answers).toEqual({ q1: "300" });
  });

  it("gives up after one retry and returns saved: false (the page stores it, merging)", async () => {
    let n = 0;
    const bump = () => Object.assign(h.job, { updated_at: `elsewhere${++n}` });
    h.before = () => {
      bump();
      h.before = bump;
    };
    const body = await (await analyze(req({ jobId: "j1" }))).json();
    expect(body.saved).toBe(false);
    expect(h.updates).toHaveLength(2);
    expect(h.updates.every((u) => !u.matched)).toBe(true);
  });

  it("errors are plain language", async () => {
    const res = await analyze(req({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).not.toMatch(/undefined|null/);
  });
});

describe("POST /api/cover-letter", () => {
  it("replaces invented numbers; posting numbers only where the letter restates the posting", async () => {
    h.gemini.text =
      "Dear [Hiring Manager],\n\nAcme was founded in 2010 and has 50 engineers. I built a tool for 300 students and grew it 5x to 2,000 users. I'd join 50 engineers who ship weekly.";
    const res = await coverLetter(req({ jobId: "j1" }));
    const body = await res.json();
    expect(body.cover_letter).toBe(
      "Dear [Hiring Manager],\n\nAcme was founded in 2010 and has 50 engineers. I built a tool for 300 students and grew it [N]x to [N2] users. I'd join [N3] engineers who ship weekly.",
    );
    expect(body.saved).toBe(true);
    expect(h.updates.map((u) => [u.ifUpdatedAt, u.matched])).toEqual([["t1", true]]);
  });

  it("doesn't overwrite a row changed meanwhile: saved: false, the page autosaves the letter", async () => {
    h.gemini.text = "Dear [Hiring Manager],\n\nThanks.";
    h.before = () => Object.assign(h.job, { cover_letter: "edited on the phone", updated_at: "t-phone" });
    const body = await (await coverLetter(req({ jobId: "j1" }))).json();
    expect(body.saved).toBe(false);
    expect(body.cover_letter).toBe("Dear [Hiring Manager],\n\nThanks.");
    expect(h.job.cover_letter).toBe("edited on the phone");
  });
});
