import { describe, expect, it } from "vitest";
import { guardAnalysisNumbers, guardCoverLetter, guardNumbers, knownNumbers, normalizeAnalysis } from "@/lib/analysis";
import type { Analysis } from "@/lib/types";

// Everything a candidate might have on the master: a header, contact line, GPA, dates, a course code.
const contact = "Boston, MA • jordan@example.edu • (555) 010-2000 • github.com/jlee";
const gpaBullet = "GPA: 3.7/4.0; Dean's List";
const facts = ["Took DS 3000 (Foundations of Data Science) in Fall 2025", "Lab job ran Jan 2026 – Present"];

const g = (text: string, sources: string[]) => guardNumbers(text, sources).text;

describe("guardNumbers: numbers that slipped through before", () => {
  const sources = [contact, gpaBullet, ...facts, "Cleaned lab survey data in Python", "Trained new hires on the POS system"];

  it("a percentage never comes from a phone number", () => {
    expect(g("Cut prep time by 10%", sources)).toBe("Cut prep time by [X%]");
  });
  it("a multiplier never comes from a GPA", () => {
    expect(g("Sped up reporting 4x", sources)).toBe("Sped up reporting [N]x");
  });
  it("a count never comes from a phone number", () => {
    expect(g("Tutored 2000 students", sources)).toBe("Tutored [N] students");
  });
  it("a count never comes from a course code", () => {
    expect(g("Processed 3,000+ orders", sources)).toBe("Processed [N+] orders");
  });
  it("number words are checked too", () => {
    expect(g("Trained five new baristas", sources)).toBe("Trained [N] new baristas");
    expect(g("Saved a dozen hours a week", sources)).toBe("Saved [N] hours a week");
    expect(g("Reached hundreds of users", sources)).toBe("Reached [N] users");
    expect(g("Ran reports twice as fast", sources)).toBe("Ran reports [N]x as fast");
    expect(g("Doubled weekly sign-ups through campus outreach", sources)).toBe(
      "Grew weekly sign-ups [N]x through campus outreach",
    );
    expect(g("Cut prep time in half", sources)).toBe("Cut prep time by [X%]");
    expect(g("Halved prep time for the lab", sources)).toBe("Cut prep time by [X%] for the lab");
    expect(g("Led five of the teams", sources)).toBe("Led [N] of the teams");
    expect(g("Built a five-person team", sources)).toBe("Built a [N]-person team");
  });
});

describe("guardNumbers: units must match", () => {
  it("% needs a % source, $ a $ source, x an x source, K/M the same magnitude", () => {
    expect(g("Cut costs 30%", ["Cut costs for 30 clubs"])).toBe("Cut costs [X%]");
    expect(g("Served 30 clubs", ["Cut costs 30%"])).toBe("Served [N] clubs");
    expect(g("Raised $500", ["Recruited 500 members"])).toBe("Raised [$X]");
    expect(g("Recruited 500 members", ["Raised $500"])).toBe("Recruited [N] members");
    expect(g("Ran 3x faster", ["Ran 3 workshops"])).toBe("Ran [N]x faster");
    expect(g("Reached 10K users", ["Reached 10 schools"])).toBe("Reached [NK] users");
    expect(g("Reached 10K users", ["10,000 users"])).toBe("Reached 10K users");
    expect(g("Managed $2.5M", ["Managed a $2,500,000 budget"])).toBe("Managed $2.5M");
    expect(g("Managed $2.5M", ["Managed 2.5 million rows"])).toBe("Managed [$X]");
    expect(g("Cut costs by 15%", ["Cut costs by 15 percent"])).toBe("Cut costs by 15%");
    expect(g("Ran 3 times faster", ["3x faster"])).toBe("Ran 3 times faster");
  });

  it("number words match digits with the same meaning", () => {
    expect(g("Trained five new hires", ["Trained 5 new hires"])).toBe("Trained five new hires");
    expect(g("Trained 5 new hires", ["Trained five new hires"])).toBe("Trained 5 new hires");
    expect(g("Ran reports twice as fast", ["2x faster reports"])).toBe("Ran reports twice as fast");
    expect(g("Doubled sign-ups", ["Sign-ups doubled after outreach"])).toBe("Doubled sign-ups");
    expect(g("Saved a dozen hours", ["Saved 12 hours"])).toBe("Saved a dozen hours");
    expect(g("Cut prep time in half", ["Cut prep time by 50%"])).toBe("Cut prep time in half");
  });
});

