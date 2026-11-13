import { describe, expect, it } from "vitest";
import { addFacts, countPlaceholders, hasPlaceholder } from "@/lib/facts";
import { pasteOnlySite } from "@/lib/jobsites";
import { fitFromScore, fitOf } from "@/lib/fit";
import { isTailored, snapshotPatch, tailoringStats } from "@/lib/outcomes";
import { emptyResume } from "@/lib/resume";
import type { Resume } from "@/lib/types";

const resume = (bullet: string, facts?: string[]): Resume => ({
  version: 2,
  header: { name: "Ada", contact: "ada@example.com" },
  sections: [
    {
      id: "s",
      title: "Experience",
      items: [{ id: "i", title: "Acme", subtitle: "Intern", location: "", dates: "2025", bullets: [{ id: "b", text: bullet }] }],
    },
  ],
  ...(facts ? { facts } : {}),
});

describe("addFacts", () => {
  it("appends new facts, skipping blanks and case/whitespace duplicates", () => {
    const r = addFacts({ ...emptyResume(), facts: ["Fluent in Spanish"] }, ["  fluent in  spanish ", "", "  ", "Eagle Scout", "eagle scout"]);
    expect(r.facts).toEqual(["Fluent in Spanish", "Eagle Scout"]);
  });

  it("returns the same object when nothing is new", () => {
    const r = { ...emptyResume(), facts: ["A"] };
    expect(addFacts(r, ["a", " "])).toBe(r);
  });

  it("creates the facts list when missing", () => {
    expect(addFacts(emptyResume(), ["Built a PC"]).facts).toEqual(["Built a PC"]);
  });
});

describe("placeholders", () => {
  it("counts bracketed placeholders across texts", () => {
    expect(countPlaceholders(["Cut cost by [X%] for [N users]", "no placeholders", "Saved [Y hrs]/week"])).toBe(3);
    expect(countPlaceholders([])).toBe(0);
    expect(hasPlaceholder("Led [N] people")).toBe(true);
    expect(hasPlaceholder("Led 4 people")).toBe(false);
  });
});

describe("pasteOnlySite", () => {
  it("names login-walled / JS-only job sites", () => {
    expect(pasteOnlySite("https://www.linkedin.com/jobs/view/123")).toBe("LinkedIn");
    expect(pasteOnlySite("https://linkedin.com/jobs/view/123")).toBe("LinkedIn");
    expect(pasteOnlySite("https://app.joinhandshake.com/jobs/1")).toBe("Handshake");
    expect(pasteOnlySite("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x")).toBe("Workday");
    expect(pasteOnlySite("  https://www.indeed.com/viewjob?jk=1 ")).toBe("Indeed");
    expect(pasteOnlySite("https://www.glassdoor.com/job-listing/x")).toBe("Glassdoor");
    expect(pasteOnlySite("https://wellfound.com/jobs/1")).toBe("Wellfound");
  });

  it("returns null for fetchable sites, lookalikes and bad input", () => {
    expect(pasteOnlySite("https://boards.greenhouse.io/acme/jobs/1")).toBeNull();
    expect(pasteOnlySite("https://jobs.lever.co/acme/abc")).toBeNull();
    expect(pasteOnlySite("https://notlinkedin.com/jobs")).toBeNull();
    expect(pasteOnlySite("https://linkedin.com.evil.example/jobs")).toBeNull();
    expect(pasteOnlySite("not a url")).toBeNull();
    expect(pasteOnlySite("")).toBeNull();
  });
});

describe("fit", () => {
  it("buckets scores and reads stored analyses", () => {
    expect([fitFromScore(75), fitFromScore(74), fitFromScore(50), fitFromScore(49)]).toEqual(["strong", "possible", "possible", "stretch"]);
    expect(fitOf({ fit: "stretch", fit_score: 99 })).toBe("stretch");
    expect(fitOf({ fit_score: 80 })).toBe("strong");
    expect(fitOf({})).toBeNull();
    expect(fitOf(null)).toBeNull();
  });
});

describe("outcomes", () => {
  it("isTailored compares printed content and ignores facts", () => {
    const m = resume("Built a dashboard", ["secret fact"]);
    expect(isTailored(resume("Built a dashboard"), m)).toBe(false);
    expect(isTailored(resume("Built a React dashboard"), m)).toBe(true);
    expect(isTailored(resume("Built a dashboard"), null)).toBe(false);
  });

  it("snapshotPatch freezes the sent resume without facts", () => {
    const sent = resume("Built a React dashboard", ["Never send this"]);
    const p = snapshotPatch(sent, resume("Built a dashboard"));
    expect(p.submitted_resume).not.toHaveProperty("facts");
    expect(p.submitted_resume.sections).toEqual(sent.sections);
    expect(p.submitted_tailored).toBe(true);
    expect(Number.isNaN(Date.parse(p.submitted_at))).toBe(false);
    expect(sent.facts).toEqual(["Never send this"]); // input untouched
  });

  it("tailoringStats counts interview rate by tailored vs untailored, only for submitted jobs", () => {
    const at = "2026-10-01T00:00:00Z";
    const stats = tailoringStats([
      { status: "interview", submitted_at: at, submitted_tailored: true },
      { status: "offer", submitted_at: at, submitted_tailored: true },
      { status: "rejected", submitted_at: at, submitted_tailored: true },
      { status: "applied", submitted_at: at, submitted_tailored: false },
      { status: "interview", submitted_at: at, submitted_tailored: null },
      { status: "interview", submitted_at: null, submitted_tailored: true },
    ]);
    expect(stats).toEqual({ tailored: { applied: 3, interviews: 2 }, untailored: { applied: 2, interviews: 1 } });
  });
});

import { shouldSnapshot } from "@/lib/outcomes";
import { describe as d2, it as i2, expect as e2 } from "vitest";
d2("shouldSnapshot", () => {
  i2("snapshots the first move into any submitted status", () => {
    e2(shouldSnapshot("applied", null)).toBe(true);
    e2(shouldSnapshot("interview", null)).toBe(true);
    e2(shouldSnapshot("rejected", undefined)).toBe(true);
  });
  i2("never re-snapshots or snapshots unsent statuses", () => {
    e2(shouldSnapshot("interview", "2026-11-01T00:00:00Z")).toBe(false);
    e2(shouldSnapshot("to_apply", null)).toBe(false);
    e2(shouldSnapshot("skipped", null)).toBe(false);
  });
});
