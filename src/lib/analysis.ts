import type { Analysis } from "./types";

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Coerce whatever the model returned into a complete Analysis so the UI never crashes on a missing field. */
export function normalizeAnalysis(raw: unknown): Analysis {
  const r = (raw ?? {}) as Record<string, unknown>;
  const kw = (r.keywords ?? {}) as Record<string, unknown>;
  const score = Number(r.fit_score);
  const rating = (v: unknown): "strong" | "ok" | "weak" => (v === "strong" || v === "weak" ? v : "ok");
  const sev = (v: unknown): "high" | "medium" | "low" => (v === "high" || v === "low" ? v : "medium");
  return {
    fit_score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    verdict: str(r.verdict),
    keywords: { matched: arr<unknown>(kw.matched).map(str), missing: arr<unknown>(kw.missing).map(str) },
    strengths: arr<unknown>(r.strengths).map(str).filter(Boolean),
    gaps: arr<Record<string, unknown>>(r.gaps).map((g) => ({ issue: str(g?.issue), severity: sev(g?.severity), fix: str(g?.fix) })),
    bullets: arr<Record<string, unknown>>(r.bullets)
      .map((b) => ({
        bullet_id: str(b?.bullet_id).replace(/^b:/, ""),
        rating: rating(b?.rating),
        note: str(b?.note),
        rewrite: str(b?.rewrite),
      }))
      .filter((b) => b.bullet_id),
    bank_suggestions: arr<Record<string, unknown>>(r.bank_suggestions)
      .map((b) => ({ bank_id: str(b?.bank_id).replace(/^bank:/, ""), reason: str(b?.reason) }))
      .filter((b) => b.bank_id),
    questions: arr<Record<string, unknown>>(r.questions)
      .map((q, i) => ({ id: str(q?.id) || `q${i}`, question: str(q?.question), why: str(q?.why) }))
      .filter((q) => q.question),
  };
}
