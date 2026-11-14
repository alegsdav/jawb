import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { TokenUsage } from "./gemini";
import { isMissingRelation } from "./db";

/**
 * Per-student AI limits (migration 0004). Every AI route wraps its model call in `withAiBudget`:
 * it reserves a call (an atomic SQL function that refuses once the student is at their limit), runs
 * the call, then records how it ended. Failed calls don't count, so a provider outage doesn't use up
 * anyone's limit. Limits are rolling windows (the last 24 hours / the last 60 minutes), not calendar days.
 */

export type AiWeight = "heavy" | "light";

/**
 * What each AI action costs. The ONE table of weights: change a weight here and nowhere else.
 * - reanalyze: not decided by the product owner yet; heavy because it costs the same as the first run.
 * - cover_letter: not decided by the product owner yet; light by default.
 */
export const AI_WEIGHTS = {
  analyze: "heavy", // first analysis of a job
  reanalyze: "heavy", // any later analysis of the same job
  parse_resume: "heavy", // resume import (PDF or pasted text)
  builder_draft: "heavy", // "Build my resume" in the guided builder
  intake_meta: "light", // company/title/location from a pasted posting
  cover_letter: "light",
  coach_examples: "light",
  coach_questions: "light",
  extract_facts: "light",
} as const satisfies Record<string, AiWeight>;

export type AiAction = keyof typeof AI_WEIGHTS;

export type AiLimit = {
  limit: number;
  windowMs: number;
  /** The same window as a Postgres interval, for reserve_ai_call. */
  interval: string;
};

const HOUR = 60 * 60 * 1000;

const positiveInt = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/** Limits from env: AI_HEAVY_PER_DAY (default 10, rolling 24h) and AI_LIGHT_PER_HOUR (default 120, rolling 60 min). */
export function aiLimits(env: Record<string, string | undefined> = process.env): Record<AiWeight, AiLimit> {
  return {
    heavy: { limit: positiveInt(env.AI_HEAVY_PER_DAY, 10), windowMs: 24 * HOUR, interval: "24 hours" },
    light: { limit: positiveInt(env.AI_LIGHT_PER_HOUR, 120), windowMs: HOUR, interval: "60 minutes" },
  };
}

/** Thrown by withAiBudget when the student is at their limit (429) or usage can't be checked (503). */
export class AiBudgetError extends Error {
  constructor(
    message: string,
    readonly status: 429 | 503,
    readonly weight: AiWeight,
    readonly resetAt: string | null = null,
  ) {
    super(message);
    this.name = "AiBudgetError";
  }
}

export const USAGE_CHECK_MESSAGE = "Couldn't check your AI usage. Check your connection and try again.";

/** "about 3 hours", "about 25 minutes", "a minute or so". */
export function roughlyIn(ms: number): string {
  const min = Math.max(1, Math.ceil(ms / 60000));
  if (min < 2) return "in a minute or so";
  if (min < 60) return `in about ${min} minutes`;
  const h = Math.round(min / 60);
  return h <= 1 ? "in about an hour" : `in about ${h} hours`;
}

/**
 * The 429 message: which limit, and when it frees up. Worded differently from the AI provider's own
 * quota message (AI_LIMIT_MESSAGE), so a student can tell "my limit" from "the AI is down".
 */
export function limitMessage(weight: AiWeight, lim: AiLimit, resetAt: string | null, now = new Date()): string {
  const when = resetAt ? roughlyIn(Date.parse(resetAt) - now.getTime()) : "later";
  return weight === "heavy"
    ? `You've used all ${lim.limit} of your analyses for the last 24 hours (job analyses, resume imports and resume drafts count). The next one opens up ${when}.`
    : `You've reached your limit of ${lim.limit} quick AI actions per hour (coaching, cover letters and job details). More open up ${when}.`;
}

/**
 * When the next call of this weight frees up: rows are the student's counted calls in the window
 * (oldest first). Once `rows - limit + 1` of them age out there's room again.
 */
export function resetTime(createdAts: string[], lim: AiLimit): string | null {
  const sorted = [...createdAts].sort();
  const at = sorted.length - lim.limit;
  if (at < 0 || !sorted[at]) return null;
  return new Date(Date.parse(sorted[at]) + lim.windowMs).toISOString();
}

async function countedSince(supabase: SupabaseClient, since: Date, weight?: AiWeight) {
  let q = supabase.from("ai_usage").select("weight, created_at").in("status", ["pending", "ok"]).gt("created_at", since.toISOString());
  if (weight) q = q.eq("weight", weight);
  const { data, error } = await q.order("created_at", { ascending: true });
  return { rows: (data ?? []) as { weight: AiWeight; created_at: string }[], error };
}

