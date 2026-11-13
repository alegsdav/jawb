import { describe, expect, it } from "vitest";
import {
  answerFact, answerFactPlan, answerFacts, attachOriginals, bulletFeedback, fillPlaceholder, findPlaceholder, matchesRewrite,
  missingAnswerFacts, normalizeAnalysis, planFill, questionTopic, removeFacts, suggestFill,
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

  const has300 = ["Users: 300"];

  it("adds new answers and replaces edited ones (against the master's current facts)", () => {
    expect(answerFactPlan(qs, { q1: "300" }, { q1: "350", q2: "Figma" }, has300)).toEqual({
      add: ["Users: 350", "Tools: Figma"],
      remove: ["Users: 300"],
    });
    expect(answerFactPlan(qs, { q1: "300" }, { q1: " 300 " }, has300)).toEqual({ add: [], remove: [] });
    expect(answerFactPlan(qs, { q1: "300" }, { q1: "" }, has300)).toEqual({ add: [], remove: ["Users: 300"] });
  });

  it("repairs a fact that never reached the master, even when the answer itself is unchanged", () => {
    expect(answerFactPlan(qs, { q1: "300" }, { q1: "300" }, [])).toEqual({ add: ["Users: 300"], remove: [] });
    // The old wording's fact isn't there to remove.
    expect(answerFactPlan(qs, { q1: "300" }, { q1: "350" }, [])).toEqual({ add: ["Users: 350"], remove: [] });
  });

  it("keeps old-format facts as they are, and replaces one only when its answer changes", () => {
    const old = ["300 (re: How many users?)"];
    expect(answerFactPlan(qs, { q1: "300" }, { q1: "300" }, old)).toEqual({ add: [], remove: [] });
    expect(missingAnswerFacts(qs, { q1: "300" }, old)).toEqual([]);
    expect(answerFactPlan(qs, { q1: "300" }, { q1: "350" }, old)).toEqual({ add: ["Users: 350"], remove: ["300 (re: How many users?)"] });
  });

  it("removes facts case/whitespace-insensitively", () => {
    expect(removeFacts(["300  (re: How many users?)", "Other"], ["300 (re: how many users?)"])).toEqual(["Other"]);
    expect(removeFacts(undefined, ["x"])).toEqual([]);
  });

  it("condenses a general question to '<topic>: <answer>'", () => {
    expect(answerFact("By roughly what percent did the automation cut prep time?", "about 30%")).toBe("Automation cut prep time: about 30%");
    expect(answerFact("Have you used SQL in any class or project?", "Yes, in DS 3000")).toBe("Used SQL in any class or project: Yes, in DS 3000");
    expect(answerFact("How many researchers used the cleaned data?", "5")).toBe("Researchers used the cleaned data: 5");
    expect(answerFact("What tools did you use for your dashboard?", "Tableau")).toBe("Tools I use for my dashboard: Tableau");
    expect(answerFact("Why?", "Because")).toBe("Why: Because");
    expect(questionTopic("Did you lead anyone?")).toBe("Lead anyone");
  });

  describe("placeholder answers become the filled bullet sentence", () => {
    const bullets: Analysis["bullets"] = [
      {
        bullet_id: "b1",
        rating: "weak",
        note: "",
        original: "Cleaned lab survey data in Python",
        rewrite: "Automated survey cleaning in Python, cutting prep time by [X%] for [N researchers]",
      },
    ];
    const pq = [
      { id: "q1", question: "By roughly what percent did the automation cut prep time?", why: "", bullet_id: "b1", placeholder: "[X%]" },
      { id: "q2", question: "How many researchers used the cleaned data?", why: "", bullet_id: "b1", placeholder: "[N researchers]" },
      { id: "q3", question: "Have you used SQL?", why: "" },
    ];

    it("one sentence once every placeholder in the bullet is answered", () => {
      const f = answerFacts(pq, { q1: "about 30%", q2: "5", q3: "Yes" }, bullets);
      const sentence = "Automated survey cleaning in Python, cutting prep time by about 30% for 5 researchers";
      expect(Object.fromEntries(f)).toEqual({ q1: sentence, q2: sentence, q3: "Used SQL: Yes" });
      expect(answerFactPlan(pq, {}, { q1: "about 30%", q2: "5" }, [], bullets)).toEqual({ add: [sentence], remove: [] });
    });

    it("until then each answer is a '<topic>: <answer>' fact, replaced by the sentence later", () => {
      expect(answerFacts(pq, { q1: "about 30%" }, bullets).get("q1")).toBe("Automation cut prep time: about 30%");
      const plan = answerFactPlan(pq, { q1: "about 30%" }, { q1: "about 30%", q2: "5" }, ["Automation cut prep time: about 30%"], bullets);
      expect(plan).toEqual({
        add: ["Automated survey cleaning in Python, cutting prep time by about 30% for 5 researchers"],
        remove: ["Automation cut prep time: about 30%"],
      });
    });

    it("missingAnswerFacts matches exactly with bullets, and by the filled value without them", () => {
      const facts = ["Automated survey cleaning in Python, cutting prep time by about 30% for 5 researchers"];
      expect(missingAnswerFacts(pq, { q1: "about 30%", q2: "5" }, facts, bullets)).toEqual([]);
      expect(missingAnswerFacts(pq, { q1: "about 30%", q2: "5" }, facts)).toEqual([]);
      expect(missingAnswerFacts(pq, { q1: "about 40%", q2: "5" }, facts, bullets)).toEqual(["q1", "q2"]);
    });
  });
});
