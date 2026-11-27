import { describe, it, expect } from "vitest";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Decoration } from "@tiptap/pm/view";
import type { DocJSON, DocInline } from "../src/lib/doc/types";
import { paragraph } from "../src/lib/doc/model";
import { docFromJSON } from "../src/lib/doc/extensions";
import type { BulletFeedback } from "../src/lib/analysis";
import { RATING, bulletInfo } from "../src/components/docDecorations";
import {
  buildHighlights,
  paragraphPlainText,
  type HighlightOptions,
} from "../src/components/aiHighlights";

const base: HighlightOptions = { showHighlights: true, showChanges: false, quiet: false };

/** A paragraph with the given id and inline content (text, or a list of inline nodes). */
const para = (id: string, content: string | DocInline[]) =>
  typeof content === "string"
    ? paragraph(content, { attrs: { id } })
    : { type: "paragraph" as const, attrs: { id, textAlign: null }, content };

function docOf(...paras: ReturnType<typeof para>[]): PMNode {
  const json: DocJSON = { type: "doc", content: paras };
  return docFromJSON(json);
}

/** Start position (before the paragraph node) of child `index`. */
function paraStart(d: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += d.child(i).nodeSize;
  return pos;
}

type Attrs = { class?: string; "data-change"?: string };
const attrsOf = (d: Decoration): Attrs => (d as unknown as { type: { attrs?: Attrs } }).type.attrs ?? {};
const cls = (d: Decoration): string | undefined => attrsOf(d).class;
const key = (d: Decoration): string | undefined => (d.spec as { key?: string } | undefined)?.key;
const RATING_TINTS = new Set(Object.values(RATING).map((r) => r.tint));
const ratingTints = (set: Decoration[]) => set.filter((x) => RATING_TINTS.has(cls(x) ?? ""));

function decos(d: PMNode, opts: Partial<HighlightOptions> = {}): Decoration[] {
  return buildHighlights(d, { ...base, ...opts }).find();
}

const fb = (rating: BulletFeedback["rating"], over: Partial<BulletFeedback> = {}): BulletFeedback => ({
  state: "current",
  rating,
  note: "note",
  suggestion: "",
  why: "",
  ...over,
});

const doc = docOf(
  para("h1", "Ada Lovelace"),                    // 0
  para("b1", "Wrote [metric] things"),           // 1
  para("b2", "Designed the notation"),           // 2
  para("e1", ""),                                // 3 (empty paragraph)
);

describe("rating tint", () => {
  it("a rated paragraph gets the rating tint over its text and no dot", () => {
    const d = docOf(para("b2", "Designed the notation"));
    const set = decos(d, { feedback: { b2: fb("weak") } });
    const from = 1;
    const to = from + "Designed the notation".length;
    const tint = set.find((x) => cls(x) === "bg-[#c530301f]");
    expect([tint?.from, tint?.to]).toEqual([from, to]);
    expect(set.filter((x) => key(x)?.startsWith("dot:"))).toEqual([]);
  });

  it("each rating has its own tint", () => {
    const tints = (r: BulletFeedback["rating"]) =>
      ratingTints(decos(doc, { feedback: { b2: fb(r) } })).map((x) => cls(x));
    expect(tints("strong")).toEqual([RATING.strong.tint]);
    expect(tints("ok")).toEqual([RATING.ok.tint]);
    expect(tints("weak")).toEqual([RATING.weak.tint]);
  });

  it("a suggestion adds no decoration", () => {
    const set = decos(doc, { feedback: { b2: fb("ok", { suggestion: "better" }) } });
    expect(ratingTints(set).map((x) => cls(x))).toEqual([RATING.ok.tint]);
    expect(set.filter((x) => key(x)?.startsWith("dot:"))).toEqual([]);
  });

  it("nothing when showHighlights is false", () => {
    const set = decos(doc, { feedback: { b2: fb("weak") }, showHighlights: false });
    expect(set.filter((x) => cls(x) === "bg-[#c530301f]")).toEqual([]);
    expect(set.filter((x) => key(x)?.startsWith("dot:"))).toEqual([]);
  });

  it("nothing for stale feedback", () => {
    const set = decos(doc, { feedback: { b2: fb("weak", { state: "stale", suggestion: "s" }) } });
    expect(ratingTints(set)).toEqual([]);
    expect(set.filter((x) => key(x)?.startsWith("dot:"))).toEqual([]);
  });

  it("updated feedback gets no rating tint and no dot", () => {
    const set = decos(doc, { feedback: { b2: fb("strong", { state: "updated" }) } });
    expect(ratingTints(set)).toEqual([]);
    expect(set.filter((x) => key(x)?.startsWith("dot:"))).toEqual([]);
  });

  it("a paragraph without feedback gets nothing", () => {
    const set = decos(doc, { feedback: { other: fb("weak") } });
    expect(ratingTints(set)).toEqual([]);
    expect(set.filter((x) => key(x)?.startsWith("dot:"))).toEqual([]);
  });
});