describe("guardNumbers: false-positive guards", () => {
  it("leaves tool names, ordinals, 24/7, versions, dates and course codes alone", () => {
    const t = "Deployed on EC2 for a B2B tool with 24/7 uptime, 1st place, Python 3.11, since 2024, in DS 3000, Jan 2026";
    expect(guardNumbers(t, [])).toEqual({ text: t, placeholders: [] });
  });
  it("leaves existing [placeholders] alone and numbers new ones so each can be filled", () => {
    expect(guardNumbers("Served [N users] and cut costs [X%]", [])).toEqual({ text: "Served [N users] and cut costs [X%]", placeholders: [] });
    expect(guardNumbers("Led 4 people and 6 projects, cut 10% and 20%", [])).toEqual({
      text: "Led [N] people and [N2] projects, cut [X%] and [X2%]",
      placeholders: ["[N]", "[N2]", "[X%]", "[X2%]"],
    });
    expect(guardNumbers("Served [N] users and 40 clubs", []).text).toBe("Served [N] users and [N2] clubs");
  });
  it("keeps numbers genuinely in the sources", () => {
    expect(g("Presented findings to 3 faculty members", ["Presented findings to 3 faculty members"])).toBe(
      "Presented findings to 3 faculty members",
    );
    expect(g("Served 1,200+ users", ["Served 1200 users"])).toBe("Served 1,200+ users");
    expect(g("Saved $1,200 a month", ["Saved $1,200 a month (re: How much did it save?)"])).toBe("Saved $1,200 a month");
  });
  it("fixed terms with number words aren't claims", () => {
    const t = "Added two-factor login, double-checked reports, in the first half of the term";
    expect(g(t, [])).toBe(t);
  });
  it("a GPA is kept only when the sources give it", () => {
    expect(g("GPA: 3.7/4.0, Dean's List", [gpaBullet])).toBe("GPA: 3.7/4.0, Dean's List");
    expect(g("GPA: 3.9/4.0, Dean's List", [gpaBullet])).toBe("GPA: [GPA]/4.0, Dean's List");
  });
  it("dates, phone numbers and course codes never count as sources", () => {
    const k = knownNumbers([contact, ...facts, gpaBullet]);
    expect([...k.keys]).toEqual([]);
  });
});

describe("guardAnalysisNumbers: per-bullet sources", () => {
  const base = normalizeAnalysis({});
  const analysis = (rewrite: string, original = "Cleaned lab survey data in Python"): Analysis => ({
    ...base,
    bullets: [
      { bullet_id: "b1", rating: "weak", note: "", rewrite, original },
      { bullet_id: "b2", rating: "strong", note: "", rewrite: "", original: "Presented findings to 3 faculty members" },
    ],
  });

  it("numbers from other bullets don't count; the bullet's own, facts and answers do", () => {
    const a = guardAnalysisNumbers(analysis("Cleaned survey data for 3 researchers, cutting prep 30%"), []);
    expect(a.bullets[0].rewrite).toBe("Cleaned survey data for [N] researchers, cutting prep [X%]");
    const ok = guardAnalysisNumbers(analysis("Cleaned data for 40 surveys, cutting prep 30%", "Cleaned 40 surveys"), ["about 30%"]);
    expect(ok.bullets[0].rewrite).toBe("Cleaned data for 40 surveys, cutting prep 30%");
    expect(ok.questions).toEqual([]);
  });

  it("falls back to the given bullet texts when an analysis has no originals", () => {
    const a = { ...analysis("Cleaned 40 surveys"), bullets: [{ bullet_id: "b1", rating: "weak" as const, note: "", rewrite: "Cleaned 40 surveys" }] };
    expect(guardAnalysisNumbers(a, [], new Map([["b1", "Cleaned 40 surveys"]])).bullets[0].rewrite).toBe("Cleaned 40 surveys");
    expect(guardAnalysisNumbers(a, []).bullets[0].rewrite).toBe("Cleaned [N] surveys");
  });

  it("asks one question per placeholder, with bullet_id and the bracketed placeholder", () => {
    const a = guardAnalysisNumbers(analysis("Sped up reporting 4x for five researchers, cutting 10%"), [gpaBullet, contact]);
    expect(a.bullets[0].rewrite).toBe("Sped up reporting [N]x for [N2] researchers, cutting [X%]");
    expect(a.questions.map((q) => [q.bullet_id, q.placeholder])).toEqual([
      ["b1", "[N]"],
      ["b1", "[N2]"],
      ["b1", "[X%]"],
    ]);
    expect(a.questions[0].question).toContain("[N]");
  });
});

describe("guardCoverLetter", () => {
  const posting = "Data Analyst Intern. Work with 12 analysts across 3 offices.";
  const candidate = ["Built a dashboard used by 300 students"];

  it("posting numbers never back a claim about the candidate", () => {
    expect(guardCoverLetter("In the lab I led 12 projects.", { candidate, posting })).toBe("In the lab I led [N] projects.");
  });
  it("posting numbers stay where the letter restates the posting", () => {
    expect(guardCoverLetter("Your team of 12 analysts across 3 offices stood out.", { candidate, posting })).toBe(
      "Your team of 12 analysts across 3 offices stood out.",
    );
  });
  it("keeps candidate numbers, the layout and unique placeholders across sentences", () => {
    const letter = "Dear [Hiring Manager],\n\nI built a dashboard for 300 students. I cut costs 20%.\nWe grew it 5x.\n\nThanks,\nJordan";
    expect(guardCoverLetter(letter, { candidate, posting })).toBe(
      "Dear [Hiring Manager],\n\nI built a dashboard for 300 students. I cut costs [X%].\nWe grew it [N]x.\n\nThanks,\nJordan",
    );
    expect(guardCoverLetter("I led 4 teams. I ran 6 events.", { candidate, posting })).toBe("I led [N] teams. I ran [N2] events.");
  });
});
