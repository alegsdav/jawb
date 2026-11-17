import { describe, expect, it } from "vitest";
import { joinsPreviousStep } from "@/lib/useHistory";

/** Replays edits (time, key, commit) through the same rule useHistory's set() uses; returns the number of undo steps. */
function steps(edits: { at: number; key?: string; commit?: boolean }[]): number {
  let last: { at: number; key?: string } = { at: 0 };
  let count = 0;
  for (const e of edits) {
    const join = joinsPreviousStep(last, e.at, !!e.commit, e.key);
    if (!join) count++;
    last = e.commit ? { at: 0 } : { at: e.at, key: e.key };
  }
  return count;
}

describe("useHistory undo coalescing", () => {
  it("same-line typing coalesces into one step", () => {
    const line = "line-2";
    expect(steps([
      { at: 1000, key: line },
      { at: 1200, key: line },
      { at: 1500, key: line },
    ])).toBe(1);
  });

  it("a change on a different line starts a new step", () => {
    expect(steps([
      { at: 1000, key: "line-2" },
      { at: 1200, key: "line-5" },
    ])).toBe(2);
  });

  it("typing that moves between lines and back makes a step at each switch", () => {
    expect(steps([
      { at: 1000, key: "line-2" },
      { at: 1100, key: "line-2" },
      { at: 1200, key: "line-3" },
      { at: 1300, key: "line-3" },
    ])).toBe(2);
  });

  it("edits more than a second apart never coalesce, even on the same line", () => {
    expect(steps([
      { at: 1000, key: "line-2" },
      { at: 2001, key: "line-2" },
    ])).toBe(2);
  });

  it("structural edits (commit) always make their own step", () => {
    expect(steps([
      { at: 1000, key: "line-2" },
      { at: 1100, key: "line-2", commit: true },
      { at: 1200, key: "line-2" },
    ])).toBe(3);
  });

  it("without a key, quick edits still coalesce as before", () => {
    expect(steps([{ at: 1000 }, { at: 1300 }, { at: 1600 }])).toBe(1);
    expect(steps([{ at: 1000 }, { at: 1300, key: "line-2" }])).toBe(2);
  });
});
