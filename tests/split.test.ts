import { describe, expect, it } from "vitest";
import { REVIEW_MIN_PX, SPLIT_DEFAULT, clampSplit, parseSplit, splitColumns, splitLimits } from "@/lib/split";

describe("splitLimits", () => {
  it("keeps the 30% floor on wide windows and the 60% ceiling everywhere", () => {
    expect(splitLimits(2000)).toEqual({ min: 0.3, max: 0.6 });
  });

  it("raises the floor so the reviewer keeps 340px on a narrow window", () => {
    const { min, max } = splitLimits(1015); // 1024px window less the divider
    expect(min).toBeCloseTo(REVIEW_MIN_PX / 1015, 6);
    expect(max).toBe(0.6);
  });

  it("pins the reviewer to the ceiling when even 340px would not fit the 60% limit", () => {
    expect(splitLimits(500)).toEqual({ min: 0.6, max: 0.6 });
  });
});

describe("clampSplit", () => {
  it("leaves an in-range share alone", () => {
    expect(clampSplit(0.45, 1500)).toBe(0.45);
  });

  it("clamps a share above 60% so the editor keeps 40%", () => {
    expect(clampSplit(0.9, 1500)).toBe(0.6);
  });

  it("clamps a share below the 30% floor", () => {
    expect(clampSplit(0.05, 1500)).toBe(0.3);
  });

  it("clamps to the 340px floor at 1024px", () => {
    const f = clampSplit(0.1, 1015);
    expect(f * 1015).toBeGreaterThanOrEqual(REVIEW_MIN_PX - 1e-9);
  });

  it("falls back to the default for a non-number", () => {
    expect(clampSplit(Number.NaN, 1500)).toBe(SPLIT_DEFAULT);
  });
});

describe("parseSplit", () => {
  it("returns null for missing or blank storage values", () => {
    expect(parseSplit(null)).toBeNull();
    expect(parseSplit("  ")).toBeNull();
  });

  it("returns null for garbage and parses numbers", () => {
    expect(parseSplit("abc")).toBeNull();
    expect(parseSplit("0.42")).toBe(0.42);
  });
});

describe("splitColumns", () => {
  it("builds editor, divider and reviewer columns", () => {
    expect(splitColumns(0.5)).toBe("minmax(0,0.5000fr) 9px minmax(0,0.5000fr)");
  });
});
