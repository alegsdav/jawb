import { describe, expect, it } from "vitest";
import {
  PAGE_PRESETS,
  clampMargin,
  inputsFromPage,
  pageFromInputs,
} from "@/lib/pageSetup";
import { PAGE_DEFAULTS, type PageSetup } from "@/lib/doc/types";

const page = (marginTop: number, marginBottom: number, marginLeft: number, marginRight: number): PageSetup => ({
  marginTop,
  marginBottom,
  marginLeft,
  marginRight,
});

describe("clampMargin", () => {
  it("keeps values inside 0.2 to 3 inches (the importers allow up to 3)", () => {
    expect(clampMargin(0.01)).toBe(0.2);
    expect(clampMargin(-3)).toBe(0.2);
    expect(clampMargin(2.6)).toBe(2.6);
    expect(clampMargin(3.4)).toBe(3);
    expect(clampMargin(1.25)).toBe(1.25);
  });

  it("rounds to hundredths of an inch", () => {
    expect(clampMargin(0.4166)).toBe(0.42);
    expect(clampMargin(0.999)).toBe(1);
  });
});

describe("presets", () => {
  it("set all four margins to the named value", () => {
    const [narrow, normal, moderate] = PAGE_PRESETS.map((p) => p.page);
    expect(narrow).toEqual(page(0.5, 0.5, 0.5, 0.5));
    expect(normal).toEqual(page(1, 1, 1, 1));
    expect(moderate).toEqual(page(0.75, 0.75, 0.75, 0.75));
  });

  it("are all inside the allowed range", () => {
    for (const { page: p } of PAGE_PRESETS) {
      for (const v of Object.values(p)) expect(clampMargin(v)).toBe(v);
    }
  });
});

describe("pageFromInputs", () => {
  it("reads the four inputs in order", () => {
    expect(
      pageFromInputs({ marginTop: "0.5", marginBottom: "0.75", marginLeft: "1", marginRight: "0.6" }),
    ).toEqual(page(0.5, 0.75, 1, 0.6));
  });

  it("clamps out-of-range typed values", () => {
    expect(
      pageFromInputs({ marginTop: "0", marginBottom: "5", marginLeft: "0.6", marginRight: "0.6" }),
    ).toEqual(page(0.2, 3, 0.6, 0.6));
  });

  it("is null while any field is empty or not a number", () => {
    const ok = { marginTop: "1", marginBottom: "1", marginLeft: "1", marginRight: "1" };
    expect(pageFromInputs({ ...ok, marginTop: "" })).toBeNull();
    expect(pageFromInputs({ ...ok, marginLeft: "  " })).toBeNull();
    expect(pageFromInputs({ ...ok, marginRight: "abc" })).toBeNull();
  });
});

describe("inputsFromPage", () => {
  it("shows two decimals for each margin", () => {
    expect(inputsFromPage(page(0.42, 0.5, 0.6, 1))).toEqual({
      marginTop: "0.42",
      marginBottom: "0.50",
      marginLeft: "0.60",
      marginRight: "1.00",
    });
  });

  it("round-trips through pageFromInputs", () => {
    expect(pageFromInputs(inputsFromPage(PAGE_DEFAULTS))).toEqual(PAGE_DEFAULTS);
  });
});
