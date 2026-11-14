import { describe, expect, it } from "vitest";
import type { Fact, Resume } from "@/lib/types";
import {
  coachedFactPlan, coachRequest, exampleSegments, initialChoices, insertCoachedBullet, parseCoachRequest, priorityItems, resolveBlanks,
  validateExamples, validateQuestions, type CoachExample,
} from "@/lib/coaching";
import { factRow } from "@/lib/facts";
import { coachExamplesPrompt, coachQuestionsPrompt } from "@/lib/prompts";

const resume = (): Resume => ({
  version: 2,
  header: { name: "Ann", contact: "ann@school.edu" },
  sections: [
    {
      id: "s1",
      title: "Experience",
      items: [
        {
          id: "e1", title: "Learning Center", subtitle: "Math Tutor", location: "Boston, MA", dates: "2024 – Present",
          bullets: [{ id: "b1", text: "Tutored 30 students in calculus" }, { id: "b2", text: "Made study guides" }],
        },
        { id: "e2", title: "Robotics Club", subtitle: "Member", location: "", dates: "", bullets: [{ id: "b3", text: "" }] },
      ],
    },
  ],
});

const blank = (key: string, over: Record<string, unknown> = {}) => ({
  key, label: `${key} label`, hint: "Most students see a handful", example_value: "15", question: "Count a typical week", ...over,
});

describe("validateExamples: no stray numbers outside a blank", () => {
  const sources = ["Tutored 30 students in calculus", "Ran 4 review sessions before finals"];
  const facts = ["Ran 4 review sessions before finals"];

  it("keeps examples whose only numbers are blanks or the student's own, and drops any with a stray number", () => {
    const out = validateExamples(
      {
        examples: [
          { text: "Tutored {{b1}} students a week in calculus", blanks: [blank("b1")], why: "Shows reliability.", anatomy: [{ part: "verb", span: "Tutored" }] },
          { text: "Tutored 30 students and ran 4 review sessions, raising scores {{b1}}", blanks: [blank("b1")] },
          { text: "Tutored {{b1}} students, raising grades by 20%", blanks: [blank("b1")] }, // stray 20%
          { text: "Tutored a dozen students weekly", blanks: [] }, // stray number word
          { text: "Tutored {{b1}} students across {{b2}} courses", blanks: [blank("b1")] }, // b2 has no blank
          { text: "Tutored [N] students", blanks: [] }, // brackets instead of a blank
        ],
      },
      { sources, facts },
    );
    expect(out.map((e) => e.text)).toEqual([
      "Tutored {{b1}} students a week in calculus",
      "Tutored 30 students and ran 4 review sessions, raising scores {{b1}}",
    ]);
    expect(out[0]).toMatchObject({ id: "ex1_0", why: "Shows reliability.", anatomy: [{ part: "verb", span: "Tutored" }] });
  });

  it("at most 3 examples; blank tokens normalized; blanks without a token ignored", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ text: `Led {{ B1 }} sessions ${"abcde"[i]}`, blanks: [blank("b1"), blank("b9")] }));
    const out = validateExamples({ examples: many }, { sources: [], facts: [], round: 2 });
    expect(out).toHaveLength(3);
    expect(out[0].text).toBe("Led {{b1}} sessions a");
    expect(out[0].blanks.map((b) => b.key)).toEqual(["b1"]);
    expect(out[2].id).toBe("ex2_2");
  });

  it("a 'why' with a statistic is emptied, and anatomy spans must be in the text", () => {
    const [ex] = validateExamples(
      {
        examples: [
          {
            text: "Built study guides used by {{b1}} classmates",
            blanks: [blank("b1")],
            why: "Recruiters spend 6 seconds on a resume.",
            anatomy: [{ part: "verb", span: "Built" }, { part: "result", span: "raised grades" }, { part: "nonsense", span: "study" }],
          },
        ],
      },
      { sources: [], facts: [] },
    );
    expect(ex.why).toBe("");
    expect(ex.anatomy).toEqual([{ part: "verb", span: "Built" }]);
  });

  it("pre-fills a blank from a fact only when the fact really states that value", () => {
    const [ex] = validateExamples(
      {
        examples: [
          {
            text: "Ran {{b1}} review sessions for {{b2}} students",
            blanks: [
              blank("b1", { from_fact: "ran 4 review sessions before finals", fact_value: "4" }),
              blank("b2", { from_fact: "Ran 4 review sessions before finals", fact_value: "40" }),
            ],
          },
        ],
      },
      { sources, facts },
    );
    expect(ex.blanks[0].prefill).toEqual({ value: "4", fact: "Ran 4 review sessions before finals" });
    expect(ex.blanks[1].prefill).toBeUndefined();
    expect(initialChoices(ex.blanks)).toEqual({ b1: { kind: "fact" } });
  });

  it("junk replies give no examples", () => {
    expect(validateExamples(null, { sources: [], facts: [] })).toEqual([]);
    expect(validateExamples({ examples: "x" }, { sources: [], facts: [] })).toEqual([]);
  });
});