/** Collects token counts from every model call made inside one budgeted call. */
export type Meter = { add: (u: TokenUsage) => void; readonly usage: Required<TokenUsage> };

const newMeter = (): Meter => {
  const usage: Required<TokenUsage> = { promptTokens: 0, outputTokens: 0, totalTokens: 0, model: "" };
  return {
    usage,
    add: (u) => {
      usage.promptTokens += u.promptTokens;
      usage.outputTokens += u.outputTokens;
      usage.totalTokens += u.totalTokens;
      if (u.model) usage.model = u.model;
    },
  };
};

let warnedMissing = false;

/**
 * Run one metered AI call. `fn` gets a Meter: pass `meter.add` as geminiJSON/geminiText's `onUsage`.
 * Throws AiBudgetError (429) when the student is at the limit for this action's weight; the call is
 * then never made. If fn throws, the reservation is marked failed (not counted) and the error rethrown.
 * Without migration 0004 the call runs unmetered (with a server warning) rather than breaking the app.
 */
export async function withAiBudget<T>(
  supabase: SupabaseClient,
  opts: { action: AiAction; now?: () => Date; env?: Record<string, string | undefined> },
  fn: (meter: Meter) => Promise<T>,
): Promise<T> {
  const weight: AiWeight = AI_WEIGHTS[opts.action];
  const lim = aiLimits(opts.env)[weight];
  const meter = newMeter();
  const { data: id, error } = await supabase.rpc("reserve_ai_call", {
    p_action: opts.action,
    p_weight: weight,
    p_limit: lim.limit,
    p_window: lim.interval,
  });
  if (error) {
    if (isMissingRelation(error)) {
      if (!warnedMissing) console.warn("AI usage limits are off: run supabase/migrations/0004_invites_usage.sql.");
      warnedMissing = true;
      return fn(meter);
    }
    console.error("reserve_ai_call failed:", error.message);
    throw new AiBudgetError(USAGE_CHECK_MESSAGE, 503, weight);
  }
  if (!id) {
    const now = opts.now?.() ?? new Date();
    const { rows } = await countedSince(supabase, new Date(now.getTime() - lim.windowMs), weight);
    const resetAt = resetTime(rows.map((r) => r.created_at), lim);
    throw new AiBudgetError(limitMessage(weight, lim, resetAt, now), 429, weight, resetAt);
  }
  let ok = false;
  try {
    const out = await fn(meter);
    ok = true;
    return out;
  } finally {
    const { promptTokens, outputTokens, totalTokens, model } = meter.usage;
    await Promise.resolve(
      supabase.rpc("finish_ai_call", {
        p_id: id,
        p_status: ok ? "ok" : "failed",
        p_prompt: promptTokens,
        p_output: outputTokens,
        p_total: totalTokens,
        p_model: model,
      }),
    ).then(
      (r) => r?.error && console.warn("finish_ai_call failed:", r.error.message),
      (e) => console.warn("finish_ai_call failed:", e),
    );
  }
}

/** The JSON response for an AiBudgetError (null for any other error, which the route handles itself). */
export function budgetErrorResponse(e: unknown): NextResponse | null {
  if (!(e instanceof AiBudgetError)) return null;
  return NextResponse.json(
    { error: e.message, ...(e.status === 429 ? { limit: e.weight, resetAt: e.resetAt } : {}) },
    { status: e.status },
  );
}

export type UsageBucket = { used: number; limit: number; remaining: number; resetAt: string | null };
export type UsageSummary = { available: true; heavy: UsageBucket; light: UsageBucket } | { available: false };

/** What GET /api/usage returns: counted calls per weight in each rolling window. */
export async function usageSummary(
  supabase: SupabaseClient,
  now = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<UsageSummary> {
  const limits = aiLimits(env);
  const longest = Math.max(limits.heavy.windowMs, limits.light.windowMs);
  const { rows, error } = await countedSince(supabase, new Date(now.getTime() - longest));
  if (error) {
    if (isMissingRelation(error)) return { available: false };
    throw error;
  }
  const bucket = (weight: AiWeight): UsageBucket => {
    const lim = limits[weight];
    const since = now.getTime() - lim.windowMs;
    const times = rows.filter((r) => r.weight === weight && Date.parse(r.created_at) > since).map((r) => r.created_at);
    return {
      used: times.length,
      limit: lim.limit,
      remaining: Math.max(0, lim.limit - times.length),
      resetAt: times.length >= lim.limit ? resetTime(times, lim) : null,
    };
  };
  return { available: true, heavy: bucket("heavy"), light: bucket("light") };
}
