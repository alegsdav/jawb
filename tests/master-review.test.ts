import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeMasterAnalysis } from "@/lib/analysis";
import type { MasterAnalysis } from "@/lib/types";

const h = vi.hoisted(() => ({
  user: { id: "u", email: "a@b.c" } as null | { id: string; email: string },
  /** The master row; `analysis` only exists when the column does (migration 0011). */
  master: null as null | { id: string; content: unknown; analysis?: unknown },
  /** False = migration 0011 not run: selecting or writing `analysis` fails like PostgREST does. */
  column: true,
  updateError: null as null | { message: string },
  updates: [] as { values: Record<string, unknown>; id: unknown }[],
  facts: [] as Record<string, unknown>[],
  gemini: { json: null as unknown, prompt: "" },
  reservation: "res1" as string | null,
  rpcs: [] as { name: string; args: Record<string, unknown> }[],
}));

const missingColumn = { code: "42703", message: 'column resumes.analysis does not exist' };

function fakeSupabase() {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      h.rpcs.push({ name, args });
      return { data: name === "reserve_ai_call" ? h.reservation : null, error: null };
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let cols = "";
      let patch: Record<string, unknown> | null = null;
      const exec = async (): Promise<{ data: unknown; error: unknown }> => {
        if (table === "facts") return { data: h.facts, error: null };
        if (table !== "resumes") return { data: null, error: null };
        if (patch) {
          h.updates.push({ values: patch, id: filters.id });
          if (h.updateError) return { data: null, error: h.updateError };
          if (!h.column) return { data: null, error: missingColumn };
          if (!h.master || filters.id !== h.master.id) return { data: [], error: null };
          Object.assign(h.master, patch);
          return { data: [{ id: h.master.id }], error: null };
        }
        if (cols.includes("analysis") && !h.column) return { data: null, error: missingColumn };
        if (filters.id !== undefined) {
          // currentReview: the stored analysis of one row.
          return { data: { analysis: h.master?.analysis ?? null }, error: null };
        }
        if (!h.master) return { data: null, error: null };
        const row: Record<string, unknown> = { id: h.master.id, content: h.master.content };
        if (cols.includes("analysis")) row.analysis = h.master.analysis ?? null;
        return { data: row, error: null };
      };
      const b = {
        select(c: string) {
          cols = c;
          return b;
        },
        update(v: Record<string, unknown>) {
          patch = v;
          return b;
        },
        eq(k: string, v: unknown) {
          filters[k] = v;
          return b;
        },
        in: () => b,
        gt: () => b,
        order: () => b,
        maybeSingle: () => b,
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return exec().then(res, rej);
        },
      };
      return b;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  requireUser: async () => ({ supabase: fakeSupabase(), user: h.user }),
}));
vi.mock("@/lib/gemini", () => ({
  geminiJSON: async (prompt: string) => ((h.gemini.prompt = prompt), h.gemini.json),
  geminiText: async (prompt: string) => ((h.gemini.prompt = prompt), ""),
}));

import { POST, PATCH } from "@/app/api/analyze-master/route";

const resume = {
  version: 2,
  header: { name: "Ann", contact: "" },
  sections: [
    {
      id: "s",
      title: "Experience",
      items: [
        {
          id: "i",
          title: "Acme",
          subtitle: "",
          location: "",
          dates: "",
          bullets: [
            { id: "b1", text: "Built a tool for 300 students" },
            { id: "b2", text: "Collaborated with engineers and designers" },
            { id: "b3", text: "Led weekly review sessions" },
          ],
        },
      ],
    },
  ],
};

const emptyMaster = { version: 2, header: { name: "", contact: "" }, sections: [] };

const post = () => POST();
const patch = (body: unknown) => PATCH(new Request("http://x/api", { method: "PATCH", body: JSON.stringify(body) }));
const rawPatch = (text: string) => PATCH(new Request("http://x/api", { method: "PATCH", body: text }));

