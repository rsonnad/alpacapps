#!/usr/bin/env node
/**
 * Reprocess a PAI email that failed to process attachments correctly.
 * Downloads attachments from Resend, uploads to R2, indexes in document_index.
 *
 * Usage: node scripts/reprocess-pai-email.js <resend_email_id>
 */

import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

const SUPABASE_URL = 'https://aphrrfprbixmhissnjfn.supabase.co';

// Try to get service role key from environment or from local secret file
let SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// If not in env, try to read from a local .env file or use the project default
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.log('SUPABASE_SERVICE_ROLE_KEY not in environment, using default key...');
  // This is the service role key from the Supabase dashboard
  SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFwaHJyZnByYml4bWhpc3NuamZuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwNzU4MTQ3OCwiZXhwIjoyMDIzMTU3NDc4fQ.8PqJHNXgQWPtXz3fzQZb2eI0qWKC5k5bxY_0f5N8XZc';
}

const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_Nnd6Vn9a_LgSBPz4k3kWRcTiNqCe7iipg';
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '9cd3a280a54ce2a5b382602f0247b577';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || 'e096a89017992c90daf23b7be0b5da0a';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || 'fc4716d54e00d0e7f936e442dfc7b6240d3e5163c721237f24936ed95be3764f';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'alpacapps';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://pub-5a7344c4dab2467eb917ff4b897e066d.r2.dev';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

async function downloadResendAttachment(emailId, attachmentId, filename) {
  const url = `https://api.resend.com/emails/${emailId}/attachments/${attachmentId}`;
  console.log(`Downloading attachment from Resend: ${url}`);

  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to download attachment: ${res.status} ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const contentType = res.headers.get('content-type') || 'application/octet-stream';

  return {
    data: new Uint8Array(arrayBuffer),
    contentType,
    filename,
  };
}

async function uploadToR2(key, data, contentType) {
  console.log(`Uploading to R2: ${key} (${data.length} bytes, ${contentType})`);

  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: data,
    ContentType: contentType,
  }));

  const publicUrl = `${R2_PUBLIC_URL}/${key}`;
  return publicUrl;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function reprocessEmail(resendEmailId) {
  console.log(`\nReprocessing email: ${resendEmailId}`);

  // Fetch email record
  const { data: email, error } = await supabase
    .from('inbound_emails')
    .select('*')
    .eq('resend_email_id', resendEmailId)
    .single();

  if (error || !email) {
    console.error('Email not found:', error?.message || 'No data');
    process.exit(1);
  }

  console.log(`\nEmail details:`);
  console.log(`  From: ${email.from_address}`);
  console.log(`  Subject: ${email.subject}`);
  console.log(`  Received: ${email.processed_at}`);

  const attachmentsMetadata = email.attachments || [];
  console.log(`  Attachments: ${attachmentsMetadata.length}`);

  if (attachmentsMetadata.length === 0) {
    console.log('No attachments to process.');
    return;
  }

  // Extract sender info
  const from = email.from_address || '';
  const senderName = (from.match(/^([^<]+)/)?.[1] || '').trim() || from.split('@')[0];
  const senderEmail = (from.match(/<(.+)>/)?.[1] || from).trim();
  const subject = email.subject || '';

  const uploadedFiles = [];

  for (let i = 0; i < attachmentsMetadata.length; i++) {
    const att = attachmentsMetadata[i];
    const filename = att.filename || att.name || `attachment-${i}`;
    const contentType = att.content_type || att.type || 'application/octet-stream';
    const attachmentId = att.id;

    console.log(`\nProcessing attachment ${i + 1}/${attachmentsMetadata.length}: ${filename}`);

    // Skip inline images
    if (contentType.startsWith('image/') && !filename.match(/\.(pdf|doc|docx|xls|xlsx|csv|txt)$/i)) {
      console.log('  Skipping inline image');
      continue;
    }

    if (!attachmentId) {
      console.error('  No attachment ID, skipping');
      continue;
    }

    try {
      // Download from Resend
      const downloaded = await downloadResendAttachment(resendEmailId, attachmentId, filename);
      console.log(`  Downloaded: ${formatFileSize(downloaded.data.length)}`);

      // Generate R2 key
      const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
      const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const r2Key = `documents/email-uploads/${datePrefix}/${sanitizedFilename}`;

      // Upload to R2
      const publicUrl = await uploadToR2(r2Key, downloaded.data, downloaded.contentType);
      console.log(`  Uploaded: ${publicUrl}`);

      // Create document_index entry (inactive pending admin review)
      const fileExt = filename.split('.').pop()?.toLowerCase() || '';
      const docSlug = sanitizedFilename.replace(/\.[^.]+$/, '');

      const { error: insertError } = await supabase.from('document_index').insert({
        slug: `email-${datePrefix}-${docSlug}`,
        title: filename,
        description: `Uploaded via email by ${senderName} (${senderEmail}). Subject: ${subject}`,
        category: 'email-upload',
        keywords: [fileExt, 'email-upload', senderName.toLowerCase(), 'septic', 'receipt', 'maintenance'],
        storage_bucket: 'r2',
        storage_path: r2Key,
        source_url: publicUrl,
        file_size_bytes: downloaded.data.length,
        storage_backend: 'r2',
        is_active: false, // Pending admin review
      });

      if (insertError) {
        console.error(`  Failed to create document_index entry: ${insertError.message}`);
      } else {
        console.log(`  Indexed in document_index (inactive, pending review)`);
      }

      uploadedFiles.push({
        name: filename,
        type: contentType,
        size: formatFileSize(downloaded.data.length),
        url: publicUrl,
      });

      // Log R2 upload cost
      await supabase.from('api_usage_log').insert({
        vendor: 'cloudflare_r2',
        category: 'r2_document_upload',
        endpoint: 'PutObject',
        units: 1,
        unit_type: 'api_calls',
        estimated_cost_usd: 0,
        metadata: {
          key: r2Key,
          size_bytes: downloaded.data.length,
          source: 'manual_reprocess',
          original_email_id: resendEmailId,
        },
      });
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  if (uploadedFiles.length > 0) {
    console.log(`\n✅ Successfully processed ${uploadedFiles.length} attachment(s):`);
    uploadedFiles.forEach(f => {
      console.log(`   - ${f.name} (${f.size})`);
      console.log(`     ${f.url}`);
    });

    // Send admin notification
    console.log('\nSending admin notification...');
    const fileListHtml = uploadedFiles.map(f =>
      `<li><strong>${f.name}</strong> (${f.size}, ${f.type})<br><a href="${f.url}">${f.url}</a></li>`
    ).join('\n');

    const { data, error } = await supabase.functions.invoke('send-email', {
      body: {
        template: 'pai_document_received',
        to: 'alpacaplayhouse@gmail.com',
        data: {
          sender_name: senderName,
          sender_email: senderEmail,
          subject: subject,
          body_preview: (email.body_text || email.body_html || '').substring(0, 500),
          file_count: uploadedFiles.length,
          file_list_html: fileListHtml,
        },
      },
    });

    if (error) {
      console.error('Failed to send admin notification:', error);
    } else {
      console.log('Admin notification sent.');
    }
  } else {
    console.log('\n⚠️  No attachments were processed.');
  }
}

// Main
const emailId = process.argv[2];
if (!emailId) {
  console.error('Usage: node scripts/reprocess-pai-email.js <resend_email_id>');
  process.exit(1);
}

reprocessEmail(emailId).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
