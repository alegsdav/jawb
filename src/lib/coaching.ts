import { guardNumbers, knownNumbers } from "./analysis";
import { freshFacts, hasPlaceholder } from "./facts";

/**
 * Coaching logic that runs on the server and in tests (no React, no Supabase): checking what the AI
 * returns before any of it is saved or shown.
 */

const MAX_EXTRACTED = 6;

/**
 * The extracted facts worth saving from a model reply (`{ facts: string[] }`): strings only, trimmed,
 * at most 6, no duplicates, no [placeholders], and no fact the number guard would change when the
 * student's answer is its only source (a number, or number word, the answer doesn't state). `dropped`
 * counts facts thrown away by the guard.
 */
export function checkExtractedFacts(raw: unknown, answer: string): { kept: string[]; dropped: number } {
  const r = raw as { facts?: unknown } | unknown[] | null;
  const list = Array.isArray(r) ? r : Array.isArray((r as { facts?: unknown } | null)?.facts) ? ((r as { facts: unknown[] }).facts) : [];
  const known = knownNumbers([answer]);
  const kept: string[] = [];
  let dropped = 0;
  for (const item of list) {
    if (typeof item !== "string") continue;
    const t = item.replace(/\s+/g, " ").trim();
    if (!t || hasPlaceholder(t)) continue;
    if (guardNumbers(t, known).text !== t) {
      dropped++;
      continue;
    }
    kept.push(t);
  }
  return { kept: freshFacts(kept.map((text) => ({ text })), []).map((f) => f.text).slice(0, MAX_EXTRACTED), dropped };
}