const storedReview = (over: Partial<MasterAnalysis> = {}): MasterAnalysis => ({
  verdict: "Old verdict",
  weakest: ["b2"],
  strengths: [],
  gaps: [],
  bullets: [{ bullet_id: "b2", rating: "weak", note: "Duties", rewrite: "", why: "" }],
  questions: [{ id: "q1", question: "How many students?", why: "scale" }],
  answers: { q1: "300" },
  dismissed: ["b2"],
  analyzed_at: "2026-11-01T00:00:00.000Z",
  ...over,
});

beforeEach(() => {
  h.user = { id: "u", email: "a@b.c" };
  h.master = { id: "m1", content: resume, analysis: null };
  h.column = true;
  h.updateError = null;
  h.updates = [];
  h.facts = [];
  h.reservation = "res1";
  h.rpcs = [];
  h.gemini.prompt = "";
  h.gemini.json = {
    verdict: "Solid bullets, but some describe duties.",
    weakest: ["b2", "nope"],
    strengths: ["Clear scope"],
    gaps: [{ issue: "Skills near the top", severity: "medium", fix: "Move skills to the bottom" }],
    bullets: [
      { bullet_id: "b1", rating: "ok", note: "Missing the result", rewrite: "Built a tool for 300 students, cutting grading time 40%", why: "Adds the result" },
      { bullet_id: "b2", rating: "weak", note: "Duties only", rewrite: "", why: "" },
      { bullet_id: "b3", rating: "strong", note: "Clear", rewrite: "", why: "" },
      { bullet_id: "zz", rating: "weak", note: "Not on the resume", rewrite: "", why: "" },
    ],
    questions: [],
  };
});

