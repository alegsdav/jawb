import type { Analysis } from "./types";

export function formatAnswers(a: Analysis | null | undefined): string {
  if (!a?.answers) return "";
  return a.questions
    .filter((q) => a.answers?.[q.id]?.trim())
    .map((q) => `Q: ${q.question}\nA: ${a.answers![q.id]}`)
    .join("\n\n");
}
