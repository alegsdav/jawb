import { describe, expect, it } from "vitest";
import { PAGE_W, fitScale, pageScale, reflowsAt } from "@/lib/pageZoom";

describe("reflowsAt", () => {
  it("reflows only phone-width canvases, and never an unmeasured one", () => {
    expect(reflowsAt(0)).toBe(false);
    expect(reflowsAt(639)).toBe(true);
    expect(reflowsAt(640)).toBe(false);
    expect(reflowsAt(1100)).toBe(false);
  });
});

describe("fitScale", () => {
  it("never grows the page past 100%", () => {
    expect(fitScale(1400)).toBe(1);
    expect(fitScale(PAGE_W + 48)).toBe(1);
  });

  it("shrinks the page to the column minus a 24px gutter each side", () => {
    expect(fitScale(PAGE_W / 2 + 48)).toBeCloseTo(0.5, 10);
    expect(fitScale(700)).toBeCloseTo(652 / PAGE_W, 10);
  });

  it("is 1 before the canvas is measured", () => {
    expect(fitScale(0)).toBe(1);
  });
});

describe("pageScale", () => {
  it("uses the fit scale for Fit (0) and the chosen zoom otherwise", () => {
    expect(pageScale(0, 700)).toBeCloseTo(652 / PAGE_W, 10);
    expect(pageScale(1, 700)).toBe(1);
    expect(pageScale(1.5, 700)).toBe(1.5);
  });

  it("keeps the page at 100% when the window is narrower than the page, so the text does not re-wrap", () => {
    expect(pageScale(1, 324)).toBe(1);
  });
});
