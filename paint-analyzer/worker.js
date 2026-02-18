/**
 * Paint Color Analyzer Worker
 * Polls Supabase `paint_analysis_jobs` table for pending jobs,
 * analyzes images via Anthropic Claude Sonnet 4.6 Vision API,
 * searches Brave for matching paint products, and stores results.
 *
 * Runs on the DO/Oracle server alongside other workers.
 */

import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';

// ============================================
// Configuration
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '10000');
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
const MAX_SEARCH_RESULTS = 5;
const TEMP_DIR = '/tmp/paint-analyzer';

// Anthropic pricing (Sonnet 4.6 per 1M tokens — check current pricing)
const INPUT_PRICE_PER_M = 3.00;
const OUTPUT_PRICE_PER_M = 15.00;

// Brave pricing
const BRAVE_COST_PER_QUERY = 0; // Free tier (2,000/mo); set to 0.003 if paid

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is required');
  process.exit(1);
}
if (!BRAVE_API_KEY) {
  console.error('BRAVE_API_KEY is required');
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
// Image download
// ============================================
async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  return { base64: buffer.toString('base64'), mimeType };
}

// ============================================
// Claude Vision Analysis
// ============================================
async function analyzeWithClaude(imageBase64, mimeType, caption) {
  const prompt = `Analyze this photo of a surface/wall for paint color matching. ${caption ? `Context: "${caption}".` : ''}

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

Return ONLY valid JSON (no markdown fences, no extra text) with this schema:
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

  log('info', 'Calling Claude Vision API', { model: CLAUDE_MODEL });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: imageBase64,
            },
          },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errText}`);
  }

  const data = await response.json();

  // Extract token usage
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;

  // Parse the text response as JSON
  let textContent = '';
  for (const block of data.content || []) {
    if (block.type === 'text') textContent += block.text;
  }

  // Strip markdown fences if present
  textContent = textContent.trim();
  if (textContent.startsWith('```')) {
    textContent = textContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  let analysis;
  try {
    analysis = JSON.parse(textContent);
  } catch (parseErr) {
    log('error', 'Failed to parse Claude response as JSON', { text: textContent.substring(0, 500) });
    throw new Error('Claude returned invalid JSON: ' + parseErr.message);
  }

  return { analysis, inputTokens, outputTokens };
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
 * Uses heuristics to extract brand, product name, paint code from title/description.
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

function calculateClaudeCost(inputTokens, outputTokens) {
  return ((inputTokens * INPUT_PRICE_PER_M) + (outputTokens * OUTPUT_PRICE_PER_M)) / 1_000_000;
}

// ============================================
// Process a single job
// ============================================
async function processJob(job) {
  log('info', `Processing job ${job.id}`, { caption: job.caption, image_url: job.image_url?.substring(0, 80) });

  // Mark as processing
  await supabase
    .from('paint_analysis_jobs')
    .update({
      status: 'processing',
      started_at: new Date().toISOString(),
      attempt_count: (job.attempt_count || 0) + 1,
    })
    .eq('id', job.id);

  try {
    // 1. Download image
    log('info', 'Downloading image...');
    const { base64, mimeType } = await downloadImage(job.image_url);
    log('info', `Image downloaded: ${mimeType}, ${Math.round(base64.length / 1024)}KB base64`);

    // 2. Analyze with Claude
    const { analysis, inputTokens, outputTokens } = await analyzeWithClaude(base64, mimeType, job.caption);
    log('info', `Claude analysis complete: ${analysis.colors?.length || 0} colors found`, { inputTokens, outputTokens });

    // Log Claude usage
    const claudeCost = calculateClaudeCost(inputTokens, outputTokens);
    await logApiUsage('anthropic', 'paint_color_analysis', CLAUDE_MODEL, job, {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: claudeCost,
      metadata: { model: CLAUDE_MODEL, colors_found: analysis.colors?.length || 0 },
    });

    // 3. Search for paint matches
    let searchResults = { colors: [], totalQueries: 0 };
    if (analysis.colors && analysis.colors.length > 0) {
      log('info', `Searching for paint matches for ${analysis.colors.length} colors...`);
      searchResults = await searchPaintMatches(analysis.colors);
      log('info', `Search complete: ${searchResults.totalQueries} queries`, {
        matches: searchResults.colors.map(c => c.matches.length),
      });

      // Log Brave usage
      await logApiUsage('brave', 'paint_color_search', 'web_search', job, {
        units: searchResults.totalQueries,
        unit_type: 'queries',
        estimated_cost_usd: searchResults.totalQueries * BRAVE_COST_PER_QUERY,
        metadata: { colors_searched: analysis.colors.length, total_queries: searchResults.totalQueries },
      });
    }

    // 4. Update job as completed
    const totalCost = claudeCost + (searchResults.totalQueries * BRAVE_COST_PER_QUERY);
    await supabase
      .from('paint_analysis_jobs')
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

    log('info', `Job ${job.id} completed successfully`, { cost: totalCost.toFixed(4) });

  } catch (err) {
    log('error', `Job ${job.id} failed`, { error: err.message });

    const newAttempt = (job.attempt_count || 0) + 1;
    const newStatus = newAttempt >= (job.max_attempts || 3) ? 'failed' : 'pending';

    await supabase
      .from('paint_analysis_jobs')
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
      .from('paint_analysis_jobs')
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

log('info', '🎨 Paint Color Analyzer Worker starting', {
  poll_interval: POLL_INTERVAL_MS,
  model: CLAUDE_MODEL,
});

// Ensure temp dir exists
await mkdir(TEMP_DIR, { recursive: true });

// Initial poll
await pollForJobs();

// Start poll loop
setInterval(pollForJobs, POLL_INTERVAL_MS);

log('info', 'Worker running — polling for paint analysis jobs');
