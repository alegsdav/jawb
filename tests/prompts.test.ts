import { describe, expect, it } from "vitest";
import { analyzePrompt, builderDraftPrompt, coachExamplesPrompt, coachQuestionsPrompt, coverLetterPrompt, extractFactsPrompt, masterReviewPrompt } from "@/lib/prompts";

const TRANSITION = "The job posting, the candidate's resume, their facts and their answers follow.";

/** Everything before the variable sections: the fixed text that implicit caching can share. */
function fixedPrefix(prompt: string) {
  const at = prompt.indexOf(TRANSITION);
  expect(at).toBeGreaterThan(-1);
  return prompt.slice(0, at);
}

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

describe("analyzePrompt: caching-friendly section order", () => {
  const other = analyzePrompt({
    resume: "[b:b9] Tutored 12 students in calculus",
    job: "Software Engineering Intern at a different company",
    facts: "- Tutored 12 students in calculus",
    answers: "Tutored them every Tuesday",
  });

  it("puts the fixed text first and the transition line before the variable sections", () => {
    const shape = analysis.indexOf("Return ONLY JSON with exactly this shape");
    const transition = analysis.indexOf(TRANSITION);
    expect(transition).toBeGreaterThan(shape);
    expect(analysis.indexOf("JOB POSTING:")).toBeGreaterThan(transition);
  });

  it("orders the variable sections: posting, then resume, then facts, then answers", () => {
    const job = analysis.indexOf("JOB POSTING:");
    const resume = analysis.indexOf("CANDIDATE RESUME");
    const facts = analysis.indexOf("CANDIDATE FACTS (true");
    const answers = analysis.indexOf("CANDIDATE'S ANSWERS TO YOUR EARLIER QUESTIONS");
    expect(job).toBeGreaterThan(-1);
    expect(resume).toBeGreaterThan(job);
    expect(facts).toBeGreaterThan(resume);
    expect(answers).toBeGreaterThan(facts);
  });

  it("has an identical fixed prefix for different job, resume, facts and answers", () => {
    expect(fixedPrefix(analysis)).toBe(fixedPrefix(other));
  });

  it("keeps candidate and posting data out of the fixed prefix", () => {
    const prefix = fixedPrefix(analysis);
    expect(prefix).not.toContain("Built a sales dashboard in Excel");
    expect(prefix).not.toContain("Data Analyst Intern");
    expect(fixedPrefix(other)).not.toContain("Tutored 12 students");
    expect(fixedPrefix(other)).not.toContain("Software Engineering Intern");
  });

  it("refers to the variable sections as below, not above", () => {
    expect(analysis).toContain("the facts and answers below");
    expect(analysis).toContain("the candidate's answers below already cover");
    expect(analysis).not.toContain("and answers above");
    expect(analysis).not.toContain("earlier answers already cover");
  });
});