describe("placeholders", () => {
  it("each [placeholder] gets a doc-ph mark on its own characters", () => {
    const from = paraStart(doc, 1) + 1 + "Wrote ".length;
    const marks = decos(doc).filter((x) => cls(x) === "doc-ph");
    expect(marks.map((x) => [x.from, x.to])).toEqual([[from, from + "[metric]".length]]);
  });

  it("a paragraph with a placeholder gets the placeholder tint, which beats the rating tint", () => {
    const set = decos(doc, { feedback: { b1: fb("weak") } });
    const start = paraStart(doc, 1);
    const node = set.find((x) => cls(x) === "bg-[#fff6d6]");
    expect([node?.from, node?.to]).toEqual([start, start + doc.child(1).nodeSize]);
    expect(set.filter((x) => cls(x) === "bg-[#c530301f]")).toEqual([]);
  });

  it("quiet removes the placeholder tint and marks, and the rating tint shows again", () => {
    const set = decos(doc, { feedback: { b1: fb("weak") }, quiet: true });
    expect(set.filter((x) => cls(x) === "doc-ph" || cls(x) === "bg-[#fff6d6]")).toEqual([]);
    expect(set.filter((x) => cls(x) === "bg-[#c530301f]")).toHaveLength(1);
  });

  it("placeholders in any paragraph count, not only bullets", () => {
    const d = docOf(para("h", "Skills [tool]"));
    expect(decos(d).filter((x) => cls(x) === "doc-ph")).toHaveLength(1);
  });
});

describe("changed vs master", () => {
  const baseline = new Map([
    ["h1", "Ada Lovelace"],
    ["b1", "old text"],
    ["b2", "Designed the notation"],
  ]);
  const changeDecos = (set: Decoration[]) => set.filter((x) => cls(x) === "doc-changed");

  it("no paragraph is drawn as changed: the change bar is gone, whatever showChanges is", () => {
    expect(changeDecos(decos(doc, { baseline, showChanges: true }))).toEqual([]);
    expect(changeDecos(decos(doc, { baseline: new Map(), showChanges: true }))).toEqual([]);
  });

  it("the change data is still there for the revert arrow (bulletInfo)", () => {
    const changed = bulletInfo("b1", "new text", { baseline });
    expect(changed).toMatchObject({ changed: true, isNew: false, original: "old text" });
    const added = bulletInfo("b9", "fresh", { baseline });
    expect(added).toMatchObject({ changed: false, isNew: true });
    const same = bulletInfo("b2", "Designed the notation", { baseline });
    expect(same).toMatchObject({ changed: false, isNew: false });
  });

  it("a tab compares as \\t against the master text (bulletInfo)", () => {
    const tabbed = "Ada\tLondon";
    expect(bulletInfo("t", tabbed, { baseline: new Map([["t", "Ada\tLondon"]]) }).changed).toBe(false);
    expect(bulletInfo("t", tabbed, { baseline: new Map([["t", "Ada London"]]) }).changed).toBe(true);
  });

  it("paragraphPlainText maps tabs and hard breaks like paragraphText", () => {
    const node = docFromJSON({
      type: "doc",
      content: [
        para("x", [
          { type: "text", text: "a" },
          { type: "tab" },
          { type: "text", text: "b" },
          { type: "hardBreak" },
          { type: "text", text: "c" },
        ]),
      ],
    }).child(0);
    expect(paragraphPlainText(node)).toBe("a\tb\nc");
  });
});

