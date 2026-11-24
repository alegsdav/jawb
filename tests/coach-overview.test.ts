import { describe, expect, it } from "vitest";
import { CHOICES, choiceClass, choiceOfStage, rowGapClass } from "@/lib/coachChoice";

describe("coach choices", () => {
  it("are Examples and Question me, in that order", () => {
    expect(CHOICES.map((c) => c.label)).toEqual(["Examples", "Question me"]);
    expect(CHOICES.map((c) => c.busyText)).toEqual([
      "Finding examples for this bullet…",
      "Writing questions about this bullet…",
    ]);
  });

  it("map each stage to its choice, and the choose stage to none", () => {
    expect(choiceOfStage("choose")).toBeNull();
    expect(choiceOfStage("examples")).toBe("examples");
    expect(choiceOfStage("resolve")).toBe("examples");
    expect(choiceOfStage("questions")).toBe("questions");
  });

  it("side by side, both are equal width with the bordered style", () => {
    expect(choiceClass("examples", null)).toBe(
      "min-w-0 overflow-hidden rounded-md border text-left transition-[flex-grow,flex-basis,border-color,font-size,padding,opacity,visibility] duration-300 ease-out motion-reduce:transition-none grow basis-0 border-border px-3 py-2.5 text-[14px] text-fg hover:bg-surface-2",
    );
    expect(choiceClass("questions", null)).toContain("grow basis-0 border-border");
    expect(rowGapClass(null)).toContain("gap-2");
  });

  it("zooms the picked one into a heading and collapses the other", () => {
    const zoomed = choiceClass("questions", "questions");
    expect(zoomed).toContain("grow basis-0 border-transparent px-0 py-2.5 text-[17px] font-medium");
    const other = choiceClass("examples", "questions");
    expect(other).toContain("grow-0 basis-0 border-transparent px-0 py-2.5 text-[14px] opacity-0 invisible");
    expect(rowGapClass("questions")).toContain("gap-0");
  });
});