describe("normalizeMasterAnalysis", () => {
  const bullets = [
    { bullet_id: "a", rating: "strong" as const, note: "", rewrite: "" },
    { bullet_id: "b", rating: "ok" as const, note: "", rewrite: "" },
    { bullet_id: "c", rating: "weak" as const, note: "", rewrite: "" },
    { bullet_id: "d", rating: "weak" as const, note: "", rewrite: "" },
    { bullet_id: "e", rating: "ok" as const, note: "", rewrite: "" },
  ];

  it("keeps the given weakest order, drops unknown and strong ids, and dedupes", () => {
    const out = normalizeMasterAnalysis({ bullets, weakest: ["d", "a", "zz", "c", "d", "b"] });
    expect(out.weakest).toEqual(["d", "c", "b"]);
  });

  it("caps weakest at five", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ bullet_id: `x${i}`, rating: "weak", note: "", rewrite: "" }));
    const out = normalizeMasterAnalysis({ bullets: many, weakest: many.map((b) => b.bullet_id) });
    expect(out.weakest).toHaveLength(5);
    expect(out.weakest[0]).toBe("x0");
  });

  it("derives weakest from the ratings when the model gave none: weak first, then ok, in bullet order, max 5", () => {
    expect(normalizeMasterAnalysis({ bullets }).weakest).toEqual(["c", "d", "b", "e"]);
    expect(normalizeMasterAnalysis({ bullets, weakest: [] }).weakest).toEqual(["c", "d", "b", "e"]);
    // Only strong ids given: none usable, so derive.
    expect(normalizeMasterAnalysis({ bullets, weakest: ["a"] }).weakest).toEqual(["c", "d", "b", "e"]);
    const many = Array.from({ length: 7 }, (_, i) => ({ bullet_id: `w${i}`, rating: i < 2 ? "ok" : "weak", note: "", rewrite: "" }));
    expect(normalizeMasterAnalysis({ bullets: many }).weakest).toEqual(["w2", "w3", "w4", "w5", "w6"]);
  });

  it("strips [b:ID] tokens from weakest and bullet ids, and from user-facing text", () => {
    const out = normalizeMasterAnalysis({
      verdict: "Fix [b:b1] first.",
      bullets: [{ bullet_id: "[b:b1]", rating: "weak", note: "Duties", rewrite: "" }],
      weakest: ["[b:b1]"],
    });
    expect(out.weakest).toEqual(["b1"]);
    expect(out.bullets[0].bullet_id).toBe("b1");
    expect(out.verdict).not.toContain("b:");
  });

  it("is defensive: any junk becomes a complete, empty review", () => {
    expect(normalizeMasterAnalysis(null)).toEqual({ verdict: "", weakest: [], strengths: [], gaps: [], bullets: [], questions: [] });
    expect(normalizeMasterAnalysis("nope")).toEqual(normalizeMasterAnalysis(null));
    const out = normalizeMasterAnalysis({ gaps: [{ issue: "x", severity: "bogus" }], strengths: [null, "A"], questions: [{ question: "" }] });
    expect(out.gaps).toEqual([{ issue: "x", severity: "medium", fix: "" }]);
    expect(out.strengths).toEqual(["A"]);
    expect(out.questions).toEqual([]);
  });

  it("keeps the user's answers, dismissals and timestamp from a stored review", () => {
    const out = normalizeMasterAnalysis({ bullets: [], answers: { q1: 300 }, dismissed: ["b1", ""], analyzed_at: "2026-01-01T00:00:00.000Z" });
    expect(out.answers).toEqual({ q1: "300" });
    expect(out.dismissed).toEqual(["b1"]);
    expect(out.analyzed_at).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("POST /api/analyze-master", () => {
  it("requires sign-in", async () => {
    h.user = null;
    const res = await post();
    expect(res.status).toBe(401);
  });

  it("an empty master is a friendly 400 and the AI is not called", async () => {
    h.master = { id: "m1", content: emptyMaster, analysis: null };
    const res = await post();
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/^Your master resume is empty/);
    expect(h.gemini.prompt).toBe("");
  });

  it("is metered as a heavy master_review", async () => {
    await post();
    expect(h.rpcs.filter((r) => r.name === "reserve_ai_call").map((r) => [r.args.p_action, r.args.p_weight])).toEqual([
      ["master_review", "heavy"],
    ]);
    expect(h.rpcs.filter((r) => r.name === "finish_ai_call").map((r) => r.args.p_status)).toEqual(["ok"]);
  });

  it("over the limit: 429, the AI is not called and nothing is saved", async () => {
    h.reservation = null;
    const res = await post();
    expect(res.status).toBe(429);
    expect((await res.json()).limit).toBe("heavy");
    expect(h.gemini.prompt).toBe("");
    expect(h.updates).toHaveLength(0);
  });

  it("returns { analysis, saved }: every bullet rated, the weakest first, unknown ids dropped, numbers guarded", async () => {
    const body = await (await post()).json();
    expect(body.saved).toBe(true);
    const a: MasterAnalysis = body.analysis;
    expect(a.bullets.map((b) => b.bullet_id)).toEqual(["b1", "b2", "b3"]);
    expect(a.weakest).toEqual(["b2"]);
    expect(a.analyzed_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(a.dismissed).toEqual([]);
    // 40% is not in the bullet, the facts or the answers: a placeholder and a question instead.
    expect(a.bullets[0].rewrite).toBe("Built a tool for 300 students, cutting grading time [X%]");
    expect(a.bullets[0].original).toBe("Built a tool for 300 students");
    expect(a.questions).toEqual([expect.objectContaining({ bullet_id: "b1", placeholder: "[X%]" })]);
  });

  it("writes only the analysis column of the master row", async () => {
    const body = await (await post()).json();
    expect(h.updates).toHaveLength(1);
    expect(Object.keys(h.updates[0].values)).toEqual(["analysis"]);
    expect(h.updates[0].id).toBe("m1");
    expect(h.updates[0].values.analysis).toEqual(body.analysis);
    expect(h.master?.content).toBe(resume);
  });

  it("carries the stored answers over and clears the dismissals", async () => {
    h.master = { id: "m1", content: resume, analysis: storedReview() };
    const body = await (await post()).json();
    expect(body.analysis.answers).toEqual({ q1: "300" });
    expect(body.analysis.questions.map((q: { id: string }) => q.id)).toContain("q1");
    expect(body.analysis.dismissed).toEqual([]);
    expect(h.gemini.prompt).toContain("Q: How many students?\nA: 300");
  });

  it("saved: false (with the review) when the analysis column is missing, and nothing is written", async () => {
    h.column = false;
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(false);
    expect(body.analysis.bullets).toHaveLength(3);
    expect(h.updates).toHaveLength(0);
  });

  it("saved: false when the write fails", async () => {
    h.updateError = { message: "upstream connect error or disconnect/reset before headers" };
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.saved).toBe(false);
    expect(body.analysis.bullets).toHaveLength(3);
  });

  it("an active fact's numbers are sources for every bullet's rewrite", async () => {
    h.facts = [{ id: "f1", text: "Cut grading time 40% for students", active: true, source: "manual", resume_id: null, bullet_id: null, entry_id: null, created_at: "2026-01-01", updated_at: "2026-01-01" }];
    const body = await (await post()).json();
    expect(body.analysis.bullets[0].rewrite).toBe("Built a tool for 300 students, cutting grading time 40%");
    expect(h.gemini.prompt).toContain("- Cut grading time 40% for students");
  });

  it("a model reply with nothing usable still gives a complete, empty review", async () => {
    h.gemini.json = null;
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analysis).toEqual(expect.objectContaining({ verdict: "", weakest: [], bullets: [], questions: [] }));
  });
});

