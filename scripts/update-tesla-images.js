#!/usr/bin/env node
/**
 * Update Tesla vehicle image URLs with real Tesla configurator images.
 * Run this script to update the image_url field for all vehicles.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable not set');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Placeholder: Use generic car photos from placeholder services temporarily
// TODO: Replace with actual photos of the cars
const VEHICLE_IMAGES = {
  'Casper': 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=800&q=80',  // White Tesla Model 3
  'Delphi': 'https://images.unsplash.com/photo-1617788138017-80ad40651399?w=800&q=80',  // White Tesla Model Y
  'Sloop': 'https://images.unsplash.com/photo-1617788138017-80ad40651399?w=800&q=80',  // White Tesla Model Y
  'Cygnus': 'https://images.unsplash.com/photo-1536700503339-1e4b06520771?w=800&q=80',  // Grey Tesla Model Y
  'Kimba': 'https://images.unsplash.com/photo-1617788138017-80ad40651399?w=800&q=80',  // White Tesla Model Y
  'Brisa Branca': 'https://images.unsplash.com/photo-1560958089-b8a1929cea89?w=800&q=80'  // White Tesla Model 3
};

async function updateVehicleImages() {
  console.log('Updating Tesla vehicle images...\n');

  for (const [name, imageUrl] of Object.entries(VEHICLE_IMAGES)) {
    console.log(`Updating ${name}...`);

    const { data, error } = await supabase
      .from('tesla_vehicles')
      .update({ image_url: imageUrl })
      .eq('name', name)
      .select();

    if (error) {
      console.error(`  ✗ Failed to update ${name}:`, error.message);
    } else if (data && data.length > 0) {
      console.log(`  ✓ Updated ${name}`);
    } else {
      console.warn(`  ⚠ Vehicle "${name}" not found in database`);
    }
  }

  console.log('\n✓ Image update complete!');
  console.log('Refresh the cars page to see the new photos.');
}

updateVehicleImages().catch(console.error);
