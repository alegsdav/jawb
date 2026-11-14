import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AI_WEIGHTS, AiBudgetError, aiLimits, budgetErrorResponse, limitMessage, resetTime, usageSummary, withAiBudget,
} from "@/lib/aiBudget";
import { readUsage } from "@/lib/gemini";
import { friendlyError } from "@/lib/api";
import { AI_LIMIT_MESSAGE } from "@/lib/gemini";

type Row = { id: string; weight: string; action: string; status: string; created_at: string; total_tokens: number; model: string };

const intervalMs = (i: string) => {
  const [n, unit] = i.split(" ");
  return Number(n) * (unit.startsWith("hour") ? 3600000 : 60000);
};

/**
 * Fake Supabase with reserve_ai_call / finish_ai_call implemented like the SQL: the count and the
 * insert happen under a per-weight lock (the advisory lock), with an await in between that would let
 * parallel requests overshoot without it.
 */
function fakeDb(clock: { now: number }, opts: { missing?: boolean; lock?: boolean } = {}) {
  const rows: Row[] = [];
  const locks: Record<string, Promise<unknown>> = {};
  let n = 0;
  const reserve = async (a: Record<string, unknown>) => {
    const since = clock.now - intervalMs(String(a.p_window));
    const used = rows.filter(
      (r) => r.weight === a.p_weight && (r.status === "pending" || r.status === "ok") && Date.parse(r.created_at) > since,
    ).length;
    await new Promise((r) => setTimeout(r, 1)); // between the count and the insert
    if (used >= Number(a.p_limit)) return { data: null, error: null };
    const id = `r${++n}`;
    rows.push({ id, weight: String(a.p_weight), action: String(a.p_action), status: "pending", created_at: new Date(clock.now).toISOString(), total_tokens: 0, model: "" });
    return { data: id, error: null };
  };
  const client = {
    rows,
    rpc(name: string, a: Record<string, unknown>) {
      if (opts.missing) return Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
      if (name === "reserve_ai_call") {
        if (opts.lock === false) return reserve(a);
        const key = String(a.p_weight);
        const run = (locks[key] ?? Promise.resolve()).then(() => reserve(a));
        locks[key] = run.catch(() => {});
        return run;
      }
      if (name === "finish_ai_call") {
        const r = rows.find((x) => x.id === a.p_id && x.status === "pending");
        if (r) Object.assign(r, { status: a.p_status === "ok" ? "ok" : "failed", total_tokens: a.p_total, model: a.p_model });
        return Promise.resolve({ data: null, error: null });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from() {
      const f: { statuses?: string[]; since?: string; weight?: string } = {};
      const q = {
        select: () => q,
        in: (_k: string, v: string[]) => ((f.statuses = v), q),
        gt: (_k: string, v: string) => ((f.since = v), q),
        eq: (_k: string, v: string) => ((f.weight = v), q),
        order: () => q,
        then: (res: (v: unknown) => unknown) => {
          if (opts.missing) return Promise.resolve({ data: null, error: { code: "42P01", message: "relation does not exist" } }).then(res);
          const data = rows
            .filter((r) => (!f.statuses || f.statuses.includes(r.status)) && (!f.since || r.created_at > f.since) && (!f.weight || r.weight === f.weight))
            .map((r) => ({ weight: r.weight, created_at: r.created_at }));
          return Promise.resolve({ data, error: null }).then(res);
        },
      };
      return q;
    },
  };
  return client;
}

const asClient = (db: ReturnType<typeof fakeDb>) => db as unknown as SupabaseClient;
const T0 = Date.parse("2026-11-14T12:00:00Z");
const env = { AI_HEAVY_PER_DAY: "3", AI_LIGHT_PER_HOUR: "5" };

afterEach(() => vi.restoreAllMocks());

describe("weights and limits", () => {
  it("keeps every action's weight in one table, with the documented defaults", () => {
    expect(AI_WEIGHTS).toMatchObject({
      analyze: "heavy", reanalyze: "heavy", parse_resume: "heavy", builder_draft: "heavy",
      intake_meta: "light", cover_letter: "light", coach_examples: "light", coach_questions: "light", extract_facts: "light",
    });
    expect(aiLimits({})).toEqual({
      heavy: { limit: 10, windowMs: 86400000, interval: "24 hours" },
      light: { limit: 120, windowMs: 3600000, interval: "60 minutes" },
    });
    expect(aiLimits({ AI_HEAVY_PER_DAY: "4", AI_LIGHT_PER_HOUR: "nope" })).toMatchObject({ heavy: { limit: 4 }, light: { limit: 120 } });
  });
});

describe("withAiBudget", () => {
  it("allows calls up to the cap, then refuses with a 429 that says which limit and when it frees up", async () => {
    const clock = { now: T0 };
    const db = fakeDb(clock);
    const run = vi.fn(async () => "ok");
    for (let i = 0; i < 3; i++) {
      clock.now = T0 + i * 3600000; // one an hour
      await expect(withAiBudget(asClient(db), { action: "analyze", env, now: () => new Date(clock.now) }, run)).resolves.toBe("ok");
    }
    clock.now = T0 + 3 * 3600000;
    const err = await withAiBudget(asClient(db), { action: "reanalyze", env, now: () => new Date(clock.now) }, run).catch((e) => e);
    expect(err).toBeInstanceOf(AiBudgetError);
    expect(err.status).toBe(429);
    expect(err.weight).toBe("heavy");
    // The oldest counted call (T0) ages out 24h later: 21 hours from now.
    expect(err.resetAt).toBe(new Date(T0 + 86400000).toISOString());
    expect(err.message).toMatch(/all 3 of your analyses/);
    expect(err.message).toMatch(/in about 21 hours/);
    expect(err.message).not.toBe(AI_LIMIT_MESSAGE);
    expect(run).toHaveBeenCalledTimes(3);
    // A full day after the first call there's room again.
    clock.now = T0 + 86400000 + 1000;
    await expect(withAiBudget(asClient(db), { action: "analyze", env }, run)).resolves.toBe("ok");
  });

  it("parallel requests can't go over the cap (the reservation is atomic)", async () => {
    const db = fakeDb({ now: T0 });
    const run = vi.fn(async () => "ok");
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => withAiBudget(asClient(db), { action: "analyze", env }, run)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(5);
    expect(run).toHaveBeenCalledTimes(3);
    expect(db.rows.filter((r) => r.status === "ok")).toHaveLength(3);
  });

  it("(why the lock matters) without it, parallel requests overshoot", async () => {
    const db = fakeDb({ now: T0 }, { lock: false });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => withAiBudget(asClient(db), { action: "analyze", env }, async () => 1)));
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThan(3);
    // The SQL function takes a per-user, per-weight advisory lock around the count and insert.
    const sql = readFileSync("supabase/migrations/0004_invites_usage.sql", "utf8");
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtextextended\('ai_usage:' \|\| v_uid::text \|\| ':' \|\| p_weight/);
  });

  it("a failed call isn't counted (provider outages don't use up the limit) and the error is rethrown", async () => {
    const db = fakeDb({ now: T0 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 5; i++) {
      await expect(
        withAiBudget(asClient(db), { action: "analyze", env }, async () => {
          throw new Error("The AI service is having trouble. Try again in a minute.");
        }),
      ).rejects.toThrow("The AI service is having trouble");
    }
    expect(db.rows.map((r) => r.status)).toEqual(["failed", "failed", "failed", "failed", "failed"]);
    await expect(withAiBudget(asClient(db), { action: "analyze", env }, async () => "ok")).resolves.toBe("ok");
  });

  it("records token counts and the model from the meter", async () => {
    const db = fakeDb({ now: T0 });
    await withAiBudget(asClient(db), { action: "coach_examples", env }, async (meter) => {
      meter.add({ promptTokens: 100, outputTokens: 20, totalTokens: 120, model: "gemini-x" });
      meter.add({ promptTokens: 5, outputTokens: 5, totalTokens: 10 });
      return null;
    });
    expect(db.rows[0]).toMatchObject({ weight: "light", action: "coach_examples", status: "ok", total_tokens: 130, model: "gemini-x" });
  });

  it("heavy and light have separate caps and windows (24 hours vs 60 minutes)", async () => {
    const clock = { now: T0 };
    const db = fakeDb(clock);
    const ok = async () => "ok";
    for (let i = 0; i < 5; i++) await withAiBudget(asClient(db), { action: "extract_facts", env }, ok);
    await expect(withAiBudget(asClient(db), { action: "cover_letter", env }, ok)).rejects.toMatchObject({ status: 429, weight: "light" });
    // Light is full; heavy is untouched.
    await expect(withAiBudget(asClient(db), { action: "parse_resume", env }, ok)).resolves.toBe("ok");
    // An hour later the light window has rolled over; the heavy call from an hour ago still counts.
    clock.now = T0 + 3600000 + 1000;
    await expect(withAiBudget(asClient(db), { action: "coach_questions", env }, ok)).resolves.toBe("ok");
    const sum = await usageSummary(asClient(db), new Date(clock.now), env);
    expect(sum).toEqual({
      available: true,
      heavy: { used: 1, limit: 3, remaining: 2, resetAt: null },
      light: { used: 1, limit: 5, remaining: 4, resetAt: null },
    });
  });

  it("the light-limit message names the quick actions", async () => {
    const db = fakeDb({ now: T0 });
    for (let i = 0; i < 5; i++) await withAiBudget(asClient(db), { action: "coach_examples", env, now: () => new Date(T0) }, async () => 1);
    const err = await withAiBudget(asClient(db), { action: "coach_examples", env, now: () => new Date(T0 + 50 * 60000) }, async () => 1).catch((e) => e);
    expect(err.message).toBe(
      "You've reached your limit of 5 quick AI actions per hour (coaching, cover letters and job details). More open up in about 10 minutes.",
    );
    // Our API client keeps it as written (it's a plain sentence).
    expect(friendlyError(err.message)).toBe(err.message);
    const res = budgetErrorResponse(err)!;
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: err.message, limit: "light" });
  });

  it("without migration 0004 the call runs unmetered instead of breaking", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = fakeDb({ now: T0 }, { missing: true });
    await expect(withAiBudget(asClient(db), { action: "analyze", env }, async () => "ran")).resolves.toBe("ran");
    expect(await usageSummary(asClient(db), new Date(T0), env)).toEqual({ available: false });
  });

  it("a database error while reserving is a 503 with a plain message (the AI isn't called)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = { rpc: async () => ({ data: null, error: { code: "08006", message: "connection failure" } }) } as unknown as SupabaseClient;
    const run = vi.fn();
    const err = await withAiBudget(client, { action: "analyze", env }, run).catch((e) => e);
    expect(err).toMatchObject({ status: 503, message: "Couldn't check your AI usage. Check your connection and try again." });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("helpers", () => {
  it("resetTime: when enough calls age out to get back under the limit", () => {
    const lim = { limit: 2, windowMs: 1000, interval: "" };
    expect(resetTime(["2026-01-01T00:00:00.000Z"], lim)).toBeNull();
    expect(resetTime(["2026-01-01T00:00:00.500Z", "2026-01-01T00:00:00.100Z"], lim)).toBe("2026-01-01T00:00:01.100Z");
    expect(resetTime(["2026-01-01T00:00:00.100Z", "2026-01-01T00:00:00.200Z", "2026-01-01T00:00:00.300Z"], lim)).toBe(
      "2026-01-01T00:00:01.200Z",
    );
  });

  it("limitMessage without a known reset time", () => {
    expect(limitMessage("heavy", { limit: 10, windowMs: 0, interval: "" }, null)).toMatch(/opens up later\.$/);
  });

  it("readUsage maps Gemini's usageMetadata", () => {
    expect(readUsage({ usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, totalTokenCount: 20 }, modelVersion: "m-1" })).toEqual({
      promptTokens: 12, outputTokens: 3, totalTokens: 20, model: "m-1",
    });
    expect(readUsage({}, "fallback")).toEqual({ promptTokens: 0, outputTokens: 0, totalTokens: 0, model: "fallback" });
    expect(readUsage({ usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 6 } }).totalTokens).toBe(10);
  });
});

describe("geminiText reports usage without changing what it returns", () => {
  it("calls onUsage with the response's token counts", async () => {
    process.env.GEMINI_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }],
            usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2, totalTokenCount: 9 },
          }),
        ),
      ),
    );
    const { geminiJSON } = await import("@/lib/gemini");
    const seen: unknown[] = [];
    await expect(geminiJSON("p", { onUsage: (u) => seen.push(u) })).resolves.toEqual({ a: 1 });
    await expect(geminiJSON("p")).resolves.toEqual({ a: 1 }); // old call shape still works
    expect(seen).toEqual([expect.objectContaining({ promptTokens: 7, outputTokens: 2, totalTokens: 9 })]);
    vi.unstubAllGlobals();
  });
});
