import { describe, expect, it } from "vitest";
import {
  answerFactChanges, attachOriginals, bulletFeedback, fillPlaceholder, findPlaceholder, matchesRewrite, normalizeAnalysis,
  planFill, removeFacts, suggestFill,
} from "@/lib/analysis";
import type { Analysis, Resume } from "@/lib/types";

const resume = (texts: Record<string, string>): Resume => ({
  version: 2,
  header: { name: "A", contact: "" },
  sections: [
    {
      id: "s",
      title: "Experience",
      items: [{ id: "i", title: "Co", subtitle: "", location: "", dates: "", bullets: Object.entries(texts).map(([id, text]) => ({ id, text })) }],
    },
  ],
});

const analysis = (bullets: Analysis["bullets"], extra: Partial<Analysis> = {}): Analysis => ({
  ...normalizeAnalysis({}),
  bullets,
  ...extra,
});

describe("normalizeAnalysis (round 2 fields)", () => {
  it("keeps original on bullets and bullet_id/placeholder on questions", () => {
    const a = normalizeAnalysis({
      bullets: [{ bullet_id: "b1", rating: "weak", note: "", rewrite: "x", original: "Did stuff" }],
      questions: [
        { id: "q1", question: "How many users?", why: "", bullet_id: "[b:b1]", placeholder: "[N users]" },
        { id: "q2", question: "Other?", why: "", bullet_id: "b1" }, // no placeholder: dropped
        { id: "q3", question: "Hours?", why: "", bullet_id: "b2", placeholder: "X hrs" }, // brackets added
      ],
    });
    expect(a.bullets[0].original).toBe("Did stuff");
    expect(a.questions[0]).toMatchObject({ bullet_id: "b1", placeholder: "[N users]" });
    expect(a.questions[1]).not.toHaveProperty("bullet_id");
    expect(a.questions[2].placeholder).toBe("[X hrs]");
  });

  it("does not invent original for old analyses", () => {
    const a = normalizeAnalysis({ bullets: [{ bullet_id: "b1", rating: "ok", note: "", rewrite: "" }] });
    expect(a.bullets[0]).not.toHaveProperty("original");
  });
});

describe("attachOriginals", () => {
  it("stores the text each bullet had when rated", () => {
    const a = attachOriginals(
      analysis([
        { bullet_id: "b1", rating: "weak", note: "", rewrite: "Better" },
        { bullet_id: "gone", rating: "ok", note: "", rewrite: "" },
      ]),
      resume({ b1: "Did stuff" }),
    );
    expect(a.bullets[0].original).toBe("Did stuff");
    expect(a.bullets[1]).not.toHaveProperty("original");
  });
});

describe("bulletFeedback (stale AI feedback)", () => {
  const fb = { bullet_id: "b1", rating: "weak" as const, note: "vague", rewrite: "Built X for [N users]", original: "Did stuff" };

  it("shows rating and suggestion while the text matches what was rated", () => {
    const out = bulletFeedback(analysis([fb]), resume({ b1: "Did stuff" }));
    expect(out.b1).toEqual({ state: "current", rating: "weak", note: "vague", suggestion: "Built X for [N users]" });
  });

  it("hides rating and suggestion once the bullet was edited", () => {
    const out = bulletFeedback(analysis([fb]), resume({ b1: "Did other stuff" }));
    expect(out.b1.state).toBe("stale");
    expect(out.b1.suggestion).toBe("");
  });

  it("shows a neutral 'updated' state after accepting, also once placeholders are filled", () => {
    expect(bulletFeedback(analysis([fb]), resume({ b1: "Built X for [N users]" })).b1).toMatchObject({ state: "updated", suggestion: "" });
    expect(bulletFeedback(analysis([fb]), resume({ b1: "Built X for 300 users" })).b1.state).toBe("updated");
    expect(bulletFeedback(analysis([fb]), resume({ b1: "Built Y for 300 users" })).b1.state).toBe("stale");
  });

  it("leaves rejected suggestions out", () => {
    const out = bulletFeedback(analysis([fb], { dismissed: ["b1"] }), resume({ b1: "Did stuff" }));
    expect(out.b1).toMatchObject({ state: "current", suggestion: "" });
  });

  it("old analyses (no original): rating stays, but no suggestion once the text changed since page load", () => {
    const old = { bullet_id: "b1", rating: "ok" as const, note: "", rewrite: "Better wording" };
    const loaded = new Map([["b1", "Did stuff"]]);
    expect(bulletFeedback(analysis([old]), resume({ b1: "Did stuff" }), loaded).b1).toMatchObject({ state: "current", suggestion: "Better wording" });
    // Edited after load: Accept all must not overwrite it.
    expect(bulletFeedback(analysis([old]), resume({ b1: "My own edit" }), loaded).b1).toMatchObject({ state: "current", suggestion: "" });
    expect(bulletFeedback(analysis([old]), resume({ b1: "Better wording" }), loaded).b1.state).toBe("updated");
  });

  it("returns nothing without an analysis or resume", () => {
    expect(bulletFeedback(null, resume({ b1: "x" }))).toEqual({});
    expect(bulletFeedback(analysis([fb]), null)).toEqual({});
  });
});

