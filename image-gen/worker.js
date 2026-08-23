/**
 * Image Generation Worker
 * Polls Supabase `image_gen_jobs` table for pending jobs,
 * generates images via Gemini 2.5 Flash Image API,
 * uploads results to Supabase Storage, and tracks costs.
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';

// ============================================
// Configuration
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '10000');
const GEMINI_DELAY_MS = parseInt(process.env.GEMINI_DELAY_MS || '3000');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-image';
const STORAGE_BUCKET = 'housephotos';
const STORAGE_PREFIX = 'ai-gen';
const WEB_IMAGE_MAX_DIMENSION = 1440;
const WEB_IMAGE_JPEG_QUALITY = 82;

// Pricing constants (per 1M tokens)
const INPUT_PRICE_PER_M = 0.30;
const OUTPUT_PRICE_PER_M = 30.00;

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================
// Logging
// ============================================
function log(level, msg, data = {}) {
  const ts = new Date().toISOString();
  const dataStr = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${ts}] [${level}] ${msg}${dataStr}`);
}

// ============================================
// Download source image for editing
// ============================================
async function downloadImage(url) {
  const parsed = new URL(String(url));
  if (parsed.protocol !== 'https:') throw new Error('Source image must use HTTPS');
  const host = parsed.hostname.toLowerCase();
  const blockedHost = host === 'localhost' || host === 'ip6-localhost' || host.endsWith('.local')
    || host === 'metadata.google.internal' || host === '169.254.169.254'
    || /^(10|127)\./.test(host) || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || host === '::1' || host.startsWith('fc') || host.startsWith('fd');
  if (blockedHost) throw new Error('Source image host is not allowed');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > 25 * 1024 * 1024) throw new Error('Source image is too large');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > 25 * 1024 * 1024) throw new Error('Source image is too large');
  const mimeType = response.headers.get('content-type') || (url.endsWith('.png') ? 'image/png' : 'image/jpeg');
  return { base64: buffer.toString('base64'), mimeType };
}

// ============================================
// Gemini Image Generation / Editing
// ============================================
async function generateImage(prompt, sourceBase64 = null, sourceMimeType = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  // Build request parts: text prompt + optional source image for editing jobs
  const requestParts = [{ text: prompt }];
  if (sourceBase64) {
    requestParts.push({ inlineData: { mimeType: sourceMimeType, data: sourceBase64 } });
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: requestParts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorText.substring(0, 500)}`);
  }

  const data = await response.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  const usage = data.usageMetadata || {};

  // Find the image part
  const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imagePart) {
    const textPart = parts.find(p => p.text);
    throw new Error(`No image in response. Text: ${textPart?.text?.substring(0, 200) || 'none'}`);
  }

  return {
    base64: imagePart.inlineData.data,
    mimeType: imagePart.inlineData.mimeType || 'image/png',
    textResponse: parts.find(p => p.text)?.text || null,
    inputTokens: usage.promptTokenCount || 0,
    outputTokens: usage.candidatesTokenCount || 0,
  };
}

// ============================================
// Compress image (PNG/WebP → JPEG, max 1440px)
// ============================================
async function compressImage(base64Data, mimeType) {
  const originalBuffer = Buffer.from(base64Data, 'base64');
  const originalSize = originalBuffer.length;

  const compressed = sharp(originalBuffer)
    .resize(WEB_IMAGE_MAX_DIMENSION, WEB_IMAGE_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: WEB_IMAGE_JPEG_QUALITY });

  const compressedBuffer = await compressed.toBuffer();
  const metadata = await sharp(compressedBuffer).metadata();
  const reduction = ((1 - compressedBuffer.length / originalSize) * 100).toFixed(0);

  log('info', 'Image compressed', {
    from: `${(originalSize / 1024).toFixed(0)}KB ${mimeType}`,
    to: `${(compressedBuffer.length / 1024).toFixed(0)}KB image/jpeg`,
    reduction: `${reduction}%`,
    dimensions: `${metadata.width}x${metadata.height}`,
  });

  return {
    buffer: compressedBuffer,
    mimeType: 'image/jpeg',
    width: metadata.width,
    height: metadata.height,
  };
}

// ============================================
// Upload to Supabase Storage
// ============================================
async function uploadToStorage(buffer, mimeType) {
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const storagePath = `${STORAGE_PREFIX}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;

  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath);

  return {
    path: data.path,
    publicUrl: urlData.publicUrl,
    sizeBytes: buffer.length,
  };
}

// ============================================
// Create media record
// ============================================
async function createMediaRecord(publicUrl, storagePath, sizeBytes, mimeType, job, width = null, height = null) {
  const { data: media, error } = await supabase
    .from('media')
    .insert({
      url: publicUrl,
      storage_provider: 'supabase',
      storage_path: storagePath,
      media_type: 'image',
      mime_type: mimeType,
      file_size_bytes: sizeBytes,
      width,
      height,
      category: 'mktg',
      title: job.metadata?.title || job.metadata?.car_name || null,
      caption: `AI-generated: ${job.prompt.substring(0, 120)}`,
    })
    .select()
    .single();

  if (error) throw new Error(`Media record creation failed: ${error.message}`);

  // Link to space if specified
  if (job.space_id) {
    await supabase.from('media_spaces').insert({
      media_id: media.id,
      space_id: job.space_id,
      display_order: 99,
      is_primary: false,
    });
  }

  return media;
}

// ============================================
// Calculate cost from token usage
// ============================================
function calculateCost(inputTokens, outputTokens) {
  return (inputTokens * INPUT_PRICE_PER_M + outputTokens * OUTPUT_PRICE_PER_M) / 1_000_000;
}

// ============================================
// Process a single job
// ============================================
async function processJob(job) {
  log('info', 'Processing job', {
    id: job.id,
    type: job.job_type,
    prompt: job.prompt.substring(0, 80) + '...',
    attempt: job.attempt_count,
  });

  try {
    // 1. If source_media_id is set, download the source image for editing.
    //    Fallback: metadata.source_image_url (profile photos, etc).
    let sourceBase64 = null;
    let sourceMimeType = null;
    if (job.source_media_id) {
      const { data: sourceMedia, error: srcErr } = await supabase
        .from('media')
        .select('url')
        .eq('id', job.source_media_id)
        .single();
      if (srcErr || !sourceMedia) throw new Error(`Source media not found: ${job.source_media_id}`);
      log('info', 'Downloading source image', { id: job.id, url: sourceMedia.url.substring(0, 80) });
      const downloaded = await downloadImage(sourceMedia.url);
      sourceBase64 = downloaded.base64;
      sourceMimeType = downloaded.mimeType;
    } else if (job.metadata?.source_image_url) {
      log('info', 'Downloading source image from metadata URL', {
        id: job.id,
        url: String(job.metadata.source_image_url).substring(0, 80),
      });
      const downloaded = await downloadImage(job.metadata.source_image_url);
      sourceBase64 = downloaded.base64;
      sourceMimeType = downloaded.mimeType;
    }

    // 2. Generate/edit image via Gemini
    const result = await generateImage(job.prompt, sourceBase64, sourceMimeType);
    log('info', 'Image generated', {
      id: job.id,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      mimeType: result.mimeType,
    });

    // 3. Compress image (PNG → JPEG, max 1920px)
    const compressed = await compressImage(result.base64, result.mimeType);

    // 4. Upload to Supabase Storage
    const { publicUrl, path: storagePath, sizeBytes } = await uploadToStorage(compressed.buffer, compressed.mimeType);
    log('info', 'Uploaded to storage', { id: job.id, url: publicUrl, size: sizeBytes });

    // 5. Create media record
    const media = await createMediaRecord(publicUrl, storagePath, sizeBytes, compressed.mimeType, job, compressed.width, compressed.height);
    log('info', 'Media record created', { id: job.id, mediaId: media.id });

    // 6. Calculate cost
    const cost = calculateCost(result.inputTokens, result.outputTokens);

    // 7. Save affirmation text into metadata if Gemini returned text alongside image
    const updatedMetadata = { ...job.metadata };
    if (result.textResponse) {
      updatedMetadata.affirmation = result.textResponse.trim();
      log('info', 'Affirmation extracted', { id: job.id, text: result.textResponse.substring(0, 120) });
    }

    // 8. Send email if email metadata is present (PAI image+email jobs)
    if (job.metadata?.email_to) {
      try {
        await sendImageEmail(publicUrl, job.metadata, result.textResponse);
        updatedMetadata.email_sent = true;
        log('info', 'Email sent', { id: job.id, to: job.metadata.email_to });
      } catch (emailErr) {
        updatedMetadata.email_error = emailErr.message;
        log('error', 'Email failed', { id: job.id, error: emailErr.message });
      }
    }

    // 9. Update job as completed
    await supabase.from('image_gen_jobs')
      .update({
        status: 'completed',
        result_media_id: media.id,
        result_url: publicUrl,
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        estimated_cost_usd: cost,
        completed_at: new Date().toISOString(),
        error_message: null,
        metadata: updatedMetadata,
      })
      .eq('id', job.id);

    log('info', 'Job completed', {
      id: job.id,
      mediaId: media.id,
      cost: `$${cost.toFixed(4)}`,
      url: publicUrl,
    });

    // 10. SPGD brand regen callback — update spgd_brand_reviews with result
    if (job.metadata?.purpose === 'spgd_brand_regen' && job.metadata?.source_asset_id) {
      const { error: spgdErr } = await supabase.from('spgd_brand_reviews')
        .update({
          status: 'regenerated',
          metadata: {
            ...(job.metadata || {}),
            result_url: publicUrl,
            result_media_id: media.id,
            completed_at: new Date().toISOString(),
          },
        })
        .eq('asset_id', job.metadata.source_asset_id);
      if (spgdErr) log('warn', 'SPGD callback failed', { error: spgdErr.message });
      else log('info', 'SPGD brand review updated', { assetId: job.metadata.source_asset_id });
    }

  } catch (err) {
    log('error', 'Job failed', {
      id: job.id,
      error: err.message,
      attempt: job.attempt_count,
      maxAttempts: job.max_attempts,
    });

    const newStatus = (job.attempt_count >= job.max_attempts) ? 'failed' : 'pending';

    await supabase.from('image_gen_jobs')
      .update({
        status: newStatus,
        error_message: err.message.substring(0, 2000),
        completed_at: newStatus === 'failed' ? new Date().toISOString() : null,
      })
      .eq('id', job.id);
  }
}

// ============================================
// Send email with generated image
// ============================================
async function sendImageEmail(imageUrl, metadata, textResponse) {
  const toEmail = String(metadata.email_to || '').trim();
  const recipientName = String(metadata.email_recipient_name || '');
  const emailSubject = String(metadata.email_subject || 'Your AI-Generated Image from Alpaca Playhouse').slice(0, 200);
  const emailMessage = String(metadata.email_message || '').slice(0, 5000);
  const safe = (value) => String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

  const imageHtml = `
    ${emailMessage ? `<p style="font-size:16px;color:#333;margin-bottom:16px;">${safe(emailMessage).replace(/\n/g, '<br>')}</p>` : ''}
    <div style="text-align:center;margin:20px 0;">
      <img src="${imageUrl}" alt="AI-Generated Image" style="max-width:100%;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);" />
    </div>
    ${textResponse ? `<p style="font-size:14px;color:#666;font-style:italic;text-align:center;margin-top:8px;">${safe(textResponse)}</p>` : ''}
    <p style="font-size:12px;color:#999;margin-top:24px;">This image was created by PAI (Prompt Alpaca Intelligence) using AI image generation.</p>
  `;

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({
      type: 'custom',
      to: toEmail,
      data: {
        html: imageHtml,
        subject: emailSubject,
        text: `${emailMessage ? emailMessage + '\n\n' : ''}View your AI-generated image: ${imageUrl}\n\nThis image was created by PAI using AI image generation.`,
      },
    }),
  });

  const result = await resp.json();
  if (!resp.ok || result.error) {
    throw new Error(result.error || `HTTP ${resp.status}`);
  }
  log('info', 'Image email sent', { to: toEmail, subject: emailSubject });
}

// ============================================
// Main poll loop
// ============================================
let isProcessing = false;

async function pollForJobs() {
  if (isProcessing) return;

  try {
    const { data: jobs, error } = await supabase
      .from('image_gen_jobs')
      .select('*')
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      log('error', 'Poll query failed', { error: error.message });
      return;
    }

    if (!jobs?.length) return;

    const { data: claimed, error: claimError } = await supabase
      .from('image_gen_jobs')
      .update({
        status: 'processing',
        started_at: new Date().toISOString(),
        attempt_count: (jobs[0].attempt_count || 0) + 1,
      })
      .eq('id', jobs[0].id)
      .eq('status', 'pending')
      .select()
      .maybeSingle();
    if (claimError) {
      log('error', 'Job claim failed', { error: claimError.message });
      return;
    }
    if (!claimed) return;

    isProcessing = true;
    try {
      await processJob(claimed);
      // Rate-limit delay between consecutive jobs
      await new Promise(r => setTimeout(r, GEMINI_DELAY_MS));
    } finally {
      isProcessing = false;
    }
  } catch (err) {
    log('error', 'Poll error', { error: err.message });
    isProcessing = false;
  }
}

// ============================================
// Startup
// ============================================
async function main() {
  log('info', 'Image gen worker starting', {
    model: GEMINI_MODEL,
    pollInterval: POLL_INTERVAL_MS,
    geminiDelay: GEMINI_DELAY_MS,
  });

  // Verify connectivity
  const { count, error } = await supabase
    .from('image_gen_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  if (error) {
    log('error', 'Failed to connect to Supabase', { error: error.message });
    process.exit(1);
  }

  log('info', `Connected to Supabase. ${count || 0} pending jobs.`);

  // Start polling
  setInterval(pollForJobs, POLL_INTERVAL_MS);
  await pollForJobs(); // Run immediately
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
