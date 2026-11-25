/**
 * Cash App / Square payment-email parser (cash@square.com forwards).
 * Pure functions only so they can be tested without starting the webhook.
 */

export interface CashAppPayment {
  amount: number;
  senderName: string;
  senderEmail: string | null;
  currency: string;
  transactionId: string | null;
}

export function parseCashAppPayment(bodyText: string, fromAddress: string): CashAppPayment | null {
  const fromLower = (fromAddress || "").toLowerCase();
  const body = bodyText || "";
  const bodyLower = body.toLowerCase();

  const fromMatches =
    fromLower.includes("cash@square.com") ||
    fromLower.includes("@square.com") ||
    fromLower.includes("cash.app");
  const bodyMatches =
    bodyLower.includes("cash.app/launch/activity/receipt") ||
    /you were sent \$[\d,]+(?:\.\d{2})? by /i.test(body) ||
    (bodyLower.includes("cash app") && /\$[\d,]+(?:\.\d{2})?/.test(body));

  if (!fromMatches && !bodyMatches) return null;

  const normalized = body.replace(/\s+/g, " ");

  // Reject outbound (you sent, not received)
  if (/you sent \$[\d,]+(?:\.\d{2})? to /i.test(normalized) && !/you were sent/i.test(normalized)) {
    return null;
  }

  const txMatch = normalized.match(/cash\.app\/launch\/activity\/receipt\/([A-Za-z0-9_=-]+)/i);
  const transactionId = txMatch?.[1]?.substring(0, 60) || null;

  // Pattern 1: "You were sent $601.29 by Jane Doe."
  const m1 = normalized.match(/you were sent \$([\d,]+(?:\.\d{2})?) by ([^.\n]+?)(?:\.| To view|$)/i);
  if (m1) {
    return {
      amount: parseFloat(m1[1].replace(/,/g, "")),
      senderName: m1[2].trim(),
      senderEmail: null,
      currency: "USD",
      transactionId,
    };
  }

  // Pattern 2: "Jane Doe sent you $601.29"
  const m2 = normalized.match(/([A-Z][A-Za-z .'-]{1,60}) sent you \$([\d,]+(?:\.\d{2})?)/);
  if (m2) {
    return {
      amount: parseFloat(m2[2].replace(/,/g, "")),
      senderName: m2[1].trim(),
      senderEmail: null,
      currency: "USD",
      transactionId,
    };
  }

  // Pattern 3: generic "$X.XX" + "from Name"
  const amtMatch = normalized.match(/\$([\d,]+(?:\.\d{2})?)/);
  const fromMatch = normalized.match(/(?:from|sender|paid by)[:\s]+([A-Z][A-Za-z .'-]+?)(?:\s*\.|$|!|\s+on\b)/i);
  if (amtMatch && fromMatch) {
    return {
      amount: parseFloat(amtMatch[1].replace(/,/g, "")),
      senderName: fromMatch[1].trim(),
      senderEmail: null,
      currency: "USD",
      transactionId,
    };
  }

  return null;
}
