/**
 * Call Gemini and get JSON back. Retries on 429/5xx.
 *
 *   const out = await geminiJson<MyType>({ prompt, images: [{ mimeType, base64 }] });
 */

export interface GeminiImage {
  mimeType: string;
  base64: string;
}

export interface GeminiJsonOptions {
  prompt: string;
  images?: GeminiImage[];
  model?: string;          // default gemini-2.5-flash (vision-capable)
  temperature?: number;
  maxOutputTokens?: number;
}

export async function geminiJson<T = unknown>(opts: GeminiJsonOptions): Promise<T> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  const model = opts.model || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  const parts: Record<string, unknown>[] = [{ text: opts.prompt }];
  for (const img of opts.images || []) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
  }
  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
      responseMimeType: "application/json",
    },
  });

  let res: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    if (res.ok || (res.status !== 429 && res.status < 500)) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  if (!res || !res.ok) {
    const detail = res ? await res.text().catch(() => "") : "no response";
    throw new Error(`Gemini ${res?.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const text: string = (data?.candidates?.[0]?.content?.parts || [])
    .map((p: { text?: string }) => p.text || "").join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    // Strip code fences if the model added them anyway
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    return JSON.parse(cleaned) as T;
  }
}

/** Download an image and return it base64-encoded, or null if it can't be read. */
export async function fetchImageBase64(url: string, maxBytes = 6 * 1024 * 1024): Promise<GeminiImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mimeType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!mimeType.startsWith("image/")) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > maxBytes) return null;
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { mimeType, base64: btoa(bin) };
  } catch {
    return null;
  }
}
