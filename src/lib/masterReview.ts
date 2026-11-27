/**
 * Client-side helpers for the master resume's review (the page and its Overview use them). Pure where possible:
 * the storage is passed in, so the tests can use a fake one.
 */
import { bulletTextMap } from "./resume";
import { normalizeMasterAnalysis, type BulletFeedback } from "./analysis";
import type { MasterAnalysis, Resume } from "./types";

/** The review kept on this device: used when the account has no review column yet, or a save there failed. */
export const LOCAL_REVIEW_KEY = "jawb_master_review";
/** Set while this device runs a review (a page opened meanwhile waits for it, like a job's analysis). */
export const REVIEW_RUNNING_KEY = "jawb:analyzing:master";
/** Longer than a review takes; an older mark is from a run that never finished. */
export const REVIEW_RUNNING_MAX_MS = 3 * 60_000;

type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** This browser's localStorage, or null where it is blocked (private mode, disabled storage). */
export function browserStorage(): KeyValue | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** The review stored on this device, or null (none, unreadable, or storage blocked). */
export function readLocalReview(store: KeyValue | null = browserStorage()): MasterAnalysis | null {
  try {
    const raw = store?.getItem(LOCAL_REVIEW_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? normalizeMasterAnalysis(parsed) : null;
  } catch {
    return null;
  }
}

/** Keeps a copy of the review on this device. A blocked storage just means the copy is not kept. */
export function writeLocalReview(review: MasterAnalysis, store: KeyValue | null = browserStorage()): void {
  try {
    store?.setItem(LOCAL_REVIEW_KEY, JSON.stringify(review));
  } catch {
    // Storage full or blocked: the review still shows on this page.
  }
}

export function clearLocalReview(store: KeyValue | null = browserStorage()): void {
  try {
    store?.removeItem(LOCAL_REVIEW_KEY);
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

/** When this device started a review that may still be running, or null. */
export function reviewRunningSince(now = Date.now(), store: KeyValue | null = browserStorage()): number | null {
  try {
    const at = Number(store?.getItem(REVIEW_RUNNING_KEY));
    return at > 0 && now - at < REVIEW_RUNNING_MAX_MS ? at : null;
  } catch {
    return null;
  }
}

export function markReviewRunning(running: boolean, now = Date.now(), store: KeyValue | null = browserStorage()): void {
  try {
    if (running) store?.setItem(REVIEW_RUNNING_KEY, String(now));
    else store?.removeItem(REVIEW_RUNNING_KEY);
  } catch {
    // Storage blocked: a reopened page may start a second run, as a job's analysis does.
  }
}

/** A bullet in the Overview's "weakest first" list. */
export type WeakBullet = { id: string; text: string; rating: "weak" | "ok"; note: string };

/**
 * The review's weakest bullets, in the review's order, with their current text. Left out: bullets that are no
 * longer on the resume, and bullets whose feedback no longer applies (edited since they were rated, or the
 * suggested rewrite was accepted, so the old rating is for the old wording).
 */
export function weakestBullets(
  review: MasterAnalysis | null,
  resume: Resume | null,
  feedback: Record<string, BulletFeedback>,
): WeakBullet[] {
  if (!review || !resume) return [];
  const texts = bulletTextMap(resume);
  const out: WeakBullet[] = [];
  for (const id of review.weakest) {
    const text = texts.get(id);
    const fb = feedback[id];
    if (text === undefined || !fb || fb.state !== "current") continue;
    if (fb.rating !== "weak" && fb.rating !== "ok") continue;
    out.push({ id, text, rating: fb.rating, note: fb.note });
  }
  return out;
}

/** The answers that differ between two sets, for PATCH: a changed answer by its text, a cleared one as "" (the server removes it). */
export function answerChanges(
  prev: Record<string, string> | undefined,
  next: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of new Set([...Object.keys(prev ?? {}), ...Object.keys(next ?? {})])) {
    const before = (prev?.[id] ?? "").trim();
    const after = (next?.[id] ?? "").trim();
    if (before !== after) out[id] = after;
  }
  return out;
}

/** The body of a PATCH to the review route (see src/app/api/analyze-master/route.ts). */
export type ReviewPatch = { answers?: Record<string, string>; dismissed?: string[] };
