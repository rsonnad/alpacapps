/**
 * Timing-safe string comparison to prevent timing attacks on secret values.
 * Uses constant-time comparison via crypto.subtle.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  const aKey = await crypto.subtle.importKey(
    "raw", aBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", aKey, bBytes);
  const expected = await crypto.subtle.sign("HMAC", aKey, aBytes);
  const sigArr = new Uint8Array(sig);
  const expArr = new Uint8Array(expected);
  if (sigArr.length !== expArr.length) return false;
  let result = 0;
  for (let i = 0; i < sigArr.length; i++) {
    result |= sigArr[i] ^ expArr[i];
  }
  return result === 0;
}
