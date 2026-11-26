import { describe, expect, it } from "vitest";
import { keywordInText, liveKeywords, meaningMatches } from "@/lib/keywords";

describe("keywordInText", () => {
  it("ignores case", () => {
    expect(keywordInText("python", "Expert in PYTHON and SQL")).toBe(true);
    expect(keywordInText("SQL", "expert in sql")).toBe(true);
  });

  it("treats whitespace and hyphens alike between the words of a multi-word keyword", () => {
    expect(keywordInText("machine learning", "Built Machine-Learning pipelines")).toBe(true);
    expect(keywordInText("machine learning", "Built machine  learning pipelines")).toBe(true);
    expect(keywordInText("machine-learning", "Built machine learning pipelines")).toBe(true);
    expect(keywordInText("machine learning", "Built machinelearning pipelines")).toBe(false);
  });

  it("does not match a word inside a longer word", () => {
    expect(keywordInText("Java", "Wrote JavaScript services")).toBe(false);
    expect(keywordInText("Go", "Worked at Google")).toBe(false);
    expect(keywordInText("Go", "Wrote services in Go.")).toBe(true);
  });

  it("treats + and # as part of a token", () => {
    expect(keywordInText("C", "Shipped C++ firmware")).toBe(false);
    expect(keywordInText("C", "Shipped C# services")).toBe(false);
    expect(keywordInText("C++", "Shipped C++, Rust and Go")).toBe(true);
    expect(keywordInText("C++", "Shipped (C++) firmware")).toBe(true);
    expect(keywordInText("C#", "Shipped C# services")).toBe(true);
  });

  it("keeps dots that are part of a name (Node.js, .NET)", () => {
    expect(keywordInText("Node.js", "Built APIs in Node.js")).toBe(true);
    expect(keywordInText("Node.js", "Built APIs in Node.js.")).toBe(true);
    expect(keywordInText("Node", "Built APIs in Node.js")).toBe(false);
    expect(keywordInText(".NET", "Shipped .NET services")).toBe(true);
    expect(keywordInText(".NET", "Shipped ASP.NET services")).toBe(false);
    expect(keywordInText("NET", "Shipped ASP.NET services")).toBe(false);
  });

  it("matches a word followed by a sentence period", () => {
    expect(keywordInText("Python", "Fluent in Python.")).toBe(true);
    expect(keywordInText("Python", "Fluent in Python. Also SQL.")).toBe(true);
  });

  it("allows a simple plural", () => {
    expect(keywordInText("API", "Designed three APIs")).toBe(true);
    expect(keywordInText("dashboard", "Built dashboards for sales")).toBe(true);
    expect(keywordInText("class", "Taught classes")).toBe(true);
    expect(keywordInText("API", "Designed the APIS team")).toBe(true);
  });

  it("escapes regex special characters in keywords", () => {
    expect(keywordInText("a.b", "axb")).toBe(false);
    expect(keywordInText("a.b", "a.b")).toBe(true);
    expect(keywordInText("(CI/CD)", "ran (CI/CD) pipelines")).toBe(true);
    expect(keywordInText("c++*", "c++*")).toBe(true);
    expect(keywordInText("what?", "what")).toBe(false);
  });

  it("returns false for an empty keyword or an empty text", () => {
    expect(keywordInText("", "anything")).toBe(false);
    expect(keywordInText("   ", "anything")).toBe(false);
    expect(keywordInText("Python", "")).toBe(false);
  });
});

describe("meaningMatches", () => {
  it("keeps only the AI-matched keywords the literal scan does not find", () => {
    const found = meaningMatches(["Python", "Data analysis"], "Fluent in Python. Analyzed datasets.");
    expect([...found]).toEqual(["Data analysis"]);
  });
});

describe("liveKeywords", () => {
  const keywords = { missing: ["C++", "Kubernetes"], matched: ["Python", "SQL"] };

  it("colours each keyword from the live scan", () => {
    const out = liveKeywords(keywords, "Python, SQL, and C++ for firmware.", new Set());
    expect(out.map((k) => [k.keyword, k.found])).toEqual([
      ["C++", true],
      ["Kubernetes", false],
      ["Python", true],
      ["SQL", true],
    ]);
  });

  it("flips a keyword when the resume gains or loses the word", () => {
    const before = liveKeywords(keywords, "Python and SQL", new Set());
    expect(before.find((k) => k.keyword === "C++")?.found).toBe(false);
    const after = liveKeywords(keywords, "Python, SQL, C++", new Set());
    expect(after.find((k) => k.keyword === "C++")?.found).toBe(true);
    const removed = liveKeywords(keywords, "Python", new Set());
    expect(removed.find((k) => k.keyword === "SQL")?.found).toBe(false);
  });

  it("keeps the analysis order (missing first, then matched) whatever the colours are", () => {
    const a = liveKeywords(keywords, "", new Set());
    const b = liveKeywords(keywords, "C++ Kubernetes Python SQL", new Set());
    expect(a.map((k) => k.keyword)).toEqual(["C++", "Kubernetes", "Python", "SQL"]);
    expect(b.map((k) => k.keyword)).toEqual(a.map((k) => k.keyword));
    expect(a.map((k) => k.group)).toEqual(["missing", "missing", "matched", "matched"]);
  });

  it("keeps alwaysMatched keywords green even when the text does not contain them", () => {
    const out = liveKeywords({ missing: [], matched: ["Data analysis", "SQL"] }, "Analyzed datasets", new Set(["Data analysis"]));
    expect(out.map((k) => [k.keyword, k.found])).toEqual([
      ["Data analysis", true],
      ["SQL", false],
    ]);
  });

  it("follows the live scan for keywords not in alwaysMatched", () => {
    const out = liveKeywords({ missing: ["Rust"], matched: [] }, "Rust", new Set(["Other"]));
    expect(out[0].found).toBe(true);
    const gone = liveKeywords({ missing: [], matched: ["Rust"] }, "", new Set(["Other"]));
    expect(gone[0].found).toBe(false);
  });

  it("works from an alwaysMatched set built at analysis time", () => {
    const analysisMatched = ["Data analysis", "Python"];
    // At analysis time the resume says "Python" literally but only "analyzed datasets" for data analysis.
    const always = meaningMatches(analysisMatched, "Python. Analyzed datasets.");
    expect([...always]).toEqual(["Data analysis"]);
    // Later the user removes "Python": it follows the scan and turns red; "Data analysis" stays green.
    const later = liveKeywords({ missing: [], matched: analysisMatched }, "Analyzed datasets.", always);
    expect(later.map((k) => k.found)).toEqual([true, false]);
  });
});
