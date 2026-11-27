import { describe, expect, it } from "vitest";
import { bulletFeedback } from "@/lib/analysis";
import { normalizeResume } from "@/lib/resume";
import {
  answerChanges, clearLocalReview, LOCAL_REVIEW_KEY, markReviewRunning, readLocalReview, REVIEW_RUNNING_KEY,
  REVIEW_RUNNING_MAX_MS, reviewRunningSince, weakestBullets, writeLocalReview,
} from "@/lib/masterReview";
import type { MasterAnalysis } from "@/lib/types";

/** A master with four bullets in one entry. */
const resume = (texts: Record<string, string>) =>
  normalizeResume({
    version: 2,
    header: { name: "Ann", contact: "" },
    sections: [
      {
        id: "s",
        title: "Experience",
        items: [
          {
            id: "i",
            title: "Acme",
            subtitle: "",
            location: "",
            dates: "",
            bullets: Object.entries(texts).map(([id, text]) => ({ id, text })),
          },
        ],
      },
    ],
  });

const base = {
  b1: "Built a tool",
  b2: "Led the team",
  b3: "Wrote the docs",
  b4: "Ran things",
};

const review = (over: Partial<MasterAnalysis> = {}): MasterAnalysis => ({
  verdict: "",
  weakest: ["b1", "b2", "b3", "gone"],
  strengths: [],
  gaps: [],
  bullets: [
    { bullet_id: "b1", rating: "weak", note: "Vague", rewrite: "Built a tool for 300 students", why: "", original: "Built a tool" },
    { bullet_id: "b2", rating: "ok", note: "Okay", rewrite: "", why: "", original: "Led the team" },
    { bullet_id: "b3", rating: "weak", note: "Old note", rewrite: "", why: "", original: "Wrote the docs" },
    { bullet_id: "b4", rating: "strong", note: "", rewrite: "", why: "", original: "Ran things" },
  ],
  questions: [],
  ...over,
});

describe("weakestBullets", () => {
  it("lists the weakest bullets in the review's order, with their current text and note", () => {
    const r = resume({ ...base, b3: "Wrote the docs" });
    const out = weakestBullets(review(), r, bulletFeedback(review(), r, null));
    expect(out).toEqual([
      { id: "b1", text: "Built a tool", rating: "weak", note: "Vague" },
      { id: "b2", text: "Led the team", rating: "ok", note: "Okay" },
      { id: "b3", text: "Wrote the docs", rating: "weak", note: "Old note" },
    ]);
  });

  it("skips bullets that were edited since they were rated (stale feedback)", () => {
    const r = resume({ ...base, b3: "Wrote the user docs" });
    const out = weakestBullets(review(), r, bulletFeedback(review(), r, null));
    expect(out.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("skips a bullet whose suggested rewrite was accepted (the old rating no longer applies)", () => {
    const r = resume({ ...base, b1: "Built a tool for 300 students" });
    const out = weakestBullets(review(), r, bulletFeedback(review(), r, null));
    expect(out.map((b) => b.id)).toEqual(["b2", "b3"]);
  });

  it("skips bullets that no longer exist on the resume and bullets rated strong", () => {
    const r = resume({ b2: "Led the team", b4: "Ran things" });
    const out = weakestBullets(review({ weakest: ["b1", "gone", "b4", "b2"] }), r, bulletFeedback(review(), r, null));
    expect(out.map((b) => b.id)).toEqual(["b2"]);
  });

  it("is empty without a review or a resume", () => {
    const r = resume(base);
    expect(weakestBullets(null, r, {})).toEqual([]);
    expect(weakestBullets(review(), null, {})).toEqual([]);
  });
});

describe("answerChanges", () => {
  it("sends changed and cleared answers only, a cleared one as an empty string", () => {
    expect(answerChanges({ q1: "5 years", q2: "yes" }, { q1: "6 years", q3: "new" })).toEqual({
      q1: "6 years",
      q2: "",
      q3: "new",
    });
  });

  it("ignores whitespace and unchanged answers", () => {
    expect(answerChanges({ q1: "same" }, { q1: " same " })).toEqual({});
    expect(answerChanges(undefined, undefined)).toEqual({});
  });
});

/** A storage that keeps values in memory (the tests' stand-in for localStorage). */
function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

/** Storage the browser blocks: every call throws, like a private window. */
const blockedStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("the review kept on this device", () => {
  it("round-trips a review through storage", () => {
    const store = fakeStore();
    writeLocalReview(review(), store);
    expect(store.data.has(LOCAL_REVIEW_KEY)).toBe(true);
    const back = readLocalReview(store);
    expect(back?.weakest).toEqual(["b1", "b2", "b3"]);
    expect(back?.bullets.map((b) => b.bullet_id)).toEqual(["b1", "b2", "b3", "b4"]);
  });

  it("reads nothing from unreadable or non-object values", () => {
    expect(readLocalReview(fakeStore())).toBeNull();
    expect(readLocalReview(fakeStore({ [LOCAL_REVIEW_KEY]: "{not json" }))).toBeNull();
    expect(readLocalReview(fakeStore({ [LOCAL_REVIEW_KEY]: "[1,2]" }))).toBeNull();
    expect(readLocalReview(fakeStore({ [LOCAL_REVIEW_KEY]: "null" }))).toBeNull();
  });

  it("clears the copy", () => {
    const store = fakeStore();
    writeLocalReview(review(), store);
    clearLocalReview(store);
    expect(readLocalReview(store)).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    expect(() => writeLocalReview(review(), blockedStore)).not.toThrow();
    expect(() => clearLocalReview(blockedStore)).not.toThrow();
    expect(readLocalReview(blockedStore)).toBeNull();
    expect(() => readLocalReview(null)).not.toThrow();
  });
});

describe("the review running on this device", () => {
  it("is seen until the run ends, and ignored once it is older than the limit", () => {
    const store = fakeStore();
    markReviewRunning(true, 1_000, store);
    expect(reviewRunningSince(1_000 + 5_000, store)).toBe(1_000);
    expect(reviewRunningSince(1_000 + REVIEW_RUNNING_MAX_MS, store)).toBeNull();
    markReviewRunning(false, 2_000, store);
    expect(store.data.has(REVIEW_RUNNING_KEY)).toBe(false);
    expect(reviewRunningSince(2_500, store)).toBeNull();
  });

  it("reads as not running when storage is blocked", () => {
    expect(() => markReviewRunning(true, 1_000, blockedStore)).not.toThrow();
    expect(reviewRunningSince(1_000, blockedStore)).toBeNull();
  });
});
