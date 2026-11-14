import { friendlyError, GENERIC_MESSAGE, NETWORK_MESSAGE, SERVER_DOWN_MESSAGE, SIGNED_OUT_MESSAGE } from "./db";

// Error wording lives in db.ts (shared with dbErrorMessage); re-exported here for existing imports.
export { friendlyError, GENERIC_MESSAGE, NETWORK_MESSAGE, SERVER_DOWN_MESSAGE, SIGNED_OUT_MESSAGE } from "./db";

/** POST to one of our API routes. Never throws; turns timeouts/HTML error pages into readable messages. */
export type ApiResult<T> = {
  data?: T;
  error?: string;
  /** Set when the intake API refuses a login-walled job board (e.g. "LinkedIn"); switch to the paste flow. */
  pasteOnly?: string;
  /** Set when the intake API found this job already on the list (resend with `force: true` to add it anyway). */
  duplicate?: { id: string; created_at: string };
};

/** Fired on `window` after any POST to our API, so the AI usage meter can refresh itself. */
export const API_CALLED_EVENT = "jp:api-called";

export async function postApi<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    return await readApi<T>(
      await fetch(path, {
        method: "POST",
        ...(body instanceof FormData ? { body } : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
      }),
    );
  } catch {
    return { error: NETWORK_MESSAGE };
  } finally {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(API_CALLED_EVENT));
  }
}

/** GET one of our API routes. Never throws (same error handling as postApi). */
export async function getApi<T>(path: string): Promise<ApiResult<T>> {
  try {
    return await readApi<T>(await fetch(path, { cache: "no-store" }));
  } catch {
    return { error: NETWORK_MESSAGE };
  }
}

async function readApi<T>(res: Response): Promise<ApiResult<T>> {
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
      const dup = json.duplicate as { id?: unknown; created_at?: unknown } | undefined;
      return {
        error: friendlyError(json.error, fallback),
        ...(json.pasteOnly ? { pasteOnly: String(json.pasteOnly) } : {}),
        ...(dup && typeof dup.id === "string" ? { duplicate: { id: dup.id, created_at: String(dup.created_at ?? "") } } : {}),
      };
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
}
