/**
 * Project Inquiry Worker
 * Polls Supabase `project_inquiries` table for pending jobs.
 *
 * Two inquiry types:
 * - "color_pick": Analyzes image via Gemini Flash → searches Brave for matching paints
 * - "general": Answers a free-text question about the image via Gemini Flash
 *
 * Uses Gemini 2.5 Flash for fast, low-cost image analysis (no Claude CLI needed).
 * Runs on the DO/Oracle server alongside other workers.
 */

import { createClient } from '@supabase/supabase-js';

// ============================================
// Configuration
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '10000');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_SEARCH_RESULTS = 5;

// Gemini pricing (2.5 Flash: $0.15/1M input, $3.50/1M output under 200k context)
const GEMINI_INPUT_COST_PER_TOKEN = 0.15 / 1_000_000;
const GEMINI_OUTPUT_COST_PER_TOKEN = 3.50 / 1_000_000;

// Brave pricing
const BRAVE_COST_PER_QUERY = 0; // Free tier (2,000/mo); set to 0.003 if paid

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}
if (!BRAVE_API_KEY) {
  console.error('BRAVE_API_KEY is required');
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY is required');
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
// Download image as base64 for Gemini
// ============================================
async function downloadImageAsBase64(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());

  const ct = response.headers.get('content-type') || 'image/jpeg';
  const mimeType = ct.split(';')[0].trim();
  const base64 = buffer.toString('base64');

  log('info', `Image downloaded: ${Math.round(buffer.length / 1024)}KB, ${mimeType}`);
  return { base64, mimeType };
}

// ============================================
// Gemini API call with vision
// ============================================
async function callGemini(prompt, imageBase64, imageMimeType, jsonMode = false) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const parts = [
    { text: prompt },
    { inlineData: { mimeType: imageMimeType, data: imageBase64 } },
  ];

  const generationConfig = {
    temperature: 0.2,
    maxOutputTokens: 4096,
  };

  if (jsonMode) {
    generationConfig.responseMimeType = 'application/json';
  }

  let response = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig,
      }),
    });

    if (response.ok || response.status !== 429) break;
    log('warn', `Gemini rate limited (attempt ${attempt + 1}), retrying...`);
    await sleep((attempt + 1) * 2000);
  }

  if (!response || !response.ok) {
    const errorText = response ? await response.text() : 'no response';
    throw new Error(`Gemini API error ${response?.status}: ${errorText.substring(0, 500)}`);
  }

  const data = await response.json();
  const usage = data.usageMetadata || {};
  const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;
  const costUsd = (inputTokens * GEMINI_INPUT_COST_PER_TOKEN) + (outputTokens * GEMINI_OUTPUT_COST_PER_TOKEN);

  log('info', 'Gemini response received', { inputTokens, outputTokens, cost: costUsd.toFixed(4), text_len: textContent.length });

  return { textContent, inputTokens, outputTokens, costUsd };
}

// ============================================
// Parse JSON from Gemini output
// ============================================
function extractJSON(text) {
  let cleaned = text.trim();
  // Strip markdown fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  // Find JSON object
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }

  return JSON.parse(cleaned);
}

