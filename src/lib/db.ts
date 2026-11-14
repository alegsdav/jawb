/**
 * Database helpers and every plain-language error sentence the app shows. `friendlyError` (any error:
 * Supabase, fetch, our API routes) and `dbErrorMessage` (a Supabase failure, worded for what was being
 * done) live here together so they always say the same thing. `@/lib/api` re-exports friendlyError.
 */

/** Postgres/PostgREST errors meaning migration 0002 hasn't been applied (a new column is missing). */
export const isMissingColumn = (e: { code?: string; message?: string } | null | undefined) =>
  !!e &&
  (e.code === "42703" || e.code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(e.message ?? ""));

/**
 * A table or function that doesn't exist yet (a migration after 0003 hasn't been run): Postgres
 * "undefined table/function" or PostgREST "not in the schema cache".
 */
export const isMissingRelation = (e: { code?: string; message?: string } | null | undefined) =>
  !!e &&
  (e.code === "42P01" ||
    e.code === "42883" ||
    e.code === "PGRST202" ||
    e.code === "PGRST205" ||
    /(?:relation|function) .* does not exist|could not find the (?:table|function)/i.test(e.message ?? ""));

/** Unique-constraint violation (e.g. a second tab created the same master/tailored row first). */
export const isUniqueViolation = (e: { code?: string } | null | undefined) => e?.code === "23505";

export const MIGRATION_HINT =
  "Database update needed: run the files in supabase/migrations/ you haven't run yet (0002 to 0006) in your Supabase SQL editor.";

/** Columns added by migration 0002; strip them from writes when the migration is missing. */
export const MIGRATION_0002_COLUMNS = ["deadline", "submitted_resume", "submitted_at", "submitted_tailored"] as const;

/** Columns added by migration 0006 (tailoring progress for the dashboard). */
export const MIGRATION_0006_COLUMNS = ["suggestions_total", "suggestions_pending"] as const;

/** Every job column added after 0001; strip these from writes/selects when a migration is missing. */
export const OPTIONAL_JOB_COLUMNS = [...MIGRATION_0002_COLUMNS, "reached_interview", ...MIGRATION_0006_COLUMNS] as const;

// ---------- plain-language errors ----------

export const NETWORK_MESSAGE = "Couldn't reach the server. Check your connection and try again.";
export const SERVER_DOWN_MESSAGE = "The server is having trouble right now. Try again in a minute.";
export const SIGNED_OUT_MESSAGE = "You've been signed out. Reload the page and sign in again.";
export const NOT_PERMITTED_MESSAGE = "This account can't change that. Reload the page and sign in again.";
export const GONE_MESSAGE = "That item no longer exists. It may have been deleted in another tab.";
export const GENERIC_MESSAGE = "Something went wrong. Try again.";

/** Wording that means the request never reached the database/server (proxies, Safari, Node, Chrome, Firefox). */
const NETWORK_RE =
  /failed to fetch|load failed|networkerror|network request failed|fetch failed|upstream connect error|connection (?:refused|reset|terminated)|disconnect\/reset|econn|enotfound|etimedout|socket hang up|timed? ?out|aborted/i;
const SERVER_RE = /\b5\d\d\b|bad gateway|service unavailable|gateway time-?out|internal server error|<html|<!doctype/i;
const AUTH_RE = /jwt|not signed in|not authenticated|invalid refresh token|auth session missing|unauthori[sz]ed|token.*expired|\b401\b/i;

type ErrorLike = { message?: unknown; code?: unknown; status?: unknown; details?: unknown };

const messageOf = (e: unknown) =>
  typeof e === "string" ? e : e && typeof e === "object" ? String((e as ErrorLike).message ?? "") : "";

/** Signed out, from a Supabase error's code or status, or the message. */
const isSignedOut = (obj: ErrorLike | null, msg: string) =>
  obj?.code === "PGRST301" || obj?.code === "PGRST302" || obj?.status === 401 || AUTH_RE.test(msg);

/**
 * A plain-language sentence for any error from Supabase, fetch or our API routes. Raw messages
 * ("upstream connect error or disconnect/reset before headers", Postgres codes, HTML) never reach the
 * page; they go to the console. Messages that are already friendly sentences we wrote pass through.
 * `fallback` says what failed ("Couldn't save your answers.") and is used for anything unrecognized.
 */
export function friendlyError(e: unknown, fallback = GENERIC_MESSAGE): string {
  if (e == null || e === "") return fallback;
  const obj = typeof e === "object" ? (e as ErrorLike) : null;
  const msg = messageOf(e);
  if (obj && isMissingColumn(obj as { code?: string; message?: string })) return MIGRATION_HINT;
  if (NETWORK_RE.test(msg)) return NETWORK_MESSAGE;
  // Before looksFriendly: Supabase's "Auth session missing!" reads like a sentence but isn't ours.
  if (isSignedOut(obj, msg)) return SIGNED_OUT_MESSAGE;
  if (looksFriendly(msg)) return msg;
  if (SERVER_RE.test(msg) || (typeof obj?.status === "number" && obj.status >= 500)) return SERVER_DOWN_MESSAGE;
  if (obj?.code === "PGRST116") return GONE_MESSAGE;
  if (msg) console.warn("Unrecognized error shown as fallback:", e);
  return fallback;
}

/**
 * A message we wrote ourselves: a short sentence that starts with a capital and ends with "." / "!" / "?"
 * and carries no machine detail (codes, JSON, stack traces, snake_case or HTTP jargon).
 */
function looksFriendly(msg: string): boolean {
  const m = msg.trim();
  if (!m || m.length > 240) return false;
  if (!/^[A-Z"']/.test(m) || !/[.!?)"']$/.test(m)) return false;
  return !/[{}<>]|\b[a-z]+_[a-z_]+\b|\bat \w+ \(|PGRST|\b[0-9A-F]{5}\b|violates|constraint|relation "|syntax error|undefined|null\b|TypeError|Error:/.test(m);
}

type DbError = { code?: string; message?: string; status?: number; name?: string } | null | undefined;

/**
 * A plain sentence for a Supabase/PostgREST/network failure, worded for what was being done. Never
 * shows raw backend text. `action`: "autosave" (it retries by itself), "save" (a one-off action) or
 * "load". Missing migrations and sign-outs read the same as in friendlyError.
 */
export function dbErrorMessage(e: DbError, action: "autosave" | "save" | "load" = "autosave"): string {
  if (isMissingColumn(e)) return MIGRATION_HINT;
  if (isSignedOut(e ?? null, e?.message ?? "")) return SIGNED_OUT_MESSAGE;
  if (e?.code === "42501" || e?.status === 403) return NOT_PERMITTED_MESSAGE;
  if (action === "load") return "Couldn't load your data. Check your connection and reload the page.";
  if (action === "save") return "Couldn't save. Check your connection and try again.";
  return "Couldn't save. Check your connection; we'll keep retrying.";
}
