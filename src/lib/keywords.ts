/**
 * Keyword matching for the job Overview's pills: does the resume's text contain a posting keyword?
 *
 * Pure functions, no React. The pills are red or green from a live scan of the resume; the AI's own
 * matched/missing lists only supply the keywords and their order.
 */

/** Characters that belong to a token: letters, digits, and "+" and "#" (C++, C#). */
const TOKEN_CHARS = "\\p{L}\\p{N}+#";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The regex for one keyword, or null when it has no words.
 *
 * - Words are joined by any run of whitespace or hyphens, so "machine learning" matches "Machine-Learning".
 * - Case-insensitive (the "i" flag, with "u" so \p{L} and \p{N} work on any script).
 * - Token boundaries: the text just before and just after the match must not be a token character. A "."
 *   counts as part of a token only when a letter or digit follows it ("Node.js", ".NET"), so a sentence period
 *   after a word ("Python.") still lets the word match. That is why "C" does not match "C++" or "C#",
 *   "Java" does not match "JavaScript", and "Go" does not match "Google".
 * - A plain plural is allowed after a keyword that ends in a letter: "API" matches "APIs", "dashboard"
 *   matches "dashboards", "class" matches "classes".
 */
function keywordRegExp(keyword: string): RegExp | null {
  const words = keyword.trim().split(/[\s-]+/).filter(Boolean);
  if (!words.length) return null;
  const body = words.map(escapeRegExp).join("[\\s\\-]+");
  const endsInLetter = /[\p{L}\p{N}]$/u.test(words[words.length - 1]);
  const plural = endsInLetter ? "(?:e?s)?" : "";
  // Before: not a token character, and not a "." that belongs to a token (".NET" after "ASP" is "ASP.NET").
  // After: not a token character, and not a "." followed by a letter or digit ("Node" does not match "Node.js").
  return new RegExp(
    `(?<![${TOKEN_CHARS}.])${body}${plural}(?![${TOKEN_CHARS}]|\\.[\\p{L}\\p{N}])`,
    "iu",
  );
}

/** True when `text` contains `keyword` as a whole term (see keywordRegExp for the rules). */
export function keywordInText(keyword: string, text: string): boolean {
  const re = keywordRegExp(keyword);
  return re ? re.test(text) : false;
}

/**
 * The AI's "matched" keywords that a literal scan of `resumeText` does not find. These were matched by
 * meaning ("Data analysis" from "analyzed datasets"), so they stay green rather than flipping to red as the
 * page loads. Compute this once per analysis, not on every edit.
 */
export function meaningMatches(matched: string[], resumeText: string): Set<string> {
  return new Set(matched.filter((k) => !keywordInText(k, resumeText)));
}

export type LiveKeyword = {
  keyword: string;
  /** Which of the AI's lists the keyword came from. It doesn't change when the pill's colour does. */
  group: "missing" | "matched";
  /** True: the pill is green (on the resume). False: red (missing). */
  found: boolean;
};

/**
 * Every keyword of an analysis with its live status, in a stable order: the AI's "missing" keywords first,
 * then its "matched" ones, each in the order the analysis gave. A pill keeps its place when it changes colour.
 * A keyword is found when the resume text contains it or it is in `alwaysMatched` (see meaningMatches).
 */
export function liveKeywords(
  keywords: { matched: string[]; missing: string[] },
  resumeText: string,
  alwaysMatched: ReadonlySet<string>,
): LiveKeyword[] {
  const status = (keyword: string) => keywordInText(keyword, resumeText) || alwaysMatched.has(keyword);
  return [
    ...keywords.missing.map((keyword) => ({ keyword, group: "missing" as const, found: status(keyword) })),
    ...keywords.matched.map((keyword) => ({ keyword, group: "matched" as const, found: status(keyword) })),
  ];
}
