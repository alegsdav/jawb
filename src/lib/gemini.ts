import "server-only";

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

/** Call Gemini and parse a JSON response. Throws with a readable message on failure. */
export type GeminiFile = { mimeType: string; data: string /* base64 */ };

export async function geminiJSON<T>(
  prompt: string,
  opts: { temperature?: number; files?: GeminiFile[] } = {},
): Promise<T> {
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

export async function geminiText(
  prompt: string,
  opts: { temperature?: number; json?: boolean; files?: GeminiFile[] } = {},
): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set on the server.");
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
  );
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404) {
      throw new Error(
        `Gemini model "${MODEL}" isn't available to your API key. Set GEMINI_MODEL in Vercel to a current model and redeploy. Google said: ${body.slice(0, 200)}`,
      );
    }
    console.error("Gemini error", res.status, body.slice(0, 500));
    throw new Error(`Gemini error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const out = data?.candidates?.[0]?.content?.parts
    ?.filter((p: { thought?: boolean }) => !p.thought) // skip thinking-model thought summaries
    .map((p: { text?: string }) => p.text ?? "")
    .join("");
  if (!out) {
    const reason = data?.candidates?.[0]?.finishReason ?? data?.promptFeedback?.blockReason ?? "unknown";
    console.error("Gemini empty response", JSON.stringify(data).slice(0, 500));
    throw new Error(`Gemini returned an empty response (reason: ${reason}).`);
  }
  return out;
}