describe("matchesRewrite", () => {
  it("matches exact text and filled placeholders only", () => {
    expect(matchesRewrite("Cut load time [X%]", "Cut load time [X%]")).toBe(true);
    expect(matchesRewrite("Cut load time 40%", "Cut load time [X%]")).toBe(true);
    expect(matchesRewrite("Cut load time", "Cut load time [X%]")).toBe(false);
    expect(matchesRewrite("anything", "")).toBe(false);
    expect(matchesRewrite("a.b", "a+b")).toBe(false);
  });
});

describe("placeholder fill", () => {
  it("finds placeholders loosely", () => {
    expect(findPlaceholder("Served [N  Users] daily", "[n users]")).toEqual({ start: 7, end: 17 });
    expect(findPlaceholder("Served [N users]", "N users")).not.toBeNull();
    expect(findPlaceholder("Served many", "[N users]")).toBeNull();
  });

  it("replaces the placeholder with the answer", () => {
    expect(fillPlaceholder("Served [N users] daily", "[N users]", " 300 users. ")).toBe("Served 300 users daily");
    expect(fillPlaceholder("Served [N users]", "[N users]", "  ")).toBeNull();
    expect(fillPlaceholder("Served many", "[N users]", "300")).toBeNull();
  });

  it("fills the current text first, else the pending suggestion (accepting it)", () => {
    expect(planFill("Cut [X%]", "Other [X%]", "[X%]", "40%")).toBe("Cut 40%");
    expect(planFill("Did stuff", "Cut load time [X%]", "[X%]", "40%")).toBe("Cut load time 40%");
    expect(planFill("Did stuff", "", "[X%]", "40%")).toBeNull();
  });

  it("suggests a value that keeps the placeholder's unit for bare numbers", () => {
    expect(suggestFill("[N users]", "300")).toBe("300 users");
    expect(suggestFill("[X hrs]", "~5.")).toBe("~5 hrs");
    expect(suggestFill("[X%]", "40%")).toBe("40%");
    expect(suggestFill("[N users]", "about 300 people")).toBe("about 300 people");
  });
});

describe("answer facts", () => {
  const qs = [
    { id: "q1", question: "How many users?", why: "" },
    { id: "q2", question: "Which tools?", why: "" },
  ];

  it("adds new answers and replaces edited ones", () => {
    expect(answerFactChanges(qs, { q1: "300" }, { q1: "350", q2: "Figma" })).toEqual({
      add: ["350 (re: How many users?)", "Figma (re: Which tools?)"],
      remove: ["300 (re: How many users?)"],
    });
    expect(answerFactChanges(qs, { q1: "300" }, { q1: " 300 " })).toEqual({ add: [], remove: [] });
    expect(answerFactChanges(qs, { q1: "300" }, { q1: "" })).toEqual({ add: [], remove: ["300 (re: How many users?)"] });
  });

  it("removes facts case/whitespace-insensitively", () => {
    expect(removeFacts(["300  (re: How many users?)", "Other"], ["300 (re: how many users?)"])).toEqual(["Other"]);
    expect(removeFacts(undefined, ["x"])).toEqual([]);
  });
});
