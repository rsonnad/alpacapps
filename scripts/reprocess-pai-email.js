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

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aphrrfprbixmhissnjfn.supabase.co';

const REQUIRED_ENV = {
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
};

const missing = Object.entries(REQUIRED_ENV).filter(([, v]) => !v).map(([k]) => k);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Set them in your shell or in a .env file before running this script.');
  process.exit(1);
}

const SUPABASE_SERVICE_ROLE_KEY = REQUIRED_ENV.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = REQUIRED_ENV.RESEND_API_KEY;
const R2_ACCOUNT_ID = REQUIRED_ENV.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = REQUIRED_ENV.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = REQUIRED_ENV.R2_SECRET_ACCESS_KEY;
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
  const url = `https://api.resend.com/emails/receiving/${emailId}/attachments/${attachmentId}`;
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
        keywords: [fileExt, 'email-upload', senderName.toLowerCase(), ...subject.toLowerCase().split(/\s+/).filter(w => w.length > 3)],
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
