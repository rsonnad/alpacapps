import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

interface SonosRequest {
  action:
    | "getZones"
    | "getState"
    | "play"
    | "pause"
    | "playpause"
    | "next"
    | "previous"
    | "volume"
    | "mute"
    | "unmute"
    | "favorite"
    | "favorites"
    | "playlists"
    | "playlist"
    | "pauseall"
    | "resumeall"
    | "join"
    | "leave"
    | "bass"
    | "treble"
    | "loudness"
    | "balance"
    | "announce";
  room?: string;
  value?: number | string;
  name?: string;
  other?: string;
  text?: string;
  voice?: string;
}

// =============================================
// TTS Helpers
// =============================================

const GEMINI_TTS_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent";

const STORAGE_BUCKET = "housephotos";
const TTS_PREFIX = "tts-announce";

/** Build a WAV header for raw PCM data (24kHz, 16-bit, mono) */
function buildWavHeader(pcmByteLength: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  // "RIFF" chunk
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + pcmByteLength, true); // file size - 8
  view.setUint32(8, 0x57415645, false); // "WAVE"
  // "fmt " sub-chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // sub-chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  // "data" sub-chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, pcmByteLength, true);

  return new Uint8Array(header);
}

/** Decode base64 string to Uint8Array */
function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");

    // Allow trusted internal calls from PAI (service role key = already permission-checked)
    const isInternalCall = token === supabaseServiceKey;

    if (!isInternalCall) {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return jsonResponse({ error: "Invalid token" }, 401);
      }

      // Verify user has resident+ role
      const { data: appUser } = await supabase
        .from("app_users")
        .select("role")
        .eq("auth_user_id", user.id)
        .single();

      if (
        !appUser ||
        !["resident", "associate", "staff", "admin", "oracle"].includes(appUser.role)
      ) {
        return jsonResponse({ error: "Insufficient permissions" }, 403);
      }
    }

    // Get proxy config from env
    const proxyUrl = Deno.env.get("SONOS_PROXY_URL");
    const proxySecret = Deno.env.get("SONOS_PROXY_SECRET");
    if (!proxyUrl || !proxySecret) {
      return jsonResponse({ error: "Sonos proxy not configured" }, 500);
    }

    const body: SonosRequest = await req.json();
    const { action } = body;

    // Build Sonos HTTP API path
    let path = "";
    const room = body.room ? encodeURIComponent(body.room) : null;

    switch (action) {
      case "getZones":
        path = "/zones";
        break;
      case "getState":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/state`;
        break;
      case "play":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/play`;
        break;
      case "pause":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/pause`;
        break;
      case "playpause":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/playpause`;
        break;
      case "next":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/next`;
        break;
      case "previous":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/previous`;
        break;
      case "volume": {
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        const vol = body.value;
        if (vol === undefined || vol === null)
          return jsonResponse({ error: "Missing value" }, 400);
        path = `/${room}/volume/${encodeURIComponent(String(vol))}`;
        break;
      }
      case "mute":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/mute`;
        break;
      case "unmute":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/unmute`;
        break;
      case "favorite":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        if (!body.name) return jsonResponse({ error: "Missing name" }, 400);
        path = `/${room}/favorite/${encodeURIComponent(body.name)}`;
        break;
      case "favorites":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/favorites`;
        break;
      case "playlists":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/playlists`;
        break;
      case "playlist":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        if (!body.name) return jsonResponse({ error: "Missing name" }, 400);
        path = `/${room}/playlist/${encodeURIComponent(body.name)}`;
        break;
      case "pauseall":
        path = "/pauseall";
        break;
      case "resumeall":
        path = "/resumeall";
        break;
      case "join":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        if (!body.other) return jsonResponse({ error: "Missing other" }, 400);
        path = `/${room}/join/${encodeURIComponent(body.other)}`;
        break;
      case "leave":
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        path = `/${room}/leave`;
        break;
      case "bass": {
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        const bassVal = body.value;
        if (bassVal === undefined || bassVal === null)
          return jsonResponse({ error: "Missing value" }, 400);
        path = `/${room}/bass/${encodeURIComponent(String(bassVal))}`;
        break;
      }
      case "treble": {
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        const trebleVal = body.value;
        if (trebleVal === undefined || trebleVal === null)
          return jsonResponse({ error: "Missing value" }, 400);
        path = `/${room}/treble/${encodeURIComponent(String(trebleVal))}`;
        break;
      }
      case "loudness": {
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        const loudnessVal = body.value;
        if (loudnessVal === undefined || loudnessVal === null)
          return jsonResponse({ error: "Missing value" }, 400);
        path = `/${room}/loudness/${encodeURIComponent(String(loudnessVal))}`;
        break;
      }
      case "balance": {
        if (!room) return jsonResponse({ error: "Missing room" }, 400);
        const balVal = body.value;
        if (balVal === undefined || balVal === null)
          return jsonResponse({ error: "Missing value" }, 400);
        path = `/${room}/balance/${encodeURIComponent(String(balVal))}`;
        break;
      }
      case "announce": {
        if (!body.text) return jsonResponse({ error: "Missing text" }, 400);

        const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
        if (!geminiApiKey) {
          return jsonResponse({ error: "Gemini API key not configured" }, 500);
        }

        const voiceName = body.voice || "Kore";

        // 1. Generate TTS audio via Gemini
        console.log(`Announce: generating TTS for "${body.text}" with voice ${voiceName}`);
        const ttsResponse = await fetch(`${GEMINI_TTS_URL}?key=${geminiApiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: body.text }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
            },
          }),
        });

        if (!ttsResponse.ok) {
          const errBody = await ttsResponse.text();
          console.error("Gemini TTS error:", ttsResponse.status, errBody);
          return jsonResponse({ error: `TTS generation failed: ${ttsResponse.status}`, detail: errBody.substring(0, 500) }, 500);
        }

        const ttsResult = await ttsResponse.json();
        const audioData = ttsResult.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!audioData) {
          console.error("Gemini TTS: no audio data in response", JSON.stringify(ttsResult).substring(0, 500));
          return jsonResponse({ error: "TTS returned no audio data" }, 500);
        }

        // 2. Convert base64 PCM to WAV
        const pcmBytes = base64ToBytes(audioData);
        const wavHeader = buildWavHeader(pcmBytes.length);
        const wavData = new Uint8Array(wavHeader.length + pcmBytes.length);
        wavData.set(wavHeader, 0);
        wavData.set(pcmBytes, wavHeader.length);

        // 3. Upload WAV to Supabase Storage
        const filename = `${Date.now()}.wav`;
        const storagePath = `${TTS_PREFIX}/${filename}`;
        console.log(`Announce: uploading ${wavData.length} bytes to ${storagePath}`);

        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, wavData, {
            contentType: "audio/wav",
            upsert: true,
          });

        if (uploadError) {
          console.error("Storage upload error:", uploadError.message);
          return jsonResponse({ error: `Upload failed: ${uploadError.message}` }, 500);
        }

        const { data: urlData } = supabase.storage
          .from(STORAGE_BUCKET)
          .getPublicUrl(storagePath);

        const audioUrl = urlData.publicUrl;
        console.log(`Announce: audio URL = ${audioUrl}`);

        // 4. Calculate duration from PCM data (24kHz, 16-bit mono)
        const durationSecs = Math.ceil(pcmBytes.length / (24000 * 2)) + 2;

        // 5. Proxy to Sonos custom action (pass just filename, action constructs full URL)
        const announceVolume = 40;
        if (room) {
          path = `/${room}/announceurl/${encodeURIComponent(filename)}/${announceVolume}/${durationSecs}`;
        } else {
          path = `/announceurlall/${encodeURIComponent(filename)}/${announceVolume}/${durationSecs}`;
        }
        console.log(`Announce: proxying to Sonos, duration=${durationSecs}s`);
        break;
      }

      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }

    // Forward to Sonos proxy on DO droplet
    console.log(`Sonos proxy → ${proxyUrl}${path}`);
    const sonosResponse = await fetch(`${proxyUrl}${path}`, {
      headers: { "X-Sonos-Secret": proxySecret },
    });

    const result = await sonosResponse.text();
    console.log(`Sonos proxy ← ${sonosResponse.status}: ${result.substring(0, 300)}`);

    // Try to parse as JSON, fall back to wrapping as text
    try {
      const json = JSON.parse(result);
      return jsonResponse(json, sonosResponse.ok ? 200 : sonosResponse.status);
    } catch {
      return jsonResponse(
        { status: sonosResponse.ok ? "ok" : "error", response: result },
        sonosResponse.ok ? 200 : sonosResponse.status
      );
    }
  } catch (error) {
    console.error("Sonos control error:", error.message);
    return jsonResponse({ error: error.message }, 500);
  }
});
