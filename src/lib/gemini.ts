import "server-only";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

/** Call Gemini and parse a JSON response. Throws with a readable message on failure. */
export async function geminiJSON<T>(prompt: string, opts: { temperature?: number } = {}): Promise<T> {
  const text = await geminiText(prompt, { ...opts, json: true });
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new Error("The AI returned malformed JSON. Try again.");
  }
}

export async function geminiText(
  prompt: string,
  opts: { temperature?: number; json?: boolean } = {},
): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set on the server.");
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: opts.temperature ?? 0.3,
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini error ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const out = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  if (!out) throw new Error("Gemini returned an empty response.");
  return out;
}
