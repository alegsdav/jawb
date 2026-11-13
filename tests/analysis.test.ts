import { describe, expect, it } from "vitest";
import { mergeAnalysis, normalizeAnalysis } from "@/lib/analysis";
import { formatAnswers } from "@/lib/answers";
import type { Analysis } from "@/lib/types";

describe("normalizeAnalysis", () => {
  it("accepts a valid fit bucket", () => {
    expect(normalizeAnalysis({ fit: "strong" }).fit).toBe("strong");
    expect(normalizeAnalysis({ fit: " Stretch " }).fit).toBe("stretch");
  });

  it("maps a legacy fit_score to a bucket", () => {
    expect(normalizeAnalysis({ fit_score: 82 }).fit).toBe("strong");
    expect(normalizeAnalysis({ fit_score: 60 }).fit).toBe("possible");
    expect(normalizeAnalysis({ fit_score: 20 }).fit).toBe("stretch");
    expect(normalizeAnalysis({ fit_score: "77" }).fit).toBe("strong");
    expect(normalizeAnalysis({ fit: "great", fit_score: 10 }).fit).toBe("stretch");
  });

  it("defaults fit to possible and never outputs fit_score or bank_suggestions", () => {
    const a = normalizeAnalysis({ fit_score: "", bank_suggestions: [{ bank_id: "x" }] }) as Record<string, unknown>;
    expect(a.fit).toBe("possible");
    expect(a).not.toHaveProperty("fit_score");
    expect(a).not.toHaveProperty("bank_suggestions");
  });

  it("does not throw on garbage", () => {
    for (const junk of [null, undefined, 42, "text", [], { keywords: "x", gaps: [null, 3], bullets: [null], questions: "?" }]) {
      expect(() => normalizeAnalysis(junk)).not.toThrow();
      const a = normalizeAnalysis(junk);
      expect(a.fit).toBe("possible");
      expect(Array.isArray(a.keywords.matched)).toBe(true);
      expect(Array.isArray(a.questions)).toBe(true);
    }
  });

  it("strips b: prefixes from bullet ids and drops bullets without one", () => {
    const a = normalizeAnalysis({
      bullets: [
        { bullet_id: "b:abc123", rating: "weak", note: "n", rewrite: "r" },
        { bullet_id: "[b:def456]", rating: "nonsense" },
        { bullet_id: "ghi789", rating: "strong" },
        { rating: "weak" },
      ],
    });
    expect(a.bullets.map((x) => x.bullet_id)).toEqual(["abc123", "def456", "ghi789"]);
    expect(a.bullets.map((x) => x.rating)).toEqual(["weak", "ok", "strong"]);
  });

  it("fills question ids and drops empty questions; coerces gap severity", () => {
    const a = normalizeAnalysis({
      questions: [{ question: "How many users?" }, { id: "x", question: "" }],
      gaps: [{ issue: "No SQL", severity: "urgent" }],
    });
    expect(a.questions).toEqual([{ id: "q0", question: "How many users?", why: "" }]);
    expect(a.gaps[0].severity).toBe("medium");
  });

  it("keeps stored user state (answers, dismissed, analyzed_at)", () => {
    const a = normalizeAnalysis({ fit_score: 90, answers: { q1: "12" }, dismissed: ["b1"], analyzed_at: "2026-01-01T00:00:00.000Z" });
    expect(a.answers).toEqual({ q1: "12" });
    expect(a.dismissed).toEqual(["b1"]);
    expect(a.analyzed_at).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("mergeAnalysis", () => {
  const fresh = (): Analysis =>
    normalizeAnalysis({
      fit: "possible",
      verdict: "ok",
      questions: [
        { id: "q1", question: "How many users did the dashboard have?", why: "metric" },
        { id: "q2", question: "Did you use Docker?", why: "keyword" },
      ],
    });

  it("timestamps, re-ids questions and resets dismissed when there is no previous analysis", () => {
    const now = new Date("2026-11-13T10:00:00.000Z");
    const out = mergeAnalysis(null, fresh(), now);
    expect(out.analyzed_at).toBe(now.toISOString());
    expect(out.dismissed).toEqual([]);
    expect(out.answers).toEqual({});
    expect(out.questions.map((q) => q.id)).toEqual([`q${now.getTime()}_0`, `q${now.getTime()}_1`]);
  });

  it("carries answered questions and their answers over, and drops unanswered ones", () => {
    const prev: Analysis = {
      ...normalizeAnalysis({ fit: "stretch" }),
      questions: [
        { id: "old1", question: "How many users did the dashboard have?", why: "" },
        { id: "old2", question: "What was the team size?", why: "" },
      ],
      answers: { old1: "About 40 analysts", old2: "   " },
      dismissed: ["b1", "b2"],
      analyzed_at: "2026-01-01T00:00:00.000Z",
    };
    const now = new Date("2026-11-13T10:00:00.000Z");
    const out = mergeAnalysis(prev, fresh(), now);
    expect(out.fit).toBe("possible");
    // The re-asked question is already answered, so it isn't duplicated.
    expect(out.questions.map((q) => q.question)).toEqual(["How many users did the dashboard have?", "Did you use Docker?"]);
    expect(out.questions[0].id).toBe("old1");
    expect(out.answers).toEqual({ old1: "About 40 analysts" });
    expect(out.dismissed).toEqual([]);
    expect(out.analyzed_at).toBe(now.toISOString());
    expect(formatAnswers(out)).toBe("Q: How many users did the dashboard have?\nA: About 40 analysts");
  });

  it("does not mutate its inputs", () => {
    const prev: Analysis = { ...fresh(), answers: { q1: "40" } };
    const snapshot = JSON.stringify(prev);
    mergeAnalysis(prev, fresh(), new Date());
    expect(JSON.stringify(prev)).toBe(snapshot);
  });
});