describe("resolveBlanks", () => {
  const ex: Pick<CoachExample, "text" | "blanks"> = {
    text: "Tutored {{b1}} students a week, raising quiz averages {{b2}}",
    blanks: [
      { key: "b1", label: "students per week", hint: "", example_value: "15", question: "" },
      { key: "b2", label: "quiz average change", hint: "", example_value: "by 10%", question: "", prefill: { value: "by 8%", fact: "Quiz averages rose by 8%" } },
    ],
  };

  it("nothing chosen: incomplete, blanks shown as [labels]", () => {
    expect(resolveBlanks(ex, {})).toEqual({
      text: "Tutored [students per week] students a week, raising quiz averages [quiz average change]",
      hasPlaceholders: true,
      complete: false,
      missing: ["b1", "b2"],
    });
  });

  it("example value + my own value", () => {
    expect(resolveBlanks(ex, { b1: { kind: "example" }, b2: { kind: "own", value: " by about 5% " } })).toEqual({
      text: "Tutored 15 students a week, raising quiz averages by about 5%", hasPlaceholders: false, complete: true, missing: [],
    });
  });

  it("my own value left empty counts as not chosen", () => {
    expect(resolveBlanks(ex, { b1: { kind: "own", value: "  " }, b2: { kind: "example" } })).toMatchObject({ complete: false, missing: ["b1"], hasPlaceholders: true });
  });

  it("leave as placeholder: complete, with placeholders", () => {
    expect(resolveBlanks(ex, { b1: { kind: "placeholder" }, b2: { kind: "placeholder" } })).toEqual({
      text: "Tutored [students per week] students a week, raising quiz averages [quiz average change]",
      hasPlaceholders: true,
      complete: true,
      missing: [],
    });
  });

  it("value from the student's facts, mixed with a placeholder", () => {
    expect(resolveBlanks(ex, { b1: { kind: "placeholder" }, b2: { kind: "fact" } })).toEqual({
      text: "Tutored [students per week] students a week, raising quiz averages by 8%", hasPlaceholders: true, complete: true, missing: [],
    });
  });

  it("every single-blank choice", () => {
    const one = { text: "Led {{b1}} sessions", blanks: [{ key: "b1", label: "sessions", hint: "", example_value: "12", question: "" }] };
    expect(resolveBlanks(one, { b1: { kind: "example" } }).text).toBe("Led 12 sessions");
    expect(resolveBlanks(one, { b1: { kind: "own", value: "9" } }).text).toBe("Led 9 sessions");
    expect(resolveBlanks(one, { b1: { kind: "placeholder" } }).text).toBe("Led [sessions] sessions");
    expect(resolveBlanks(one, { b1: { kind: "fact" } })).toMatchObject({ complete: false }); // no fact value for this blank
    expect(resolveBlanks({ ...one, blanks: [{ ...one.blanks[0], example_value: "" }] }, { b1: { kind: "example" } })).toMatchObject({ complete: false });
  });

  it("segments for display", () => {
    expect(exampleSegments("Led {{b1}} sessions")).toEqual([{ text: "Led " }, { blank: "b1" }, { text: " sessions" }]);
  });
});

