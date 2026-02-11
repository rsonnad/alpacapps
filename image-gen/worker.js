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
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get('content-type') || (url.endsWith('.png') ? 'image/png' : 'image/jpeg');
  return { base64: buffer.toString('base64'), mimeType };
}

// ============================================
// Gemini Image Generation / Editing
// ============================================
async function generateImage(prompt, sourceBase64 = null, sourceMimeType = null) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  // Build request parts: text prompt + optional source image
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
// Compress image (PNG/WebP → JPEG, max 1920px)
// ============================================
async function compressImage(base64Data, mimeType) {
  const originalBuffer = Buffer.from(base64Data, 'base64');
  const originalSize = originalBuffer.length;

  const compressed = sharp(originalBuffer)
    .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 });

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
    attempt: job.attempt_count + 1,
  });

  // Mark as processing
  await supabase.from('image_gen_jobs')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
      attempt_count: job.attempt_count + 1,
    })
    .eq('id', job.id);

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

    // 7. Update job as completed
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
      })
      .eq('id', job.id);

    log('info', 'Job completed', {
      id: job.id,
      mediaId: media.id,
      cost: `$${cost.toFixed(4)}`,
      url: publicUrl,
    });

  } catch (err) {
    log('error', 'Job failed', {
      id: job.id,
      error: err.message,
      attempt: job.attempt_count + 1,
      maxAttempts: job.max_attempts,
    });

    const newStatus = (job.attempt_count + 1 >= job.max_attempts) ? 'failed' : 'pending';

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

    isProcessing = true;
    try {
      await processJob(jobs[0]);
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
