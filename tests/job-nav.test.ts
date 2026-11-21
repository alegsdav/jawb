import { describe, expect, it } from "vitest";
import {
  MAX_VISITS, navJob, readPins, readVisits, recentJobs, recordVisit, searchJobs, sidebarJobs, withPin, withVisit, withoutPin, withoutVisit,
} from "@/lib/jobNav";

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

  it("a visit counts as recent activity, so an opened job moves up", () => {
    // j0 was last saved on the 1st, but was opened after everything else was saved.
    const visits = { j0: "2026-11-30T12:00:00.000Z" };
    expect(recentJobs(jobs, 8, visits).map((j) => j.id)[0]).toBe("j0");
    // An older visit does not push a job below its own save time.
    expect(recentJobs(jobs, 8, { j9: "2026-11-01T00:00:00.000Z" }).map((j) => j.id)[0]).toBe("j9");
    expect(recentJobs(jobs, 8, { j1: "2026-11-02T00:00:00.000Z" }).map((j) => j.id)).not.toContain("j1");
  });

  it("search orders by the same visit-aware recency", () => {
    const visits = { j2: "2026-11-30T00:00:00.000Z" };
    expect(searchJobs(jobs, "globex", 20, visits).map((j) => j.id)[0]).toBe("j2");
  });

  it("pins are excluded from recent, pinned in pin order (newest first)", () => {
    const pins = withPin(withPin([], "j1"), "j0");
    expect(pins).toEqual(["j0", "j1"]);
    const { pinned, recent } = sidebarJobs(jobs, pins, {});
    expect(pinned.map((j) => j.id)).toEqual(["j0", "j1"]);
    expect(recent.map((j) => j.id)).toEqual(["j9", "j8", "j7", "j6", "j5", "j4", "j3", "j2"]);
    expect(recent.some((j) => pins.includes(j.id))).toBe(false);
  });

  it("pins for jobs that are gone are skipped", () => {
    const { pinned } = sidebarJobs(jobs, ["gone", "j3"], {});
    expect(pinned.map((j) => j.id)).toEqual(["j3"]);
  });

  it("search ignores pins: a pinned job still matches", () => {
    expect(searchJobs(jobs, "role 0").map((j) => j.id)).toContain("j0");
    expect(withoutPin(["j0", "j1"], "j0")).toEqual(["j1"]);
  });

  it("visit log keeps only the newest 50", () => {
    let visits = {};
    for (let i = 0; i < 60; i++) {
      visits = withVisit(visits, `v${i}`, `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`);
    }
    expect(MAX_VISITS).toBe(50);
    const ids = Object.keys(visits);
    expect(ids.length).toBe(50);
    expect(ids).not.toContain("v0");
    expect(ids).toContain("v59");
    expect(withoutVisit(visits, "v59")).not.toHaveProperty("v59");
  });

  it("re-visiting a job updates its time, not the count", () => {
    const once = withVisit({}, "a", "2026-01-01T00:00:00.000Z");
    const again = withVisit(once, "a", "2026-02-01T00:00:00.000Z");
    expect(again).toEqual({ a: "2026-02-01T00:00:00.000Z" });
  });

  it("storage is optional: with no localStorage (node) reads are empty and writes do not throw", () => {
    expect(readVisits()).toEqual({});
    expect(readPins()).toEqual([]);
    expect(() => recordVisit("a", "2026-01-01T00:00:00.000Z")).not.toThrow();
  });
});