describe("putting the bullet on the resume, and its fact", () => {
  it("add appends to the entry (or fills an empty last bullet); replace keeps the bullet's id", () => {
    const r = resume();
    const added = insertCoachedBullet(r, { sectionId: "s1", entryId: "e1" }, "Tutored 15 students a week", "add", "new1");
    expect(added.bulletId).toBe("new1");
    expect(added.resume.sections[0].items[0].bullets.map((b) => b.id)).toEqual(["b1", "b2", "new1"]);
    const filled = insertCoachedBullet(r, { sectionId: "s1", entryId: "e2" }, "Built a line-following robot", "add", "new2");
    expect(filled.resume.sections[0].items[1].bullets).toEqual([{ id: "new2", text: "Built a line-following robot" }]);
    const replaced = insertCoachedBullet(r, { sectionId: "s1", entryId: "e1", bulletId: "b2" }, "Wrote study guides for [N] classmates", "replace", "unused");
    expect(replaced.bulletId).toBe("b2");
    expect(replaced.resume.sections[0].items[0].bullets[1]).toEqual({ id: "b2", text: "Wrote study guides for [N] classmates" });
    expect(r.sections[0].items[0].bullets).toHaveLength(2); // input untouched
  });

  it("inserting creates a fact linked to the new bullet: active without placeholders, a draft with them", () => {
    const plan = coachedFactPlan([], { resumeId: "TAILORED", bulletId: "new1", entryId: "e1" }, "Tutored 15 students a week");
    expect(plan).toEqual({
      kind: "insert",
      fact: { text: "Tutored 15 students a week", source: "coaching", resume_id: "TAILORED", bullet_id: "new1", entry_id: "e1" },
    });
    if (plan.kind === "insert") expect(factRow(plan.fact).active).toBe(true);
    const draft = coachedFactPlan([], { resumeId: "M", bulletId: "b9", entryId: "e1" }, "Led [sessions] sessions");
    if (draft.kind === "insert") expect(factRow(draft.fact).active).toBe(false);
  });

  it("replacing a bullet that already has a fact updates that fact instead of adding a second one", () => {
    const existing: Fact = {
      id: "f1", text: "Made study guides", source: "resume", active: true, resume_id: "M", bullet_id: "b2", entry_id: "e1", created_at: "", updated_at: "",
    };
    expect(coachedFactPlan([existing], { resumeId: "M", bulletId: "b2", entryId: "e1" }, "Wrote guides for [N] classmates")).toEqual({
      kind: "update", id: "f1", patch: { text: "Wrote guides for [N] classmates", active: false },
    });
  });
});