describe("coverLetterPrompt: caching-friendly section order", () => {
  const args = { resume: "[b:b1] Built a sales dashboard in Excel", job: "Data Analyst Intern", facts: "", answers: "" };
  const other = coverLetterPrompt({
    resume: "Tutored 12 students in calculus",
    job: "Software Engineering Intern at a different company",
    facts: "- Shipped a mobile app",
    answers: "Answered questions in class",
  });
  const letter = coverLetterPrompt(args);

  it("puts the fixed instructions first and the transition line before the job", () => {
    const transition = letter.indexOf(TRANSITION);
    expect(transition).toBeGreaterThan(letter.indexOf("Write a concise cover letter"));
    expect(letter.indexOf("JOB:")).toBeGreaterThan(transition);
  });

  it("orders the variable sections: job, resume, facts, answers", () => {
    const job = letter.indexOf("JOB:");
    const resume = letter.indexOf("RESUME:");
    const facts = letter.indexOf("EXTRA TRUE FACTS");
    const answers = letter.indexOf("CANDIDATE'S ANSWERS TO EARLIER QUESTIONS");
    expect(resume).toBeGreaterThan(job);
    expect(facts).toBeGreaterThan(resume);
    expect(answers).toBeGreaterThan(facts);
  });

  it("has an identical fixed prefix for different job, resume, facts and answers", () => {
    expect(fixedPrefix(letter)).toBe(fixedPrefix(other));
  });

  it("keeps candidate and posting data out of the fixed prefix", () => {
    expect(fixedPrefix(letter)).not.toContain("Built a sales dashboard in Excel");
    expect(fixedPrefix(letter)).not.toContain("Data Analyst Intern");
    expect(fixedPrefix(other)).not.toContain("Shipped a mobile app");
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

/** Everything before the transition line is the fixed prefix; everything after it is student data. */
function splitAtTransition(p: string) {
  const i = p.indexOf("The student's details follow.");
  expect(i).toBeGreaterThan(0);
  return { fixed: p.slice(0, i), data: p.slice(i) };
}

describe("coaching, facts and builder prompts: caching-friendly layout", () => {
  const coachA = {
    entry: "ALPHA-ENTRY Learning Center | Tutor",
    bullets: ["ALPHA-BULLET Tutored 30 students"],
    bullet: "",
    facts: "- ALPHA-FACT tutored calculus",
    job: "Data Analyst Intern at Acme",
    round: 1,
  };
  const coachB = {
    entry: "BETA-ENTRY Lab Assistant",
    bullets: ["BETA-BULLET Ran lab"],
    bullet: "BETA-BULLET Ran lab",
    facts: "- BETA-FACT ran weekly labs",
    job: "Data Analyst Intern at Acme",
    round: 3,
  };
  const STUDENT_MARKERS = ["ALPHA-", "BETA-"];

  it("coachExamplesPrompt: the fixed prefix is identical across calls and holds no student data", () => {
    const a = splitAtTransition(coachExamplesPrompt(coachA));
    const b = splitAtTransition(coachExamplesPrompt(coachB));
    expect(a.fixed).toBe(b.fixed);
    for (const m of STUDENT_MARKERS) expect(a.fixed).not.toContain(m);
    expect(a.data).toContain("ALPHA-ENTRY");
    expect(b.data).toContain("BETA-ENTRY");
  });

  it("coachExamplesPrompt: the job posting and round sit in the variable section, in that order", () => {
    const p = coachExamplesPrompt(coachB);
    const { fixed, data } = splitAtTransition(p);
    expect(fixed).not.toContain("Data Analyst Intern at Acme");
    expect(fixed).not.toMatch(/ROUND: \d/);
    expect(data.indexOf("JOB POSTING:")).toBeLessThan(data.indexOf("RESUME ENTRY:"));
    expect(data.indexOf("RESUME ENTRY:")).toBeLessThan(data.indexOf("SELECTED BULLET"));
    expect(data.trimEnd().endsWith("ROUND: 3")).toBe(true);
  });

  it("coachQuestionsPrompt: the fixed prefix is identical across calls and holds no student data", () => {
    const a = splitAtTransition(coachQuestionsPrompt(coachA));
    const b = splitAtTransition(coachQuestionsPrompt(coachB));
    expect(a.fixed).toBe(b.fixed);
    for (const m of STUDENT_MARKERS) expect(a.fixed).not.toContain(m);
    expect(a.data).toContain("ALPHA-FACT");
    expect(b.data).toContain("BETA-FACT");
  });

  it("extractFactsPrompt: the fixed prefix is identical across answers and holds no student data", () => {
    const a = splitAtTransition(extractFactsPrompt({ answer: "ALPHA-ANSWER tutored 20 students", question: "ALPHA-Q?", context: "ALPHA-CTX" }));
    const b = splitAtTransition(extractFactsPrompt({ answer: "BETA-ANSWER ran labs", question: "BETA-Q?", context: "BETA-CTX" }));
    expect(a.fixed).toBe(b.fixed);
    for (const m of STUDENT_MARKERS) expect(a.fixed).not.toContain(m);
    expect(a.data.indexOf("ALPHA-CTX")).toBeLessThan(a.data.indexOf("ALPHA-Q?"));
    expect(a.data.indexOf("ALPHA-Q?")).toBeLessThan(a.data.indexOf("ALPHA-ANSWER"));
  });

  it("builderDraftPrompt: the fixed prefix is identical across majors and experiences, and the major is data", () => {
    const exp = [{ id: "e1", type: "job", org: "Acme", role: "Intern", what: "Built dashboards" }];
    const a = splitAtTransition(builderDraftPrompt(exp, "Economics"));
    const b = splitAtTransition(builderDraftPrompt([{ ...exp[0], org: "Beta Co" }], "Biology"));
    expect(a.fixed).toBe(b.fixed);
    expect(a.fixed).not.toContain("Economics");
    expect(a.data).toContain("MAJOR: Economics");
    expect(a.data.indexOf("MAJOR:")).toBeLessThan(a.data.indexOf("EXPERIENCES (JSON):"));
    expect(a.fixed).toContain('Return ONLY JSON: { "bullets"');
  });
});

describe("masterReviewPrompt: one review of the master resume, no job", () => {
  const MASTER_TRANSITION = "The candidate's resume, their facts and their answers follow. Review them as shown.";
  const masterPrefix = (p: string) => {
    const at = p.indexOf(MASTER_TRANSITION);
    expect(at).toBeGreaterThan(-1);
    return p.slice(0, at);
  };
  const a = masterReviewPrompt({ resume: "[b:b1] Built a sales dashboard in Excel", facts: "- Saved $1,200", answers: "Q: How many?\nA: 300" });
  const b = masterReviewPrompt({ resume: "[b:z9] Tutored calculus", facts: "", answers: "" });

  it("keeps every fixed instruction before the candidate's data, identical across inputs (for caching)", () => {
    expect(masterPrefix(a)).toBe(masterPrefix(b));
    expect(masterPrefix(a)).not.toContain("Built a sales dashboard");
    expect(masterPrefix(a)).not.toContain("Saved $1,200");
    expect(masterPrefix(a)).not.toContain("Tutored calculus");
  });

  it("puts the variable sections in order: resume, then facts, then answers", () => {
    const resume = a.indexOf("CANDIDATE RESUME (bullets are tagged [b:ID]):");
    const facts = a.indexOf("CANDIDATE FACTS (true, from their master resume");
    const answers = a.indexOf("CANDIDATE'S ANSWERS TO YOUR EARLIER QUESTIONS");
    expect(resume).toBeGreaterThan(masterPrefix(a).length);
    expect(facts).toBeGreaterThan(resume);
    expect(answers).toBeGreaterThan(facts);
    expect(a).toContain("[b:b1] Built a sales dashboard in Excel");
    expect(a).toContain("Q: How many?\nA: 300");
  });

  it("uses the shared number-honesty rules and the master rubric, with no job posting requirement", () => {
    const fixed = masterPrefix(a);
    expect(fixed).toContain("Hard rules:");
    expect(fixed).toContain("Master resume review rubric");
    expect(fixed).toContain("XYZ");
    expect(fixed).not.toContain("Resume review rubric (apply it on top of the job match");
    expect(fixed).not.toMatch(/JOB POSTING/);
    expect(a).not.toMatch(/JOB POSTING/);
    expect(fixed).toContain("not a match to one job");
  });

  it("asks for the MasterAnalysis shape: verdict, weakest, strengths, gaps, bullets, questions", () => {
    for (const key of ['"verdict"', '"weakest"', '"strengths"', '"gaps"', '"bullets"', '"questions"', '"bullet_id"', '"placeholder"']) {
      expect(a).toContain(key);
    }
    expect(a).toContain("Rate EVERY resume bullet");
    expect(a).toContain("up to 5 bullet ids, weakest first, judged on substance");
    expect(a).toContain("Ask 2-6 questions");
    expect(a).toContain("Never mention bullet ids");
  });

  it("keeps the 'if you have any' leadership gap as the one exception", () => {
    expect(masterPrefix(a)).toContain('"if you have any…"');
  });
});
