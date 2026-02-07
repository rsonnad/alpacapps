/**
 * Seed script for bulk image enhancement via Gemini image editing.
 *
 * Usage:
 *   TEST MODE (default): node seed-enhance-batch.js
 *     - Inserts 6 test jobs: 2 photos x 3 styles
 *
 *   FULL BATCH: node seed-enhance-batch.js --batch "prompt text here"
 *     - Inserts jobs for ALL space-linked media with the given prompt
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required. Set it in .env or environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================
// Test mode: 2 photos x 3 styles = 6 jobs
// ============================================
const TEST_PHOTOS = [
  { mediaId: '19733d48-1c0d-4b1d-ae68-304354fb1687', label: 'Spartan Trailer (exterior)' },
  { mediaId: 'add95575-7616-41ce-8ecd-0ef99255903d', label: 'Spartan Tea Lounge (interior)' },
];

const TEST_STYLES = [
  {
    name: 'Warm Airbnb Pro',
    prompt: 'Enhance this real estate photo to look warm, inviting, and professionally styled. Improve lighting and color balance. Keep the scene and composition exactly as-is — do not add, remove, or rearrange any objects. Make it look like a high-end Airbnb listing photo.',
  },
  {
    name: 'Magazine Editorial',
    prompt: 'Transform this photo into a dramatic editorial-style image with rich contrast, deep shadows, and warm moody atmosphere. Keep the scene exactly as-is. Make it look like an Architectural Digest feature.',
  },
  {
    name: 'Bright & Airy',
    prompt: 'Make this photo bright, airy, and light-filled with soft natural tones and clean whites. Keep the scene exactly as-is. Make it look like a modern Scandinavian-inspired interior design magazine.',
  },
];

async function seedTestJobs() {
  const batchId = crypto.randomUUID();
  const jobs = [];

  for (const photo of TEST_PHOTOS) {
    // Look up the space_id for this media
    const { data: link } = await supabase
      .from('media_spaces')
      .select('space_id')
      .eq('media_id', photo.mediaId)
      .limit(1)
      .single();

    for (const style of TEST_STYLES) {
      jobs.push({
        prompt: style.prompt,
        job_type: 'image_edit',
        source_media_id: photo.mediaId,
        space_id: link?.space_id || null,
        batch_id: batchId,
        batch_label: 'Style Test',
        priority: 10,
        metadata: { style_name: style.name, source_label: photo.label },
      });
    }
  }

  const { data, error } = await supabase.from('image_gen_jobs').insert(jobs).select('id, metadata');
  if (error) {
    console.error('Failed to insert test jobs:', error.message);
    process.exit(1);
  }

  console.log(`Inserted ${data.length} test jobs (batch: ${batchId})`);
  for (const job of data) {
    console.log(`  - ${job.id}: ${job.metadata.source_label} / ${job.metadata.style_name}`);
  }
}

// ============================================
// Full batch mode: all space-linked media
// ============================================
async function seedFullBatch(prompt) {
  // Get all media linked to spaces (deduplicated)
  const { data: links, error: linkErr } = await supabase
    .from('media_spaces')
    .select('media_id, space_id, media:media_id(id, url, caption, category)')
    .order('space_id');

  if (linkErr) {
    console.error('Failed to query media_spaces:', linkErr.message);
    process.exit(1);
  }

  // Filter out AI-generated images (don't re-enhance those)
  const filtered = links.filter(l => l.media && !l.media.url?.includes('/ai-gen/'));

  const batchId = crypto.randomUUID();
  const jobs = filtered.map(l => ({
    prompt,
    job_type: 'image_edit',
    source_media_id: l.media_id,
    space_id: l.space_id,
    batch_id: batchId,
    batch_label: 'Space Photo Enhancement',
    priority: 5,
    metadata: {
      source_url: l.media.url,
      original_caption: l.media.caption,
      category: l.media.category,
    },
  }));

  // Insert in chunks of 50
  let inserted = 0;
  for (let i = 0; i < jobs.length; i += 50) {
    const chunk = jobs.slice(i, i + 50);
    const { data, error } = await supabase.from('image_gen_jobs').insert(chunk).select('id');
    if (error) {
      console.error(`Failed to insert chunk at offset ${i}:`, error.message);
      process.exit(1);
    }
    inserted += data.length;
  }

  console.log(`Inserted ${inserted} jobs for full batch (batch: ${batchId})`);
  console.log(`Prompt: "${prompt.substring(0, 80)}..."`);
}

// ============================================
// Main
// ============================================
const args = process.argv.slice(2);
if (args[0] === '--batch') {
  const prompt = args.slice(1).join(' ');
  if (!prompt) {
    console.error('Usage: node seed-enhance-batch.js --batch "your style prompt here"');
    process.exit(1);
  }
  await seedFullBatch(prompt);
} else {
  await seedTestJobs();
}
