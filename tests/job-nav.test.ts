import { describe, expect, it } from "vitest";
import { navJob, recentJobs, searchJobs } from "@/lib/jobNav";

const row = (id: string, title: string, company: string, updated_at: string, extra: Record<string, unknown> = {}) =>
  navJob({ id, title, company, location: "Boston, MA", status: "to_apply", updated_at, ...extra });

describe("sidebar jobs", () => {
  const jobs = Array.from({ length: 10 }, (_, i) => row(`j${i}`, `Role ${i}`, i % 2 ? "Acme" : "Globex", `2026-11-${String(i + 1).padStart(2, "0")}`));

  it("reads the fit from the analysis JSON (and old 0-100 scores)", () => {
    expect(row("a", "", "", "", { fit: "strong" }).fit).toBe("strong");
    expect(row("a", "", "", "", { fit_score: 55 }).fit).toBe("possible");
    expect(row("a", "", "", "").fit).toBeNull();
  });

  it("recent jobs: the last 8 by updated_at", () => {
    expect(recentJobs(jobs).map((j) => j.id)).toEqual(["j9", "j8", "j7", "j6", "j5", "j4", "j3", "j2"]);
  });

  it("search matches every word across title, company and location", () => {
    expect(searchJobs(jobs, "acme role 3").map((j) => j.id)).toEqual(["j3"]);
    expect(searchJobs(jobs, "GLOBEX").length).toBe(5);
    expect(searchJobs(jobs, "boston acme").length).toBe(5);
    expect(searchJobs(jobs, "  ")).toEqual([]);
  });
});
