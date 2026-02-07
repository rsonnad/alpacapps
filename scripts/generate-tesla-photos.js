#!/usr/bin/env node
/**
 * Generate realistic photos for Tesla vehicles using AI image generation.
 * Queues jobs in image_gen_jobs table; worker picks them up and generates images.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3Nuamh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTgwMTQ0MTIsImV4cCI6MjAxMzU5MDQxMn0.cGxGXvKF5Bn4V5fV7FPkQPnQHqHYXJY_A5XnYYqN1Qo';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const VEHICLES = [
  {
    name: 'Casper',
    model: 'Model 3',
    year: 2019,
    color: 'White',
    prompt: 'A professional studio photograph of a pristine white 2019 Tesla Model 3 sedan, three-quarter front view, clean white background, sharp focus, automotive photography, 4K resolution, no watermarks'
  },
  {
    name: 'Delphi',
    model: 'Model Y',
    year: 2023,
    color: 'White',
    prompt: 'A professional studio photograph of a pristine white 2023 Tesla Model Y SUV, three-quarter front view, clean white background, sharp focus, automotive photography, 4K resolution, no watermarks'
  },
  {
    name: 'Sloop',
    model: 'Model Y',
    year: 2026,
    color: 'White',
    prompt: 'A professional studio photograph of a pristine white 2026 Tesla Model Y SUV, three-quarter front view, clean white background, sharp focus, automotive photography, 4K resolution, no watermarks'
  },
  {
    name: 'Cygnus',
    model: 'Model Y',
    year: 2026,
    color: 'Grey',
    prompt: 'A professional studio photograph of a sleek midnight silver grey 2026 Tesla Model Y SUV, three-quarter front view, clean white background, sharp focus, automotive photography, 4K resolution, no watermarks'
  },
  {
    name: 'Kimba',
    model: 'Model Y',
    year: 2022,
    color: 'White',
    prompt: 'A professional studio photograph of a pristine white 2022 Tesla Model Y SUV, three-quarter front view, clean white background, sharp focus, automotive photography, 4K resolution, no watermarks'
  },
  {
    name: 'Brisa Branca',
    model: 'Model 3',
    year: 2022,
    color: 'White',
    prompt: 'A professional studio photograph of a pristine white 2022 Tesla Model 3 sedan, three-quarter front view, clean white background, sharp focus, automotive photography, 4K resolution, no watermarks'
  }
];

async function main() {
  console.log('Generating Tesla vehicle photos...\n');

  const batchId = `tesla-photos-${Date.now()}`;

  for (const vehicle of VEHICLES) {
    console.log(`Queueing image generation for ${vehicle.name} (${vehicle.year} ${vehicle.model})...`);

    const { data, error } = await supabase
      .from('image_gen_jobs')
      .insert({
        prompt: vehicle.prompt,
        job_type: 'generate',
        status: 'pending',
        metadata: {
          vehicle_name: vehicle.name,
          model: vehicle.model,
          year: vehicle.year,
          color: vehicle.color,
          purpose: 'tesla_vehicle_photo'
        },
        batch_id: batchId,
        batch_label: 'Tesla Vehicle Photos',
        priority: 10,
        max_attempts: 3
      })
      .select()
      .single();

    if (error) {
      console.error(`  ✗ Failed to queue ${vehicle.name}:`, error.message);
    } else {
      console.log(`  ✓ Queued job ${data.id} for ${vehicle.name}`);
    }
  }

  console.log('\n✓ All jobs queued successfully!');
  console.log(`Batch ID: ${batchId}`);
  console.log('\nThe worker will process these jobs and generate images.');
  console.log('Once generated, you can link them to vehicles in the tesla_vehicles table.');
}

main().catch(console.error);