describe("coach focus", () => {
  const focusNodes = (set: Decoration[]) => set.filter((x) => cls(x) === "doc-focus");

  it("the focused paragraph gets one doc-focus node decoration and nothing else changes", () => {
    const without = decos(doc, { feedback: { b1: fb("weak") } });
    const set = decos(doc, { feedback: { b1: fb("weak") }, focusId: "b1" });
    const focus = focusNodes(set);
    expect(focus).toHaveLength(1);
    expect(focus[0].from).toBe(paraStart(doc, 1));
    expect(focus[0].to).toBe(paraStart(doc, 1) + doc.child(1).nodeSize);
    expect(set.length).toBe(without.length + 1);
  });

  it("works with highlights off, and with no focusId nothing is drawn", () => {
    expect(focusNodes(decos(doc, { showHighlights: false, focusId: "b2" }))).toHaveLength(1);
    expect(focusNodes(decos(doc, { focusId: null }))).toEqual([]);
    expect(focusNodes(decos(doc, { focusId: "missing" }))).toEqual([]);
  });

  it("the document JSON is not changed by the focus", () => {
    const before = JSON.stringify(doc.toJSON());
    decos(doc, { focusId: "b1" });
    expect(JSON.stringify(doc.toJSON())).toBe(before);
  });
});

describe("document is untouched", () => {
  it("decorations are built without changing the document JSON", () => {
    const before = JSON.stringify(doc.toJSON());
    decos(doc, { feedback: { b1: fb("weak"), b2: fb("ok") }, baseline: new Map(), showChanges: true });
    expect(JSON.stringify(doc.toJSON())).toBe(before);
  });
});

describe("bulletInfo", () => {
  it("carries the why of a current suggestion, and nothing without one", () => {
    expect(bulletInfo("b1", "x", { feedback: { b1: fb("ok", { suggestion: "better", why: "Leads with the result." }) } }).why)
      .toBe("Leads with the result.");
    expect(bulletInfo("b1", "x", { feedback: { b1: fb("ok", { suggestion: "" }) } }).why).toBe("");
    expect(bulletInfo("b1", "x", {}).why).toBe("");
  });

  it("current feedback is shown as fb with its suggestion", () => {
    const info = bulletInfo("b1", "x", { feedback: { b1: fb("ok", { suggestion: "better" }) } });
    expect(info.fb?.rating).toBe("ok");
    expect(info.suggestion).toBe("better");
    expect(info.view?.state).toBe("current");
  });

  it("stale feedback hides the rating and suggestion", () => {
    const info = bulletInfo("b1", "x", { feedback: { b1: fb("weak", { state: "stale", suggestion: "s" }) } });
    expect(info.view?.state).toBe("stale");
    expect(info.fb).toBeNull();
    expect(info.suggestion).toBe("");
  });

  it("updated feedback keeps the view but no rating", () => {
    const info = bulletInfo("b1", "x", { feedback: { b1: fb("strong", { state: "updated" }) } });
    expect(info.view?.state).toBe("updated");
    expect(info.fb).toBeNull();
  });

  it("baseline: new, changed and unchanged paragraphs", () => {
    const baseline = new Map([["b1", "old"], ["b3", "same"]]);
    const opts = { baseline };
    expect(bulletInfo("b1", "new", opts)).toMatchObject({ original: "old", changed: true, isNew: false });
    expect(bulletInfo("b2", "added", opts)).toMatchObject({ original: undefined, changed: false, isNew: true });
    expect(bulletInfo("b3", "same", opts)).toMatchObject({ changed: false, isNew: false });
  });

  it("no baseline means nothing is new or changed", () => {
    expect(bulletInfo("b1", "x", { baseline: null })).toMatchObject({ changed: false, isNew: false });
  });

  it("placeholders with their char offsets", () => {
    const info = bulletInfo("b1", "Wrote [metric] for [team]", {});
    expect(info.placeholders).toEqual([
      { text: "[metric]", start: 6 },
      { text: "[team]", start: 19 },
    ]);
  });
});
