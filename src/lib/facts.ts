import type { Resume } from "./types";

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/** Append facts to a (master) resume, skipping blanks and case/whitespace-insensitive duplicates. */
export function addFacts(r: Resume, facts: string[]): Resume {
  const existing = r.facts ?? [];
  const seen = new Set(existing.map(norm));
  const fresh: string[] = [];
  for (const f of facts.map((x) => x.trim()).filter(Boolean)) {
    const k = norm(f);
    if (!seen.has(k)) {
      seen.add(k);
      fresh.push(f);
    }
  }
  return fresh.length ? { ...r, facts: [...existing, ...fresh] } : r;
}

/** Bracketed placeholders the AI leaves for numbers it doesn't know, e.g. "[X hrs]". */
export const PLACEHOLDER_RE = /\[[^\]\n]+\]/g;
export const hasPlaceholder = (text: string) => /\[[^\]\n]+\]/.test(text);
export const countPlaceholders = (texts: string[]) =>
  texts.reduce((n, t) => n + (t.match(PLACEHOLDER_RE)?.length ?? 0), 0);
