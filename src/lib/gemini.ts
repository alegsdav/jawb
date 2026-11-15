import "server-only";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

/** Token counts from a response's `usageMetadata` (0 when the API leaves a field out), and the model that answered. */
export type TokenUsage = { promptTokens: number; outputTokens: number; totalTokens: number; model?: string };

/** Read `usageMetadata` (promptTokenCount, candidatesTokenCount, totalTokenCount) from a Gemini response body. */
export function readUsage(data: unknown, model = MODEL): TokenUsage {
  const d = (data ?? {}) as { usageMetadata?: Record<string, unknown>; modelVersion?: unknown };
  const u = d.usageMetadata ?? {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  const promptTokens = n(u.promptTokenCount);
  const outputTokens = n(u.candidatesTokenCount);
  return {
    promptTokens,
    outputTokens,
    totalTokens: n(u.totalTokenCount) || promptTokens + outputTokens,
    model: typeof d.modelVersion === "string" && d.modelVersion ? d.modelVersion : model,
  };
}

export const AI_LIMIT_MESSAGE = "The AI's daily limit was reached. Try again later.";
export const AI_DOWN_MESSAGE = "The AI service is having trouble. Try again in a minute.";
export const AI_KEY_MESSAGE = "The Gemini API key isn't valid. Check GEMINI_API_KEY in Vercel.";

/**
 * A short, user-facing message for a failed Gemini call. Raw response bodies only go to the server
 * log (they can be long JSON and mention internals); the browser gets one of these sentences.
 */
export function friendlyGeminiError(status: number, body = "", model = MODEL): string {
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(body)) return AI_LIMIT_MESSAGE;
  if (
    (status === 400 || status === 401 || status === 403) &&
    /API[_ ]?KEY|API key|UNAUTHENTICATED|PERMISSION_DENIED/i.test(body)
  ) {
    return AI_KEY_MESSAGE;
  }
  if (status === 404) {
    return `The Gemini model "${model}" isn't available to your API key. Set GEMINI_MODEL in Vercel to a current model and redeploy.`;
  }
  if (status >= 500 || /overloaded|UNAVAILABLE/i.test(body)) return AI_DOWN_MESSAGE;
  return `The AI request failed (error ${status}). Try again in a minute.`;
}

export type GeminiFile = { mimeType: string; data: string /* base64 */ };

export type GeminiOptions = {
  temperature?: number;
  files?: GeminiFile[];
  /** Called with the response's token counts once it arrives (for AI usage metering, see aiBudget.ts). */
  onUsage?: (usage: TokenUsage) => void;
};

/** Call Gemini and parse a JSON response. Throws with a readable message on failure. */
export async function geminiJSON<T>(prompt: string, opts: GeminiOptions = {}): Promise<T> {
  const text = await geminiText(prompt, { ...opts, json: true });
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Some models add prose around the JSON; fall back to the outermost {...}.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    console.error("Gemini returned non-JSON:", cleaned.slice(0, 500));
    throw new Error("The AI returned malformed JSON. Try again.");
  }
}

export async function geminiText(prompt: string, opts: GeminiOptions & { json?: boolean } = {}): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set on the server. Add it in Vercel and redeploy.");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            // Gemini reads PDFs natively (text and layout), so files go in as inline data.
            parts: [...(opts.files ?? []).map((f) => ({ inline_data: { mime_type: f.mimeType, data: f.data } })), { text: prompt }],
          },
        ],
        generationConfig: {
          temperature: opts.temperature ?? 0.3,
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    },
  ).catch((e) => {
    console.error("Gemini request failed:", e);
    throw new Error("Couldn't reach the AI service. Try again in a minute.");
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Gemini error", res.status, MODEL, body.slice(0, 2000));
    throw new Error(friendlyGeminiError(res.status, body));
  }
  const data = await res.json();
  opts.onUsage?.(readUsage(data));
  const out = data?.candidates?.[0]?.content?.parts
    ?.filter((p: { thought?: boolean }) => !p.thought) // skip thinking-model thought summaries
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!out) {
    const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? "unknown";
    console.error("Gemini empty response", JSON.stringify(data).slice(0, 500));
    throw new Error(`The AI returned an empty answer (${String(reason).toLowerCase()}). Try again.`);
  }
  return out;
}
