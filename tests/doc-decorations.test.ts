import { describe, it, expect } from "vitest";
import type { Node as PMNode } from "prosemirror-model";
import type { Decoration } from "prosemirror-view";
import { linesToDoc } from "../src/lib/pmSchema";
import type { DocLine } from "../src/lib/docLineTypes";
import type { BulletFeedback } from "../src/lib/analysis";
import { buildDecorations, bulletInfo, type DecorationOptions } from "../src/components/docDecorations";

const base: DecorationOptions = { showHighlights: true, showChanges: false, quiet: false, caretLine: -1 };

const lines: DocLine[] = [
  { kind: "name", text: "Ada Lovelace" }, // 0
  { kind: "contact", text: "London" }, // 1
  { kind: "heading", text: "EXPERIENCE", sid: "s1" }, // 2
  { kind: "entry", text: "Analytical Engines", right: "London", sid: "s1", iid: "i1" }, // 3
  { kind: "role", text: "Engineer", right: "2020", sid: "s1", iid: "i1" }, // 4
  { kind: "bullet", text: "Wrote [metric] things", sid: "s1", iid: "i1", bid: "b1" }, // 5
  { kind: "bullet", text: "Designed the notation", sid: "s1", iid: "i1", bid: "b2" }, // 6
  { kind: "entry", text: "Ada Co", right: "", sid: "s1", iid: "i2" }, // 7 (empty location)
  { kind: "text", text: "Languages: Python", sid: "s2", iid: "i3" }, // 8
];

const doc = linesToDoc(lines);

/** Start position of line `index` in the doc. */
function lineStart(d: PMNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += d.child(i).nodeSize;
  return pos;
}

