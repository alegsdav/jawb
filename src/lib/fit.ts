import type { Fit } from "./types";

export const FIT_LABEL: Record<Fit, string> = { strong: "Strong fit", possible: "Possible fit", stretch: "Stretch" };

/** Map a legacy 0-100 score to a bucket. */
export function fitFromScore(score: number): Fit {
  return score >= 75 ? "strong" : score >= 50 ? "possible" : "stretch";
}
