/**
 * Conservative screening for public rental inquiries.
 *
 * It intentionally only rejects high-confidence garbage. A borderline or an
 * unavailable AI provider is allowed through so real applicants are never
 * blocked by this anti-spam layer.
 */

export interface InquiryScreeningResult {
  allowed: boolean;
  reason?: "gibberish";
  source: "heuristic" | "openrouter" | "unavailable";
}

const NARRATIVE_FIELDS = [
  "coliving_experience",
  "life_focus",
  "visiting_guide_response",
  "desired_timeframe",
  "pets",
  "referral_source",
] as const;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function caseTransitions(value: string): number {
  let transitions = 0;
  for (let i = 1; i < value.length; i++) {
    if (/[A-Za-z]/.test(value[i - 1]) && /[A-Za-z]/.test(value[i])
      && (value[i - 1] === value[i - 1].toUpperCase()) !== (value[i] === value[i].toUpperCase())) {
      transitions++;
    }
  }
  return transitions;
}

/** Catches machine-generated tokens without imposing an English-language test. */
export function hasObviousGibberish(person: Record<string, unknown>): boolean {
  const firstName = clean(person.first_name);
  const lastName = clean(person.last_name);
  const values = [firstName, lastName, ...NARRATIVE_FIELDS.map((field) => clean(person[field]))];

  for (const value of values) {
    // A long unbroken alphabetic run is not a meaningful form response.
    if (/\b[A-Za-z]{32,}\b/.test(value)) return true;
    // Randomized-case letter strings are a particularly reliable bot signal.
    if (/^[A-Za-z]{18,}$/.test(value) && caseTransitions(value) >= 4) return true;
    if (/(.)\1{9,}/i.test(value)) return true;
  }

  // Split name fields can evade the individual-token rule, as in the reported
  // submission. Normal names do not repeatedly alternate case mid-word.
  const fullName = `${firstName}${lastName}`;
  return /^[A-Za-z]{28,}$/.test(fullName) && caseTransitions(fullName) >= 6;
}

function textForModel(person: Record<string, unknown>): string {
  return [
    `Name: ${clean(person.first_name)} ${clean(person.last_name)}`,
    ...NARRATIVE_FIELDS.map((field) => `${field}: ${clean(person[field])}`),
  ].join("\n").slice(0, 5000);
}

/**
 * OpenRouter is advisory and is only allowed to reject at very high confidence.
 * Contact details and DOB are deliberately excluded from the model prompt.
 */
async function classifyWithOpenRouter(person: Record<string, unknown>): Promise<InquiryScreeningResult> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return { allowed: true, source: "unavailable" };

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://alpacaplayhouse.com",
        "X-Title": "Alpaca Playhouse inquiry spam screening",
      },
      signal: AbortSignal.timeout(3500),
      body: JSON.stringify({
        model: "deepseek/deepseek-v4-flash",
        temperature: 0,
        max_tokens: 80,
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: `Assess whether this housing inquiry text is clearly machine-generated gibberish or a meaningful human response. Do not judge writing quality, grammar, language, or whether the applicant is a good fit. Return ONLY JSON: {"verdict":"gibberish"|"meaningful"|"uncertain","confidence":0..1}. Mark gibberish only for nonsense/token-like text; ordinary short or multilingual answers are meaningful or uncertain.\n\n${textForModel(person)}`,
        }],
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
    const content = (await response.json()).choices?.[0]?.message?.content || "";
    const match = content.match(/\{[\s\S]*\}/);
    const result = match ? JSON.parse(match[0]) : null;
    if (result?.verdict === "gibberish" && typeof result.confidence === "number" && result.confidence >= 0.95) {
      return { allowed: false, reason: "gibberish", source: "openrouter" };
    }
    return { allowed: true, source: "openrouter" };
  } catch (error) {
    console.warn("Inquiry OpenRouter screening unavailable; allowing submission:", error);
    return { allowed: true, source: "unavailable" };
  }
}

export async function screenRentalInquiry(person: Record<string, unknown>): Promise<InquiryScreeningResult> {
  if (hasObviousGibberish(person)) return { allowed: false, reason: "gibberish", source: "heuristic" };
  return classifyWithOpenRouter(person);
}
