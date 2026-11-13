import type { Analysis, Fit } from "./types";
import { fitFromScore } from "./fit";

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const FITS: readonly Fit[] = ["strong", "possible", "stretch"];

function fitOfRaw(r: Record<string, unknown>): Fit {
  const f = str(r.fit).trim().toLowerCase();
  if ((FITS as string[]).includes(f)) return f as Fit;
  // Older analyses (and occasionally the model) give a 0-100 number instead of a bucket.
  const raw = r.fit_score;
  const score = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(score) ? fitFromScore(score) : "possible";
}

/** Coerce whatever the model (or an old stored row) returned into a complete Analysis so the UI never crashes on a missing field. */
export function normalizeAnalysis(raw: unknown): Analysis {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const kw = (r.keywords && typeof r.keywords === "object" ? r.keywords : {}) as Record<string, unknown>;
  const rating = (v: unknown): "strong" | "ok" | "weak" => (v === "strong" || v === "weak" ? v : "ok");
  const sev = (v: unknown): "high" | "medium" | "low" => (v === "high" || v === "low" ? v : "medium");
  const out: Analysis = {
    fit: fitOfRaw(r),
    verdict: str(r.verdict),
    keywords: { matched: arr<unknown>(kw.matched).map(str).filter(Boolean), missing: arr<unknown>(kw.missing).map(str).filter(Boolean) },
    strengths: arr<unknown>(r.strengths).map(str).filter(Boolean),
    gaps: arr<Record<string, unknown>>(r.gaps).map((g) => ({ issue: str(g?.issue), severity: sev(g?.severity), fix: str(g?.fix) })),
    bullets: arr<Record<string, unknown>>(r.bullets)
      .map((b) => ({
        bullet_id: str(b?.bullet_id).trim().replace(/^\[?b:/, "").replace(/\]$/, ""),
        rating: rating(b?.rating),
        note: str(b?.note),
        rewrite: str(b?.rewrite),
      }))
      .filter((b) => b.bullet_id),
    questions: arr<Record<string, unknown>>(r.questions)
      .map((q, i) => ({ id: str(q?.id) || `q${i}`, question: str(q?.question), why: str(q?.why) }))
      .filter((q) => q.question),
  };
  // Stored analyses carry user state; keep it when re-normalizing a saved row.
  if (r.answers && typeof r.answers === "object" && !Array.isArray(r.answers)) {
    out.answers = Object.fromEntries(Object.entries(r.answers as Record<string, unknown>).map(([k, v]) => [k, str(v)]));
  }
  if (Array.isArray(r.dismissed)) out.dismissed = r.dismissed.map(str).filter(Boolean);
  if (typeof r.analyzed_at === "string") out.analyzed_at = r.analyzed_at;
  return out;
}

/**
 * Combine a fresh model result with the job's previous analysis: questions the user already answered
 * (and their answers) carry over so they keep informing future runs, new questions get unique ids,
 * rejected rewrites are forgotten (the bullets were re-rated), and the run is timestamped.
 */
export function mergeAnalysis(prev: Analysis | null, fresh: Analysis, now: Date): Analysis {
  const answers = Object.fromEntries(Object.entries(prev?.answers ?? {}).filter(([, v]) => v?.trim()));
  const oldAnswered = (prev?.questions ?? []).filter((q) => answers[q.id]);
  const asked = new Set(oldAnswered.map((q) => q.question.trim().toLowerCase()));
  const stamp = now.getTime();
  return {
    ...fresh,
    questions: [
      ...oldAnswered,
      ...fresh.questions
        .filter((q) => !asked.has(q.question.trim().toLowerCase()))
        .map((q, i) => ({ ...q, id: `q${stamp}_${i}` })),
    ],
    answers,
    dismissed: [],
    analyzed_at: now.toISOString(),
  };
}