// ============================================
// Process Color Pick inquiry
// ============================================
async function processColorPick(job, imageBase64, imageMimeType) {
  const prompt = `This is a photo of a surface/wall for paint color matching. ${job.caption ? `Context: "${job.caption}".` : ''}

Identify ALL distinct paint colors visible on the surfaces. For each color:
1. Give it a descriptive name (e.g. "Warm Beige", "Sage Green")
2. Provide the exact hex code and RGB values
3. Estimate what percentage of the visible surface it covers
4. Identify the surface type (interior wall, exterior siding, trim, ceiling, door, cabinet, etc.)
5. Recommend the appropriate paint type (interior latex flat, interior latex semi-gloss, exterior acrylic, etc.)
6. Add any notes about the color or finish

Also provide:
- Overall surface analysis (condition, material, texture)
- Any preparation recommendations before repainting

Return valid JSON with this schema:
{
  "colors": [
    {
      "name": "Color Name",
      "hex": "#RRGGBB",
      "rgb": { "r": 0, "g": 0, "b": 0 },
      "surface_type": "interior wall",
      "coverage_percent": 45,
      "recommended_paint_type": "interior latex semi-gloss",
      "notes": "Description of the color"
    }
  ],
  "surface_analysis": "Overall description of the surface condition",
  "recommendations": "Preparation recommendations"
}`;

  const { textContent, inputTokens, outputTokens, costUsd } = await callGemini(prompt, imageBase64, imageMimeType, true);

  let analysis;
  try {
    analysis = JSON.parse(textContent);
  } catch {
    analysis = extractJSON(textContent);
  }

  log('info', `Gemini analysis complete: ${analysis.colors?.length || 0} colors found`, { inputTokens, outputTokens });

  // Log Gemini usage
  await logApiUsage('gemini', 'project_inquiry_color_pick', GEMINI_MODEL, job, {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: costUsd,
    metadata: { model: GEMINI_MODEL, colors_found: analysis.colors?.length || 0 },
  });

  // Search for paint matches
  let searchResults = { colors: [], totalQueries: 0 };
  if (analysis.colors && analysis.colors.length > 0) {
    log('info', `Searching for paint matches for ${analysis.colors.length} colors...`);
    searchResults = await searchPaintMatches(analysis.colors);
    log('info', `Search complete: ${searchResults.totalQueries} queries`);

    // Log Brave usage
    await logApiUsage('brave', 'project_inquiry_color_pick', 'web_search', job, {
      units: searchResults.totalQueries,
      unit_type: 'queries',
      estimated_cost_usd: searchResults.totalQueries * BRAVE_COST_PER_QUERY,
      metadata: { colors_searched: analysis.colors.length, total_queries: searchResults.totalQueries },
    });
  }

  // Update job as completed
  const totalCost = (costUsd || 0) + (searchResults.totalQueries * BRAVE_COST_PER_QUERY);
  await supabase
    .from('project_inquiries')
    .update({
      status: 'completed',
      analysis_result: analysis,
      search_results: searchResults,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: totalCost,
      completed_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  log('info', `Job ${job.id} completed (color_pick)`, { cost: totalCost.toFixed(4) });
}

// ============================================
// Process General Question inquiry
// ============================================
async function processGeneralQuestion(job, imageBase64, imageMimeType) {
  const prompt = `${job.caption ? `Context: "${job.caption}". ` : ''}A property associate is asking the following question about this image:

"${job.question}"

Please provide a clear, helpful, and detailed answer. Focus on practical advice relevant to property management, maintenance, or renovation. If you can identify specific products, materials, or issues, mention them by name.`;

  const { textContent, inputTokens, outputTokens, costUsd } = await callGemini(prompt, imageBase64, imageMimeType, false);

  log('info', 'Gemini answered general question', { inputTokens, outputTokens, answer_len: textContent.length });

  // Log Gemini usage
  await logApiUsage('gemini', 'project_inquiry_general', GEMINI_MODEL, job, {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: costUsd,
    metadata: { model: GEMINI_MODEL, question: job.question?.substring(0, 100) },
  });

  // Update job as completed
  await supabase
    .from('project_inquiries')
    .update({
      status: 'completed',
      answer: textContent,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: costUsd || 0,
      completed_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  log('info', `Job ${job.id} completed (general)`, { cost: (costUsd || 0).toFixed(4) });
}

// ============================================
// Brave Search for paint matches
// ============================================
async function searchPaintMatches(colors) {
  const results = [];
  let totalQueries = 0;

  for (const color of colors) {
    const colorResults = { analyzed_color: { name: color.name, hex: color.hex }, matches: [] };

    // Search Home Depot
    const hdMatches = await searchBrave(
      `"${color.name}" paint color hex ${color.hex} Home Depot Behr`,
      'Home Depot'
    );
    totalQueries++;

    // Rate limit: 1 QPS for Brave
    await sleep(1100);

    // Search Lowes
    const lowesMatches = await searchBrave(
      `"${color.name}" paint color hex ${color.hex} Lowes Sherwin-Williams`,
      'Lowes'
    );
    totalQueries++;

    // Rate limit
    await sleep(1100);

    colorResults.matches = [...hdMatches, ...lowesMatches];
    results.push(colorResults);
  }

  return { colors: results, totalQueries };
}

async function searchBrave(query, store) {
  try {
    const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${MAX_SEARCH_RESULTS}`;

    const resp = await fetch(searchUrl, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY,
      },
    });

    if (!resp.ok) {
      log('warn', `Brave search failed: ${resp.status}`, { query });
      return [];
    }

    const data = await resp.json();
    const webResults = data.web?.results || [];

    return webResults.map(r => parsePaintResult(r, store)).filter(Boolean);
  } catch (err) {
    log('error', 'Brave search error', { query, error: err.message });
    return [];
  }
}

/**
 * Parse a Brave search result into structured paint match data.
 */
function parsePaintResult(result, store) {
  const title = result.title || '';
  const desc = result.description || '';
  const url = result.url || '';

  // Try to extract paint code (patterns like "SW 7036", "PPU4-07", "N310-3", "OC-17")
  const codeMatch = (title + ' ' + desc).match(/\b([A-Z]{1,4}[-\s]?\d{1,4}[-\s]?[A-Z]?\d{0,3})\b/);

  // Try to extract brand
  let brand = '';
  const brandPatterns = ['Behr', 'Sherwin-Williams', 'Sherwin Williams', 'Valspar', 'Glidden', 'PPG', 'Benjamin Moore', 'Olympic', 'HGTV Home', 'Rust-Oleum'];
  for (const b of brandPatterns) {
    if ((title + ' ' + desc).toLowerCase().includes(b.toLowerCase())) {
      brand = b;
      break;
    }
  }

  // Try to extract price from description
  const priceMatch = desc.match(/\$\d+(?:\.\d{2})?/);

  return {
    brand: brand || 'Unknown',
    product_name: title.substring(0, 80),
    paint_code: codeMatch ? codeMatch[1] : null,
    store,
    url,
    price_hint: priceMatch ? priceMatch[0] : null,
    title,
    description: desc.substring(0, 200),
  };
}

// ============================================
// Cost tracking
// ============================================
async function logApiUsage(vendor, category, endpoint, job, extra = {}) {
  try {
    await supabase.from('api_usage_log').insert({
      vendor,
      category,
      endpoint,
      input_tokens: extra.input_tokens || null,
      output_tokens: extra.output_tokens || null,
      units: extra.units || null,
      unit_type: extra.unit_type || null,
      estimated_cost_usd: extra.estimated_cost_usd || 0,
      metadata: { job_id: job.id, ...(extra.metadata || {}) },
      app_user_id: job.app_user_id,
    });
  } catch (err) {
    log('warn', 'Failed to log API usage', { vendor, error: err.message });
  }
}

// ============================================
// Process a single job (routes to type-specific handler)
// ============================================
async function processJob(job) {
  log('info', `Processing job ${job.id}`, {
    type: job.inquiry_type,
    caption: job.caption,
    question: job.question?.substring(0, 60),
    image_url: job.image_url?.substring(0, 80),
  });

  // Mark as processing
  await supabase
    .from('project_inquiries')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
      attempt_count: (job.attempt_count || 0) + 1,
    })
    .eq('id', job.id);

  try {
    // Download image as base64 for Gemini
    log('info', 'Downloading image...');
    const { base64, mimeType } = await downloadImageAsBase64(job.image_url);

    // Route to type-specific processing
    if (job.inquiry_type === 'general') {
      await processGeneralQuestion(job, base64, mimeType);
    } else {
      // Default: color_pick
      await processColorPick(job, base64, mimeType);
    }

  } catch (err) {
    log('error', `Job ${job.id} failed`, { error: err.message });

    const newAttempt = (job.attempt_count || 0) + 1;
    const newStatus = newAttempt >= (job.max_attempts || 3) ? 'failed' : 'pending';

    await supabase
      .from('project_inquiries')
      .update({
        status: newStatus,
        error_message: err.message,
        attempt_count: newAttempt,
      })
      .eq('id', job.id);

    if (newStatus === 'pending') {
      log('info', `Job ${job.id} will retry (attempt ${newAttempt}/${job.max_attempts || 3})`);
    }
  }
}

// ============================================
// Poll loop
// ============================================
let isProcessing = false;

async function pollForJobs() {
  if (isProcessing) return;

  try {
    const { data: jobs, error } = await supabase
      .from('project_inquiries')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) {
      log('error', 'Poll query failed', { error: error.message });
      return;
    }

    if (!jobs || jobs.length === 0) return;

    isProcessing = true;
    await processJob(jobs[0]);
  } catch (err) {
    log('error', 'Poll loop error', { error: err.message });
  } finally {
    isProcessing = false;
  }
}

// ============================================
// Startup
// ============================================
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

log('info', '📋 Project Inquiry Worker starting', {
  poll_interval: POLL_INTERVAL_MS,
  model: GEMINI_MODEL,
});

// Initial poll
await pollForJobs();

// Start poll loop
setInterval(pollForJobs, POLL_INTERVAL_MS);

log('info', 'Worker running — polling for project inquiries');
