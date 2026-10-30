/**
 * Signed, expiring OAuth `state` values.
 *
 * The state binds an OAuth redirect to the account the server started it for, so a code
 * exchange cannot be pointed at some other account. Format: `<accountId>.<expiresEpochSec>.<hmacHex>`,
 * optionally prefixed by the caller (e.g. `profile:`). Signed with HMAC-SHA256 under the
 * project's service-role key, which never leaves the server.
 */
import { timingSafeEqual } from "./timing-safe.ts";

const STATE_TTL_SECONDS = 15 * 60;

async function hmacHex(message: string): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`oauth-state:${message}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signOAuthState(accountId: number | string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS;
  const payload = `${accountId}.${exp}`;
  return `${payload}.${await hmacHex(payload)}`;
}

/** Returns the account id the state was issued for, or null if it is forged, malformed or expired. */
export async function verifyOAuthState(state: string): Promise<string | null> {
  const raw = String(state || "").replace(/^[a-z]+:/, "");
  const parts = raw.split(".");
  if (parts.length !== 3) return null;
  const [accountId, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!accountId || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  const expected = await hmacHex(`${accountId}.${expStr}`);
  return (await timingSafeEqual(sig, expected)) ? accountId : null;
}
