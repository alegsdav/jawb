/** POST to one of our API routes. Never throws; turns timeouts/HTML error pages into readable messages. */
export async function postApi<T>(path: string, body: unknown): Promise<{ data?: T; error?: string }> {
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
      if (json?.error) return { error: String(json.error) };
      if (res.status === 504) return { error: "The AI took too long to respond. Try again in a moment." };
      if (res.status === 413) return { error: "That file is too large." };
      return { error: `Request failed (HTTP ${res.status}).` };
    }
    return { data: (json ?? {}) as T };
  } catch {
    return { error: "Network error. Check your connection and try again." };
  }
}
