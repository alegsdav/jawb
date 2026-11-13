import { afterEach, describe, expect, it } from "vitest";
import { addDays, applyDates, daysUntil, localToday } from "@/lib/dates";

describe("dates", () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });

  it("applyDates uses the local day, not UTC (US evening)", () => {
    process.env.TZ = "America/Los_Angeles";
    const evening = new Date("2026-11-14T03:30:00Z"); // Nov 13, 7:30pm in Los Angeles
    expect(evening.toISOString().slice(0, 10)).toBe("2026-11-14");
    expect(localToday(evening)).toBe("2026-11-13");
    expect(applyDates(evening)).toEqual({ date_applied: "2026-11-13", follow_up_date: "2026-11-23" });
  });

  it("adds calendar days across DST and month ends", () => {
    process.env.TZ = "America/New_York";
    expect(addDays("2026-03-05", 10)).toBe("2026-03-15"); // DST starts Mar 8
    expect(addDays("2026-10-28", 10)).toBe("2026-11-07"); // DST ends Nov 1
    expect(addDays("2026-12-25", 10)).toBe("2027-01-04");
  });

  it("counts whole days until a date", () => {
    expect(daysUntil("2026-11-20", "2026-11-13")).toBe(7);
    expect(daysUntil("2026-11-12", "2026-11-13")).toBe(-1);
  });
});
