import { describe, expect, it } from "vitest";
import { analyzePrompt, builderDraftPrompt, coachExamplesPrompt } from "@/lib/prompts";

const analysis = analyzePrompt({
  resume: "[b:b1] Built a sales dashboard in Excel",
  job: "Data Analyst Intern",
  facts: "",
  answers: "",
});

const coach = coachExamplesPrompt({
  entry: "Acme Corp | Data Analyst Intern | Boston, MA | Jun 2025 – Aug 2025",
  bullets: ["Built a sales dashboard in Excel"],
  bullet: "",
  facts: "",
  job: "",
  round: 1,
});

describe("analyzePrompt: resume review rubric", () => {
  it("includes the rubric after the number-honesty rules", () => {
    const rules = analysis.indexOf("Hard rules:");
    const rubric = analysis.indexOf("Resume review rubric");
    const shape = analysis.indexOf("Return ONLY JSON with exactly this shape");
    expect(rules).toBeGreaterThan(-1);
    expect(rubric).toBeGreaterThan(rules);
    expect(shape).toBeGreaterThan(rubric);
  });

  it("states that the number-honesty rules win", () => {
    expect(analysis).toContain("the number-honesty rules above win any conflict");
  });

  it("covers section order, with the leadership exception to the no-new-sections rule", () => {
    expect(analysis).toContain("Section order sends signals");
    expect(analysis).toContain("Technical Skills goes near the bottom");
    expect(analysis).toContain('"if you have any…"');
    expect(analysis).toContain('This is the ONE exception');
  });

  it("asks each bullet for a why: one sentence on what the rewrite changes, for this job", () => {
    expect(analysis).toContain('"why": "one sentence, at most 25 words, to the student');
    expect(analysis).toContain("why a recruiter for THIS job will care");
    expect(analysis).toContain("or empty string when rewrite is empty");
  });

  it("asks for XYZ rewrites and rates duties as weak", () => {
    expect(analysis).toContain("XYZ formula");
    expect(analysis).toContain("Accomplished X as measured by Y, by doing Z");
    expect(analysis).toContain('Rate a bullet "weak"');
  });

  it("covers specific-over-vague metrics", () => {
    expect(analysis).toContain("Vague metrics");
    expect(analysis).toContain("Specific, not fluffy");
  });

  it("the shared RULES line stays absolute; only the rubric carves out its one exception", () => {
    expect(analysis).toContain("Never suggest adding content or sections the resume doesn't have.");
    expect(analysis).toContain('the ONE exception\n  to the "never suggest adding content or sections" rule above');
    expect(builderDraftPrompt([], "")).not.toContain("review rubric");
  });

  it("tells the model never to mention bullet ids in text", () => {
    expect(analysis).toContain("Never mention bullet ids ([b:…] or b:…) in any text field");
  });

  it("keeps the exact JSON output block", () => {
    expect(analysis).toContain(`Return ONLY JSON with exactly this shape:
{
  "fit": "strong|possible|stretch",`);
  });
});

describe("coaching and builder prompts: BULLET_CRAFT", () => {
  it("coachExamplesPrompt includes BULLET_CRAFT", () => {
    expect(coach).toContain("BULLET CRAFT:");
    expect(coach).toContain("XYZ shape");
  });

  it("builderDraftPrompt includes BULLET_CRAFT", () => {
    const draft = builderDraftPrompt([{ id: "e1", type: "job", org: "Acme", role: "Intern", what: "Built dashboards" }], "");
    expect(draft).toContain("BULLET CRAFT:");
    expect(draft).toContain("Specific over vague");
  });
});
