import { isMissingColumn, MIGRATION_HINT } from "./db";

/** POST to one of our API routes. Never throws; turns timeouts/HTML error pages into readable messages. */
export type ApiResult<T> = {
  data?: T;
  error?: string;
  /** Set when the intake API refuses a login-walled job board (e.g. "LinkedIn"); switch to the paste flow. */
  pasteOnly?: string;
};

export const NETWORK_MESSAGE = "Couldn't reach the server. Check your connection and try again.";
export const SERVER_DOWN_MESSAGE = "The server is having trouble right now. Try again in a minute.";
export const SIGNED_OUT_MESSAGE = "You've been signed out. Reload the page and sign in again.";
export const GENERIC_MESSAGE = "Something went wrong. Try again.";

/** Wording that means the request never reached the database/server (proxies, Safari, Node, Chrome, Firefox). */
const NETWORK_RE =
  /failed to fetch|load failed|networkerror|network request failed|fetch failed|upstream connect error|connection (?:refused|reset|terminated)|disconnect\/reset|econn|enotfound|etimedout|socket hang up|timed? ?out|aborted/i;
const SERVER_RE = /\b5\d\d\b|bad gateway|service unavailable|gateway time-?out|internal server error|<html|<!doctype/i;
const AUTH_RE = /jwt|not signed in|invalid refresh token|auth session missing|unauthori[sz]ed|\b401\b/i;

type ErrorLike = { message?: unknown; code?: unknown; status?: unknown; details?: unknown };

/** True when the error is a network failure rather than a refusal from the server. */
export function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error || (e && typeof e === "object") ? String((e as ErrorLike).message ?? "") : String(e ?? "");
  return NETWORK_RE.test(msg);
}

/**
 * A plain-language sentence for any error from Supabase, fetch or our API routes. Raw messages
 * ("upstream connect error or disconnect/reset before headers", Postgres codes, HTML) never reach the
 * page; they go to the console. Messages that are already friendly sentences we wrote pass through.
 * `fallback` says what failed ("Couldn't save your answers.") and is used for anything unrecognized.
 */
export function friendlyError(e: unknown, fallback = GENERIC_MESSAGE): string {
  if (e == null || e === "") return fallback;
  const obj = typeof e === "object" ? (e as ErrorLike) : null;
  const msg = typeof e === "string" ? e : String(obj?.message ?? "");
  if (obj && isMissingColumn(obj as { code?: string; message?: string })) return MIGRATION_HINT;
  if (NETWORK_RE.test(msg)) return NETWORK_MESSAGE;
  if (looksFriendly(msg)) return msg;
  if (AUTH_RE.test(msg) || obj?.status === 401) return SIGNED_OUT_MESSAGE;
  if (SERVER_RE.test(msg) || (typeof obj?.status === "number" && obj.status >= 500)) return SERVER_DOWN_MESSAGE;
  if (obj?.code === "PGRST116") return "That item no longer exists. It may have been deleted in another tab.";
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

export async function postApi<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      ...(body instanceof FormData ? { body } : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      if (typeof json?.error === "string" && json.error) {
        const fallback = res.status === 401 ? SIGNED_OUT_MESSAGE : res.status >= 500 ? SERVER_DOWN_MESSAGE : GENERIC_MESSAGE;
        return { error: friendlyError(json.error, fallback), ...(json.pasteOnly ? { pasteOnly: String(json.pasteOnly) } : {}) };
      }
      if (res.status === 504) return { error: "The AI took too long to respond. Try again in a moment." };
      if (res.status === 413) return { error: "That file is too large." };
      if (res.status === 401 || res.status === 403) return { error: SIGNED_OUT_MESSAGE };
      if (res.status >= 500) return { error: SERVER_DOWN_MESSAGE };
      return { error: `Something went wrong (error ${res.status}). Try again.` };
    }
    // A 200 that isn't JSON is usually a login page after the session expired.
    if (!json) return { error: "Your session may have expired. Reload the page and try again." };
    return { data: json as T };
  } catch {
    return { error: NETWORK_MESSAGE };
  }
}
