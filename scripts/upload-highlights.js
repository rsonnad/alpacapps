#!/usr/bin/env node

/**
 * Upload Alpaca Playhouse Highlights to Supabase
 *
 * This script:
 * 1. Converts HEIC files to JPEG
 * 2. Uploads all images to Supabase storage in highlights/ folder
 * 3. Creates media records
 * 4. Tags them with "highlights"
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgxOTg2NjEsImV4cCI6MjA1Mzc3NDY2MX0.LqhPLNHD6njVPjBbZyMdu9xMj-epZ0xVWOTRcjXKlEU';
const HIGHLIGHTS_TAG_ID = 'ba1b6478-21a1-4374-b4e2-96e9dce8635e';
const SOURCE_DIR = '/Users/rahulio/Documents/CodingProjects/genalpaca-admin/assets/Alpaca Playhouse Highlights';
const TEMP_DIR = '/tmp/highlights-converted';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Create temp directory for converted files
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Get all files in the source directory
const files = fs.readdirSync(SOURCE_DIR);

// Filter for image files only (skip videos for now)
const imageExtensions = ['.jpg', '.jpeg', '.png', '.heic', '.gif'];
const imageFiles = files.filter(f => {
  const ext = path.extname(f).toLowerCase();
  return imageExtensions.includes(ext);
});

console.log(`Found ${imageFiles.length} image files to process`);

async function processAndUpload() {
  const results = [];

  for (const file of imageFiles) {
    const ext = path.extname(file).toLowerCase();
    const baseName = path.basename(file, ext);
    const sourcePath = path.join(SOURCE_DIR, file);

    let uploadPath;
    let mimeType;

    // Convert HEIC to JPEG
    if (ext === '.heic') {
      const convertedPath = path.join(TEMP_DIR, `${baseName}.jpg`);
      console.log(`Converting ${file} to JPEG...`);
      try {
        execSync(`sips -s format jpeg "${sourcePath}" --out "${convertedPath}"`, { stdio: 'pipe' });
        uploadPath = convertedPath;
        mimeType = 'image/jpeg';
      } catch (err) {
        console.error(`Failed to convert ${file}:`, err.message);
        continue;
      }
    } else {
      uploadPath = sourcePath;
      mimeType = ext === '.png' ? 'image/png' :
                 ext === '.gif' ? 'image/gif' : 'image/jpeg';
    }

    // Read file
    const fileBuffer = fs.readFileSync(uploadPath);
    const fileSize = fileBuffer.length;

    // Generate storage path
    const storagePath = `highlights/${baseName}${ext === '.heic' ? '.jpg' : ext}`;

    console.log(`Uploading ${storagePath}...`);

    // Upload to Supabase storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('housephotos')
      .upload(storagePath, fileBuffer, {
        contentType: mimeType,
        upsert: true
      });

    if (uploadError) {
      console.error(`Failed to upload ${file}:`, uploadError.message);
      continue;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('housephotos')
      .getPublicUrl(storagePath);

    const publicUrl = urlData.publicUrl;

    results.push({
      url: publicUrl,
      storage_path: storagePath,
      mime_type: mimeType,
      file_size_bytes: fileSize,
      title: baseName.replace(/_/g, ' ').replace(/-/g, ' ')
    });

    console.log(`✓ Uploaded: ${storagePath}`);
  }

  return results;
}

async function createMediaRecords(uploadedFiles) {
  console.log(`\nCreating ${uploadedFiles.length} media records...`);

  for (const file of uploadedFiles) {
    // Insert media record
    const { data: mediaData, error: mediaError } = await supabase
      .from('media')
      .insert({
        url: file.url,
        storage_provider: 'supabase',
        storage_path: file.storage_path,
        media_type: 'image',
        mime_type: file.mime_type,
        file_size_bytes: file.file_size_bytes,
        title: file.title,
        category: 'mktg'
      })
      .select('id')
      .single();

    if (mediaError) {
      console.error(`Failed to create media record for ${file.storage_path}:`, mediaError.message);
      continue;
    }

    // Tag with highlights
    const { error: tagError } = await supabase
      .from('media_tag_assignments')
      .insert({
        media_id: mediaData.id,
        tag_id: HIGHLIGHTS_TAG_ID
      });

    if (tagError) {
      console.error(`Failed to tag media ${mediaData.id}:`, tagError.message);
    } else {
      console.log(`✓ Created and tagged: ${file.title}`);
    }
  }
}

async function main() {
  try {
    const uploadedFiles = await processAndUpload();
    await createMediaRecords(uploadedFiles);

    console.log(`\n✅ Successfully processed ${uploadedFiles.length} images`);

    // Cleanup temp directory
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
