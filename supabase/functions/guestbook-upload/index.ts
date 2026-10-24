/**
 * Guestbook Upload Edge Function
 *
 * Accepts multipart form data with a media file (video/audio),
 * uploads to Cloudflare R2, and creates a guestbook_entries record.
 *
 * Deploy: supabase functions deploy guestbook-upload --no-verify-jwt
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { uploadToR2 } from '../_shared/r2-upload.ts';
import { checkRateLimit, getClientIp } from '../_shared/function-wrapper.ts';

import { getCorsHeaders } from "../_shared/api-helpers.ts";

// The kiosk records webm (Chrome) or mp4 (Safari). Nothing else may be written to the public bucket.
const ALLOWED_TYPES: Record<string, Record<string, string>> = {
  video: { 'video/webm': 'webm', 'video/mp4': 'mp4' },
  audio: { 'audio/webm': 'webm', 'audio/mp4': 'm4a' },
};

/** Check the container magic bytes so a renamed HTML or script file is rejected. */
function looksLikeMedia(bytes: Uint8Array, ext: string): boolean {
  if (ext === 'webm') return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!(await checkRateLimit(supabase, 'guestbook-upload', getClientIp(req), 10, 3600))) {
      return json({ error: 'Too many uploads, try again later' }, 429);
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const guestName = String(formData.get('guest_name') || '').trim().slice(0, 100) || null;
    const mediaType = formData.get('media_type') === 'audio' ? 'audio' : 'video';
    // The client-supplied key is ignored; the server picks the object key.
    const baseType = String(formData.get('content_type') || file?.type || '').split(';')[0].trim().toLowerCase();
    const ext = ALLOWED_TYPES[mediaType][baseType];

    if (!file) return json({ error: 'Missing file' }, 400);
    if (!ext) return json({ error: `Unsupported content type for ${mediaType}` }, 415);

    // Read file bytes
    const bytes = new Uint8Array(await file.arrayBuffer());

    // Enforce 50MB limit
    if (bytes.length > 50 * 1024 * 1024) {
      return new Response(
        JSON.stringify({ error: 'File too large (max 50MB)' }),
        { status: 413, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    if (bytes.length < 8 || !looksLikeMedia(bytes, ext)) {
      return json({ error: 'File is not a recognized recording' }, 415);
    }

    // Upload to R2 under a server-generated key
    const key = `guestbook/${mediaType}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const publicUrl = await uploadToR2(key, bytes, baseType);

    const entry: Record<string, unknown> = {
      guest_name: guestName,
      entry_type: mediaType,
      media_type: mediaType,
      source: 'kiosk',
    };

    if (mediaType === 'video') {
      entry.video_url = publicUrl;
    } else {
      entry.audio_url = publicUrl;
    }

    const { data, error } = await supabase
      .from('guestbook_entries')
      .insert(entry)
      .select('id')
      .single();

    if (error) {
      console.error('DB insert failed:', error.message, error.stack);
      return new Response(
        JSON.stringify({ error: 'Failed to save entry' }),
        { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, id: data.id, url: publicUrl }),
      { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('guestbook-upload error:', err.message, err.stack);
    return new Response(
      JSON.stringify({ error: 'Internal error processing guestbook upload' }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
