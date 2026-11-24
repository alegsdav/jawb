import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CoachPanel } from "@/components/CoachPanel";
import { JobOverview, type OverviewProps } from "@/components/job/JobOverview";
import type { Resume } from "@/lib/types";
import type { FactsApi } from "@/lib/useFacts";

const resume = {
  sections: [
    {
      items: [
        {
          id: "e1",
          title: "Brightline Labs",
          subtitle: "Software Engineering Intern",
          bullets: [{ id: "b1", text: "Built the reporting pipeline" }],
        },
      ],
    },
  ],
} as unknown as Resume;

const facts = {} as unknown as FactsApi;

function panel(extra: Partial<Parameters<typeof CoachPanel>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(CoachPanel, {
      resume,
      resumeId: "r1",
      target: { entryId: "e1", bulletId: "b1" },
      facts,
      onInsert: () => null,
      ...extra,
    } as Parameters<typeof CoachPanel>[0]),
  );
}

describe("CoachPanel choose stage", () => {
  it("shows just the two choices, without the bullet, entry title, back button or the old copy", () => {
    const html = panel();
    expect(html).toContain("Examples");
    expect(html).toContain("Question me");
    expect(html).not.toContain("Show me examples");
    expect(html).not.toContain("Ask me questions first");
    expect(html).not.toContain("Coaching");
    expect(html).not.toContain("← Back");
    expect(html).not.toContain("Nothing goes on your resume");
    expect(html).not.toContain("Built the reporting pipeline");
    expect(html).not.toContain("Brightline Labs");
  });

  it("lays the two choices side by side with equal width and the bordered style", () => {
    const html = panel();
    expect(html).toContain('class="flex transition-[gap] duration-300 ease-out gap-2"');
    expect(html.match(/grow basis-0 border-border px-3 py-2\.5 text-\[14px\] text-fg hover:bg-surface-2/g)?.length).toBe(2);
  });

  it("opens already zoomed on the questions for startWith, with no status line before the effect runs", () => {
    const html = panel({ startWith: "questions" });
    expect(html).toContain("grow basis-0 border-transparent px-0 py-2.5 text-[17px] font-medium text-fg");
    expect(html).toContain("grow-0 basis-0 border-transparent px-0 py-2.5 text-[14px] opacity-0 invisible");
    expect(html).not.toContain("ai-shimmer");
  });
});

describe("JobOverview bullet area and pills", () => {
  const base = {
    job: { id: "j1", title: "Engineer", company: "Acme", location: "Remote", description: "", status: "draft", deadline: null, follow_up_date: null, url: null },
    quiet: false,
    applied: false,
    analysis: null,
    analyzing: false,
    analyzeError: "",
    notices: null,
    statusControl: null,
    onPatch: () => {},
    onDelete: () => {},
    onAnalyze: () => {},
    onOpenPosting: () => {},
    commentSheet: false,
    onCommentSlot: () => {},
    bulletAreaRef: () => {},
    questions: null,
    coach: null,
  } as unknown as OverviewProps;

  it("uses the shimmer, not the pulse, while analysing", () => {
    const html = renderToStaticMarkup(createElement(JobOverview, { ...base, analyzing: true }));
    expect(html).toContain('class="ai-shimmer text-[13px]"');
    expect(html).toContain("Reading the posting against your resume…");
    expect(html).not.toContain("animate-pulse");
  });

  it("draws keyword pills as slightly rounded rectangles with no border", () => {
    const analysis = {
      analyzed_at: "2026-11-01T00:00:00Z",
      verdict: "",
      questions: [],
      answers: {},
      keywords: { missing: ["Kafka"], matched: ["SQL"] },
      fit: "possible",
    };
    const html = renderToStaticMarkup(createElement(JobOverview, { ...base, analysis: analysis as unknown as OverviewProps["analysis"] }));
    expect(html).toContain("rounded-[4px] px-2 py-0.5 text-[13px] text-fg bg-bad/[0.07]");
    expect(html).toContain("rounded-[4px] px-2 py-0.5 text-[13px] text-fg bg-good/[0.07]");
    expect(html).not.toContain("border-bad/30");
    expect(html).not.toContain("border-good/30");
    expect(html).not.toContain("rounded-full");
  });
});

describe("globals.css shimmer", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  it("defines the shimmer from the theme's real variables, with reduced motion turned off", () => {
    expect(css).toContain("background: linear-gradient(90deg, var(--muted) 0%, var(--fg) 50%, var(--muted) 100%);");
    expect(css).toContain("animation: ai-shimmer 1.4s linear infinite;");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.ai-shimmer \{[^}]*animation: none;/);
  });
});
