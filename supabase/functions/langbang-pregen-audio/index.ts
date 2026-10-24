// langbang-pregen-audio — Pre-generate Azure TTS mp3s for langbang phrases and store
// them in Cloudflare R2 (alpacapps/langbang/audio/<sha1>.mp3). The app calls this
// function once per "Download all audio" tap (or manually via curl) with a list of
// (text, voice, locale) triples; the function returns a manifest mapping each triple
// to its public R2 URL so the app can pull each mp3 in a single GET.
//
// Slow-Polish (-60%) is implemented by passing the voice with suffix "|slow60v1".
// The function recognises this suffix and wraps the SSML body in <prosody rate="-60%">.
// Old -50% phrases use suffix "|slow50v3" and are still supported for legacy cache
// keys, but new content should always use slow60v1.
//
// Env vars expected (set via Supabase project secrets):
//   - AZURE_SPEECH_KEY               (bw item "Azure Speech — langbang-speech (TTS)")
//   - AZURE_SPEECH_REGION            (default "eastus")
//   - R2_ACCOUNT_ID                  (bw item "Cloudflare R2 — Object Storage")
//   - R2_ACCESS_KEY_ID
//   - R2_SECRET_ACCESS_KEY
//   - R2_BUCKET_NAME=alpacapps
//   - R2_PUBLIC_URL=https://pub-5a7344c4dab2467eb917ff4b897e066d.r2.dev

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders } from "../_shared/api-helpers.ts";
import { uploadToR2, getR2PublicUrl } from "../_shared/r2-upload.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkIpRateLimit, checkRateLimit } from "../_shared/function-wrapper.ts";

// Anonymous endpoint that spends Azure TTS credit, so every input is bounded.
const MAX_PHRASES = 1000;
const MAX_NEW_SYNTHS_PER_CALL = 300;
const MAX_TEXT_CHARS = 300;
const LOCALE_RE = /^[a-z]{2,3}-[A-Z]{2}$/;
const VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural(\|slow50v3|\|slow60v1)?$/;

interface Phrase {
  text: string;
  voice: string;
  locale: string;
}

interface ManifestEntry extends Phrase {
  sha1: string;
  url: string;
  uploaded: boolean; // false if it was already in R2
  error?: string;
}

const SLOW_50_SUFFIX = "|slow50v3";
const SLOW_60_SUFFIX = "|slow60v1";

async function sha1Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSsml(text: string, voice: string, locale: string): { ssml: string; realVoice: string } {
  const slow60 = voice.endsWith(SLOW_60_SUFFIX);
  const slow50 = !slow60 && voice.endsWith(SLOW_50_SUFFIX);
  const realVoice = slow60
    ? voice.slice(0, -SLOW_60_SUFFIX.length)
    : slow50
    ? voice.slice(0, -SLOW_50_SUFFIX.length)
    : voice;
  const ratePct = slow60 ? "-60%" : slow50 ? "-50%" : null;
  const body = ratePct
    ? `<prosody rate="${ratePct}">${escapeXml(text)}</prosody>`
    : escapeXml(text);
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}"><voice name="${realVoice}">${body}</voice></speak>`;
  return { ssml, realVoice };
}

async function synthesize(text: string, voice: string, locale: string): Promise<Uint8Array> {
  const key = Deno.env.get("AZURE_SPEECH_KEY");
  const region = Deno.env.get("AZURE_SPEECH_REGION") || "eastus";
  if (!key) throw new Error("AZURE_SPEECH_KEY not configured");
  const { ssml } = buildSsml(text, voice, locale);
  const resp = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "langbang-pregen/0.1",
    },
    body: ssml,
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Azure TTS ${resp.status}: ${err.slice(0, 200)}`);
  }
  const buf = await resp.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * HEAD the R2 public URL to check if the object already exists. Cheap (~100ms) and
 * lets us skip Azure synth + R2 upload for cache hits.
 */
async function r2ObjectExists(key: string): Promise<boolean> {
  const url = getR2PublicUrl(key);
  try {
    const resp = await fetch(url, { method: "HEAD" });
    return resp.ok;
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
  const badRequest = (error: string, status = 400) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  try {
    const limiter = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (
      !(await checkIpRateLimit(limiter, "langbang-pregen-audio", req, 20, 3600)) ||
      !(await checkRateLimit(limiter, "langbang-pregen-audio-global", "all", 200, 86400))
    ) {
      return badRequest("Rate limit exceeded", 429);
    }

    const { phrases } = (await req.json()) as { phrases: Phrase[] };
    if (!Array.isArray(phrases) || phrases.length === 0) {
      return badRequest("phrases[] required");
    }
    if (phrases.length > MAX_PHRASES) {
      return badRequest(`At most ${MAX_PHRASES} phrases per call`);
    }
    for (const p of phrases) {
      if (
        typeof p?.text !== "string" || !p.text.trim() || p.text.length > MAX_TEXT_CHARS ||
        typeof p.locale !== "string" || !LOCALE_RE.test(p.locale) ||
        typeof p.voice !== "string" || !VOICE_RE.test(p.voice)
      ) {
        return badRequest(`Each phrase needs text (1-${MAX_TEXT_CHARS} chars), a locale like pl-PL and an Azure Neural voice`);
      }
    }
    const manifest: ManifestEntry[] = [];
    let newSynths = 0;
    for (const p of phrases) {
      const sha1 = await sha1Hex(`${p.locale}|${p.voice}|${p.text}`);
      const key = `langbang/audio/${sha1}.mp3`;
      try {
        if (await r2ObjectExists(key)) {
          manifest.push({
            ...p,
            sha1,
            url: getR2PublicUrl(key),
            uploaded: false,
          });
          continue;
        }
        if (++newSynths > MAX_NEW_SYNTHS_PER_CALL) {
          throw new Error(`Synthesis cap of ${MAX_NEW_SYNTHS_PER_CALL} per call reached; call again for the rest`);
        }
        const mp3 = await synthesize(p.text, p.voice, p.locale);
        const url = await uploadToR2(key, mp3, "audio/mpeg");
        manifest.push({ ...p, sha1, url, uploaded: true });
      } catch (e) {
        manifest.push({
          ...p,
          sha1,
          url: getR2PublicUrl(key),
          uploaded: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const summary = {
      requested: phrases.length,
      synthesized: manifest.filter((m) => m.uploaded).length,
      cached: manifest.filter((m) => !m.uploaded && !m.error).length,
      failed: manifest.filter((m) => m.error).length,
    };
    return new Response(
      JSON.stringify({ summary, manifest }, null, 2),
      { status: 200, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } },
    );
  }
});