const cls = (d: Decoration): string | undefined =>
  (d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class;
const key = (d: Decoration): string | undefined => (d.spec as { key?: string } | undefined)?.key;

function decos(opts: Partial<DecorationOptions> = {}, d: PMNode = doc): Decoration[] {
  return buildDecorations(d, { ...base, ...opts }).find();
}

const fb = (rating: BulletFeedback["rating"], over: Partial<BulletFeedback> = {}): BulletFeedback => ({
  state: "current",
  rating,
  note: "note",
  suggestion: "",
  ...over,
});

describe("inline bold / italic", () => {
  it("entry: title bold by default, location normal", () => {
    const set = decos({}, doc);
    const start = lineStart(doc, 3);
    const title = set.filter((d) => d.from === start + 1 && d.to === start + 1 + "Analytical Engines".length);
    const loc = set.filter((d) => d.from === start + 1 + "Analytical Engines".length + 1 && d.to > d.from);
    expect(title.map(cls)).toEqual(["font-bold not-italic"]);
    expect(loc.map(cls)).toEqual(["font-normal not-italic"]);
  });

  it("a styled override replaces the default", () => {
    const styled: DocLine[] = [
      { kind: "entry", text: "Title", right: "Place", sid: "s", iid: "i", style: { bold: false, italic: true } },
    ];
    const d = linesToDoc(styled);
    const set = decos({}, d);
    const inline = set.filter((x) => cls(x) !== undefined && x.to > x.from);
    expect(inline.map(cls)).toEqual(["font-normal italic", "font-normal not-italic"]);
  });

  it("text line: label bold, details normal, the ': ' left undecorated", () => {
    const start = lineStart(doc, 8);
    const set = decos({}, doc).filter((x) => x.from > start && x.to <= start + doc.child(8).nodeSize);
    const label = set.find((x) => x.from === start + 1 && x.to === start + 1 + "Languages".length);
    const details = set.find((x) => x.from === start + 1 + "Languages".length + 2 && x.to === start + doc.child(8).nodeSize - 1);
    expect(cls(label!)).toBe("font-bold not-italic");
    expect(cls(details!)).toBe("font-normal not-italic");
    expect(set.length).toBe(2);
  });

  it("bullets get no style decorations", () => {
    const set = decos({}, doc);
    const bulletRanges: [number, number][] = [];
    for (let i = 0; i < doc.childCount; i++) {
      if (doc.child(i).attrs.kind === "bullet") {
        const s = lineStart(doc, i);
        bulletRanges.push([s, s + doc.child(i).nodeSize]);
      }
    }
    const styleDecos = set.filter((x) => (cls(x) ?? "").startsWith("font-") || (cls(x) ?? "").includes("italic"));
    for (const [s, e] of bulletRanges) {
      expect(styleDecos.filter((x) => x.from >= s && x.to <= e)).toEqual([]);
    }
  });
});

describe("placeholders for empty parts", () => {
  it("shown only on the caret line", () => {
    const off = decos({ caretLine: 3 }).filter((x) => key(x)?.startsWith("ph:"));
    expect(off).toEqual([]);
  });

  it("an empty location shows 'Location' on the caret line, and nothing else is a placeholder", () => {
    const set = decos({ caretLine: 7 }).filter((x) => key(x)?.startsWith("ph:"));
    expect(set.map(key)).toEqual(["ph:Location"]);
    expect(set[0].from).toBe(lineStart(doc, 7) + 1 + "Ada Co".length + 1);
  });

  it("an empty bullet shows the accomplishment placeholder on the caret line", () => {
    const empty = linesToDoc([{ kind: "bullet", text: "", sid: "s", iid: "i", bid: "b" }]);
    const set = decos({ caretLine: 0 }, empty).filter((x) => key(x)?.startsWith("ph:"));
    expect(set.map(key)).toEqual(["ph:Accomplishment: verb + what + measurable impact"]);
  });
});

describe("bulletInfo", () => {
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

  it("baseline: new, changed and unchanged bullets", () => {
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

describe("bullet tint, marks and dot", () => {
  const bulletStart = lineStart(doc, 5);
  const bulletEnd = bulletStart + doc.child(5).nodeSize;
  const tintsOn = (set: Decoration[]) =>
    set.filter((x) => x.from === bulletStart && x.to === bulletEnd).map(cls);

  it("placeholder tint beats the rating tint", () => {
    const set = decos({ feedback: { b1: fb("weak") } });
    expect(tintsOn(set)).toEqual(["bg-[#fff6d6]"]);
  });

  it("the rating tint shows when there is no placeholder", () => {
    const set = decos({ feedback: { b2: fb("weak") } });
    const s = lineStart(doc, 6);
    expect(set.filter((x) => x.from === s && x.to === s + doc.child(6).nodeSize).map(cls)).toEqual(["bg-[#fdecec]"]);
  });

  it("quiet removes the placeholder tint and marks, and the rating tint shows again", () => {
    const set = decos({ feedback: { b1: fb("weak") }, quiet: true });
    expect(tintsOn(set)).toEqual(["bg-[#fdecec]"]);
    expect(set.filter((x) => cls(x) === "doc-ph")).toEqual([]);
  });

  it("placeholder marks cover each [placeholder]", () => {
    const set = decos({});
    const marks = set.filter((x) => cls(x) === "doc-ph");
    expect(marks.map((x) => [x.from, x.to])).toEqual([[bulletStart + 1 + 6, bulletStart + 1 + 6 + 8]]);
  });

  it("showHighlights false removes the rating tint and the dot", () => {
    const set = decos({ feedback: { b2: fb("weak") }, showHighlights: false });
    expect(set.filter((x) => cls(x) === "bg-[#fdecec]")).toEqual([]);
    expect(set.filter((x) => key(x)?.startsWith("dot:"))).toEqual([]);
  });

  it("the dot key changes when the rating changes", () => {
    const a = decos({ feedback: { b2: fb("weak") } }).find((x) => key(x)?.startsWith("dot:"));
    const b = decos({ feedback: { b2: fb("strong") } }).find((x) => key(x)?.startsWith("dot:"));
    expect(key(a!)).toBeDefined();
    expect(key(a!)).not.toBe(key(b!));
  });

  it("no dot for a stale bullet", () => {
    const set = decos({ feedback: { b2: fb("weak", { state: "stale" }) } });
    expect(set.filter((x) => key(x)?.startsWith("dot:"))).toEqual([]);
  });
});

describe("change bar", () => {
  const baseline = new Map([["b1", "old text"], ["b2", "Designed the notation"]]);

  it("shown for changed and new bullets only when showChanges is on", () => {
    const on = decos({ baseline, showChanges: true }).filter((x) => key(x)?.startsWith("bar:"));
    expect(on.map(key).sort()).toEqual(["bar:b1:changed"]);
    const off = decos({ baseline, showChanges: false }).filter((x) => key(x)?.startsWith("bar:"));
    expect(off).toEqual([]);
  });

  it("a new bullet gets the 'new' key", () => {
    const set = decos({ baseline: new Map(), showChanges: true }).filter((x) => key(x)?.startsWith("bar:"));
    expect(set.map(key).sort()).toEqual(["bar:b1:new", "bar:b2:new"]);
  });
});
