import type { Fit } from "./types";

export const FIT_LABEL: Record<Fit, string> = { strong: "Strong fit", possible: "Possible fit", stretch: "Stretch" };

/** Map a legacy 0-100 score to a bucket. */
export function fitFromScore(score: number): Fit {
  return score >= 75 ? "strong" : score >= 50 ? "possible" : "stretch";
}

/** Fit for any stored analysis, including old ones that only have fit_score. */
export function fitOf(a: { fit?: Fit; fit_score?: number } | null | undefined): Fit | null {
  if (!a) return null;
  if (a.fit === "strong" || a.fit === "possible" || a.fit === "stretch") return a.fit;
  return typeof a.fit_score === "number" ? fitFromScore(a.fit_score) : null;
}
