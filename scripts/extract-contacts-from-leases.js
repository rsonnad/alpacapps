#!/usr/bin/env node
/**
 * Extract phone numbers and emails from lease documents (local PDFs or Google Drive).
 * Use results to fill missing people.phone / people.email (e.g. Ai Ko email, resident phones).
 *
 * Usage:
 *   Local PDFs (e.g. downloaded from Drive):
 *     cd scripts && npm install && node extract-contacts-from-leases.js /path/to/lease-pdfs
 *
 *   Google Drive (service account; folder must be shared with the SA email):
 *     export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *     export DRIVE_FOLDER_ID=1IdMGhprT0LskK7g6zN9xw1O8ECtrS0eQ
 *     node extract-contacts-from-leases.js --drive
 *
 * Output: JSON of { byFile, suggestedUpdates }. suggestedUpdates = [ { firstName, lastName, email?, phone? } ].
 * With --sql: prints UPDATE statements for people (match by first_name + last_name).
 */

const fs = require('fs');
const path = require('path');

const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID || '1IdMGhprT0LskK7g6zN9xw1O8ECtrS0eQ';

// Regex for email and US-style phone
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE_RE = /(\+?1?[-.\s()]*)?\(?[0-9]{3}\)?[-.\s]*[0-9]{3}[-.\s]*[0-9]{4}\b/g;

function extractEmails(text) {
  if (!text || typeof text !== 'string') return [];
  const set = new Set();
  let m;
  const re = new RegExp(EMAIL_RE.source, 'g');
  while ((m = re.exec(text)) !== null) set.add(m[0].toLowerCase().trim());
  return [...set];
}

function extractPhones(text) {
  if (!text || typeof text !== 'string') return [];
  const set = new Set();
  let m;
  const re = new RegExp(PHONE_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    const normalized = m[0].replace(/\D/g, '');
    if (normalized.length >= 10) set.add(m[0].trim());
  }
  return [...set];
}

/** Guess tenant name from filename: "Ai Ko - Lease.pdf" or "John Churchill Agreement.pdf" */
function nameFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  const without = base.replace(/\s*[-–]?\s*(lease|agreement|rental|signed|\.pdf)$/i, '').trim();
  const parts = without.split(/\s+/).filter(Boolean);
  // Require at least two words and no digits / file-like patterns
  if (parts.length < 2) return null;
  if (/\d/.test(without) || parts.some((p) => p.length > 30 || /^[.-]/.test(p))) return null;
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** Normalize phone to digits for comparison */
function phoneDigits(p) {
  return (p || '').replace(/\D/g, '').slice(-10);
}

async function extractTextFromPdfBuffer(buffer) {
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (e) {
    console.error('pdf-parse error:', e.message);
    return '';
  }
}

async function getPdfsFromDrive() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath || !fs.existsSync(keyPath)) {
    throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON path. Share the Drive folder with that account email.');
  }
  const { google } = require('googleapis');
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  const drive = google.drive({ version: 'v3', auth });

  const res = await drive.files.list({
    q: `'${DRIVE_FOLDER_ID}' in parents and (mimeType='application/pdf' or mimeType='application/vnd.google-apps.document')`,
    fields: 'files(id, name, mimeType)',
    pageSize: 200,
  });

  const files = res.data.files || [];
  const out = [];
  for (const f of files) {
    let buffer;
    if (f.mimeType === 'application/pdf') {
      const resp = await drive.files.get({ fileId: f.id, alt: 'media' }, { responseType: 'arraybuffer' });
      buffer = Buffer.from(resp.data);
    } else if (f.mimeType === 'application/vnd.google-apps.document') {
      const resp = await drive.files.export({ fileId: f.id, mimeType: 'text/plain' }, { responseType: 'arraybuffer' });
      buffer = Buffer.from(resp.data);
      const text = buffer.toString('utf8');
      out.push({ name: f.name, text, buffer: null });
      continue;
    } else continue;
    const text = await extractTextFromPdfBuffer(buffer);
    out.push({ name: f.name, text, buffer });
  }
  return out;
}

async function getPdfsFromLocal(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (ext !== '.pdf') continue;
    const buffer = fs.readFileSync(full);
    const text = await extractTextFromPdfBuffer(buffer);
    out.push({ name: e.name, text, buffer: null });
  }
  return out;
}

function suggestUpdates(byFile) {
  const byPerson = new Map(); // key: "firstName|lastName" -> { firstName, lastName, emails: Set, phones: Set }
  for (const { name, emails, phones } of byFile) {
    const person = nameFromFilename(name);
    const key = person ? `${(person.firstName || '').toLowerCase()}|${(person.lastName || '').toLowerCase()}` : null;
    if (!key) continue;
    if (!byPerson.has(key)) byPerson.set(key, { firstName: person.firstName, lastName: person.lastName, emails: new Set(), phones: new Set() });
    const rec = byPerson.get(key);
    emails.forEach((e) => rec.emails.add(e));
    phones.forEach((p) => rec.phones.add(p));
  }
  return [...byPerson.values()].map((r) => ({
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.emails.size ? [...r.emails][0] : null,
    phone: r.phones.size ? [...r.phones][0] : null,
  }));
}

async function main() {
  const args = process.argv.slice(2);
  const useDrive = args.includes('--drive');
  const emitSql = args.includes('--sql');
  const localDir = args.find((a) => !a.startsWith('--'));

  let files;
  if (useDrive) {
    console.error('Fetching file list from Google Drive...');
    files = await getPdfsFromDrive();
  } else if (localDir && fs.existsSync(localDir)) {
    files = await getPdfsFromLocal(localDir);
  } else {
    console.error('Usage: node extract-contacts-from-leases.js <path-to-pdf-folder>');
    console.error('   or: node extract-contacts-from-leases.js --drive  (requires GOOGLE_APPLICATION_CREDENTIALS and DRIVE_FOLDER_ID)');
    process.exit(1);
  }

  const byFile = files.map(({ name, text }) => ({
    name,
    emails: extractEmails(text),
    phones: extractPhones(text),
  }));

  const suggestedUpdates = suggestUpdates(byFile);

  if (emitSql) {
    const DB_URL = process.env.SUPABASE_DB_URL;
    if (!DB_URL) console.error('Set SUPABASE_DB_URL to run updates.');
    suggestedUpdates.forEach((u) => {
      const updates = [];
      if (u.email) updates.push(`email = ${escapeLiteral(u.email)}`);
          if (u.phone) updates.push(`phone = ${escapeLiteral(u.phone)}`);
      if (updates.length === 0) return;
      const where = [
        `LOWER(TRIM(first_name)) = ${escapeLiteral((u.firstName || '').toLowerCase())}`,
        u.lastName ? `LOWER(TRIM(last_name)) = ${escapeLiteral((u.lastName || '').toLowerCase())}` : '(last_name IS NULL OR TRIM(last_name) = \'\')',
      ].join(' AND ');
      console.log(`UPDATE people SET ${updates.join(', ')} WHERE ${where};`);
    });
  } else {
    console.log(JSON.stringify({ byFile, suggestedUpdates }, null, 2));
  }
}

function escapeLiteral(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
