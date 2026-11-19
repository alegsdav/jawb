import { describe, expect, it } from "vitest";
import { MAX_TAB_STOPS, TAB_STOP_MAX_PT } from "@/lib/doc/types";
import {
  TAB_STOP_MAX_IN,
  inchesToPt,
  nextStopRow,
  ptToInches,
  rowsFromStops,
  stopsFromRows,
  type StopRow,
} from "@/lib/tabStopsUi";

const row = (inches: string, align: StopRow["align"] = "left"): StopRow => ({ inches, align });

describe("inches and points", () => {
  it("converts 72pt to an inch and back", () => {
    expect(ptToInches(72)).toBe(1);
    expect(inchesToPt(1)).toBe(72);
  });

  it("shows hundredths of an inch and stores hundredths of a point", () => {
    expect(ptToInches(36)).toBe(0.5);
    expect(ptToInches(54.5)).toBe(0.76);
    expect(inchesToPt(0.75)).toBe(54);
    expect(inchesToPt(0.333)).toBe(23.98);
  });

  it("allows the widest stop the document keeps", () => {
    expect(TAB_STOP_MAX_IN).toBe(10);
    expect(inchesToPt(TAB_STOP_MAX_IN)).toBe(TAB_STOP_MAX_PT);
  });
});

describe("rowsFromStops", () => {
  it("gives one row per stop, in the paragraph's order, with two decimals", () => {
    expect(rowsFromStops([{ pos: 36, align: "left" }, { pos: 540, align: "right" }])).toEqual([
      { inches: "0.50", align: "left" },
      { inches: "7.50", align: "right" },
    ]);
  });

  it("gives no rows when the paragraph has no stops", () => {
    expect(rowsFromStops(null)).toEqual([]);
  });
});

describe("stopsFromRows", () => {
  it("turns rows into stops in points", () => {
    expect(stopsFromRows([row("1.00", "center"), row("0.5", "left")])).toEqual({
      ok: true,
      stops: [{ pos: 36, align: "left" }, { pos: 72, align: "center" }],
    });
  });

  it("sorts the stops by position", () => {
    const result = stopsFromRows([row("6"), row("1"), row("3")]);
    expect(result.ok && result.stops.map((s) => s.pos)).toEqual([72, 216, 432]);
  });

  it("keeps the first row at a repeated position, as the document does", () => {
    expect(stopsFromRows([row("2", "right"), row("2.00", "center")])).toEqual({
      ok: true,
      stops: [{ pos: 144, align: "right" }],
    });
  });

  it("is valid with no rows, which means no stops", () => {
    expect(stopsFromRows([])).toEqual({ ok: true, stops: [] });
  });

  it("rejects an empty, non-numeric, zero, negative or too-far position, naming the row", () => {
    for (const bad of ["", "  ", "abc", "0", "-1", "10.05", "Infinity"]) {
      const result = stopsFromRows([row("1"), row(bad)]);
      expect(result).toEqual({ ok: false, error: expect.stringContaining("Stop 2:") });
    }
  });

  it("accepts the furthest position, 10 in", () => {
    expect(stopsFromRows([row("10")])).toEqual({ ok: true, stops: [{ pos: 720, align: "left" }] });
  });

  it("rejects more rows than a paragraph can keep", () => {
    const rows = Array.from({ length: MAX_TAB_STOPS + 1 }, (_, i) => row(String(i + 1)));
    expect(stopsFromRows(rows)).toEqual({ ok: false, error: expect.stringContaining(`${MAX_TAB_STOPS}`) });
  });
});

describe("nextStopRow", () => {
  it("starts at half an inch with no stops", () => {
    expect(nextStopRow([])).toEqual({ inches: "0.50", align: "left" });
  });

  it("goes half an inch past the furthest stop", () => {
    expect(nextStopRow([row("1.00", "right"), row("3.25")])).toEqual({ inches: "3.75", align: "left" });
  });

  it("stops at the widest allowed position", () => {
    expect(nextStopRow([row("9.90")])).toEqual({ inches: "10.00", align: "left" });
  });
});