describe("example text never reaches storage or prompts", () => {
  const examples = validateExamples(
    { examples: [{ text: "Coached {{b1}} peers through SECRET-EXAMPLE drills", blanks: [blank("b1", { example_value: "42" })] }] },
    { sources: [], facts: [] },
  );

  it("'More examples' sends the entry and a round number, never earlier examples", () => {
    expect(examples).toHaveLength(1);
    const body = coachRequest(resume(), { sectionId: "s1", entryId: "e1", bulletId: "b1" }, { jobId: "j1", resumeId: "R", round: 2 });
    expect(body).toEqual({
      jobId: "j1",
      resumeId: "R",
      entryId: "e1",
      entry: { title: "Learning Center", subtitle: "Math Tutor", location: "Boston, MA", dates: "2024 – Present" },
      bullets: [{ id: "b1", text: "Tutored 30 students in calculus" }, { id: "b2", text: "Made study guides" }],
      bulletId: "b1",
      round: 2,
    });
    expect(JSON.stringify(body)).not.toMatch(/SECRET-EXAMPLE|42/);
  });

  it("the server reads only known fields, so anything else in the body never gets into a prompt", () => {
    const parsed = parseCoachRequest({
      ...coachRequest(resume(), { sectionId: "s1", entryId: "e1" }),
      examples,
      exampleText: "SECRET-EXAMPLE",
      blanks: examples[0].blanks,
    })!;
    expect(Object.keys(parsed).sort()).toEqual(["bulletId", "bullets", "entry", "entryId", "jobId", "resumeId", "round"]);
    const ctx = { entry: "Learning Center", bullets: parsed.bullets.map((b) => b.text), bullet: "", facts: "", job: "" };
    for (const p of [coachExamplesPrompt({ ...ctx, round: 3 }), coachQuestionsPrompt(ctx)]) {
      expect(p).not.toMatch(/SECRET-EXAMPLE/);
      expect(p).toMatch(/Tutored 30 students in calculus/);
    }
  });

  it("only the resolved bullet becomes a fact (after the student chose every blank)", () => {
    const res = resolveBlanks(examples[0], { b1: { kind: "own", value: "6" } });
    const plan = coachedFactPlan([], { resumeId: "M", bulletId: "n", entryId: "e1" }, res.text);
    expect(plan.kind === "insert" && plan.fact.text).toBe("Coached 6 peers through SECRET-EXAMPLE drills");
    expect(JSON.stringify(plan)).not.toMatch(/\{\{b1\}\}|42/);
  });

  it("a selected bullet that no longer exists is dropped from the request", () => {
    expect(coachRequest(resume(), { sectionId: "s1", entryId: "e1", bulletId: "gone" })?.bulletId).toBeNull();
    expect(coachRequest(resume(), { sectionId: "s1", entryId: "nope" })).toBeNull();
    expect(parseCoachRequest({ entryId: "", bullets: [] })).toBeNull();
  });

  it("a job tab's prompts are angled to the posting; the master's aren't", () => {
    const base = { entry: "Learning Center", bullets: [], bullet: "", facts: "" };
    expect(coachExamplesPrompt({ ...base, job: "Data Analyst Intern at Acme", round: 1 })).toMatch(/use the posting's language and priorities[\s\S]*JOB POSTING:[\s\S]*Data Analyst Intern at Acme/);
    expect(coachExamplesPrompt({ ...base, job: "", round: 1 })).toMatch(/master resume \(no specific job\)/);
    expect(coachExamplesPrompt({ ...base, job: "", round: 1 })).not.toMatch(/JOB POSTING/);
  });
});

describe("questions and the priority list", () => {
  it("validateQuestions keeps up to 5 usable questions", () => {
    const qs = validateQuestions({ questions: [{ question: "How many?", why: "Scope", tip: "Estimate" }, { question: "" }, ...Array(6).fill({ question: "Q" })] });
    expect(qs).toHaveLength(5);
    expect(qs[0]).toEqual({ id: "cq0", question: "How many?", why: "Scope", tip: "Estimate" });
    expect(validateQuestions({})).toEqual([]);
  });

  it("priorityItems: weak first, then okay with a rewrite; strong and no-suggestion bullets left out", () => {
    const r = resume();
    r.sections[0].items[1].bullets = [{ id: "b3", text: "Built robots" }, { id: "b4", text: "Went to meetings" }];
    const fb = {
      b1: { state: "current", rating: "ok" as const, note: "Add scope", suggestion: "Tutored 30 calculus students" },
      b2: { state: "current", rating: "strong" as const, note: "", suggestion: "x" },
      b3: { state: "current", rating: "weak" as const, note: "Vague", suggestion: "Built [N] robots" },
      b4: { state: "stale", rating: "weak" as const, note: "", suggestion: "" },
    };
    expect(priorityItems(r, fb).map((p) => [p.bulletId, p.rating, p.entry])).toEqual([
      ["b3", "weak", "Robotics Club"],
      ["b1", "ok", "Learning Center"],
    ]);
  });
});