describe("PATCH /api/analyze-master", () => {
  beforeEach(() => {
    h.master = { id: "m1", content: resume, analysis: storedReview({ answers: { q1: "300", q2: "old" } }) };
  });

  it("requires sign-in", async () => {
    h.user = null;
    expect((await patch({ answers: {} })).status).toBe(401);
  });

  it("merges answers per question id: an empty answer removes it, others stay", async () => {
    const body = await (await patch({ answers: { q2: "", q3: "  Fifty  " } })).json();
    expect(body.saved).toBe(true);
    expect(body.analysis.answers).toEqual({ q1: "300", q3: "Fifty" });
    expect(h.updates).toHaveLength(1);
    expect(Object.keys(h.updates[0].values)).toEqual(["analysis"]);
    expect(h.master?.analysis).toEqual(body.analysis);
  });

  it("dismissed replaces the list when given, and is kept otherwise", async () => {
    const replaced = await (await patch({ dismissed: ["b3"] })).json();
    expect(replaced.analysis.dismissed).toEqual(["b3"]);
    const kept = await (await patch({ answers: { q1: "301" } })).json();
    expect(kept.analysis.dismissed).toEqual(["b3"]);
  });

  it("no stored review: analysis null, nothing saved", async () => {
    h.master = { id: "m1", content: resume, analysis: null };
    const body = await (await patch({ answers: { q1: "x" } })).json();
    expect(body).toEqual({ analysis: null, saved: false });
    expect(h.updates).toHaveLength(0);
  });

  it("migration 0011 missing: analysis null, saved false", async () => {
    h.column = false;
    const body = await (await patch({ answers: { q1: "x" } })).json();
    expect(body).toEqual({ analysis: null, saved: false });
  });

  it("answers over the length cap are refused in plain language", async () => {
    const res = await patch({ answers: { q1: "x".repeat(1001) } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Answers can be at most 1000 characters.");
    expect(h.updates).toHaveLength(0);
  });

  it("wrong shapes are refused", async () => {
    expect((await patch(["nope"])).status).toBe(400);
    expect((await patch({ answers: "x" })).status).toBe(400);
    expect((await patch({ answers: { q1: 5 } })).status).toBe(400);
    expect((await patch({ dismissed: "b1" })).status).toBe(400);
    expect((await patch({ dismissed: [1] })).status).toBe(400);
    expect((await rawPatch("{not json")).status).toBe(400);
    expect(h.updates).toHaveLength(0);
  });
});
