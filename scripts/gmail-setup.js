#!/usr/bin/env node
/**
 * Gmail API OAuth Setup
 *
 * One-time setup to authorize Gmail API access for alpacaplayhouse@gmail.com.
 * Stores refresh token in ~/.alpacapps-gmail-tokens.json
 *
 * Prerequisites:
 *   1. Enable Gmail API in Google Cloud Console (project: aiclaw-486101)
 *   2. Create OAuth 2.0 Desktop App credentials
 *   3. Download client_secret JSON or set env vars
 *
 * Usage:
 *   node scripts/gmail-setup.js              # Interactive OAuth flow
 *   node scripts/gmail-setup.js --status     # Check token status
 */

const { google } = require('googleapis');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Support --account <name> for multi-account tokens
const accountFlag = process.argv.indexOf('--account');
const ACCOUNT_NAME = accountFlag !== -1 ? process.argv[accountFlag + 1] : null;
const TOKEN_PATH = ACCOUNT_NAME
  ? path.join(require('os').homedir(), `.gmail-tokens-${ACCOUNT_NAME}.json`)
  : path.join(require('os').homedir(), '.alpacapps-gmail-tokens.json');
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.settings.basic',  // Filters, labels
  'https://www.googleapis.com/auth/gmail.labels',          // Create/manage labels
  'https://www.googleapis.com/auth/gmail.readonly',        // Read emails
  'https://www.googleapis.com/auth/gmail.modify',          // Modify (label, archive)
];

// Try loading credentials from env or file
function getCredentials() {
  // Option 1: Environment variables
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
    return {
      client_id: process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
    };
  }

  // Option 2: credentials file
  const credPath = path.join(__dirname, 'gmail-credentials.json');
  if (fs.existsSync(credPath)) {
    const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const cred = raw.installed || raw.web || raw;
    return {
      client_id: cred.client_id,
      client_secret: cred.client_secret,
    };
  }

  return null;
}

function loadTokens() {
  if (fs.existsSync(TOKEN_PATH)) {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  }
  return null;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  fs.chmodSync(TOKEN_PATH, 0o600);
  console.log(`Tokens saved to ${TOKEN_PATH}`);
}

async function authorize() {
  const creds = getCredentials();
  if (!creds) {
    console.error('No credentials found. Either:');
    console.error('  1. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET env vars');
    console.error('  2. Place gmail-credentials.json (downloaded from Google Cloud Console) in scripts/');
    console.error('');
    console.error('To create credentials:');
    console.error('  1. Go to https://console.cloud.google.com/apis/credentials?project=aiclaw-486101');
    console.error('  2. Enable Gmail API: https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=aiclaw-486101');
    console.error('  3. Create OAuth 2.0 Client ID → Desktop App');
    console.error('  4. Download JSON → save as scripts/gmail-credentials.json');
    process.exit(1);
  }

  // Desktop apps: use http://localhost (no port) as redirect_uri for Google's
  // validation, but listen on an ephemeral port. Google will redirect to
  // http://localhost?code=... and the browser will fail to connect (port 80),
  // so we use the OOB-style manual code paste as fallback.
  const PORT = 3847;
  // Use exact redirect_uri from credentials file
  const REDIRECT_URI = 'http://localhost';
  const oauth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    REDIRECT_URI,
  );

  // Check for existing tokens
  const existing = loadTokens();
  if (existing) {
    oauth2Client.setCredentials(existing);
    try {
      // Test if token works
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      console.log(`Already authorized as: ${profile.data.emailAddress}`);
      console.log(`Messages total: ${profile.data.messagesTotal}`);
      return oauth2Client;
    } catch (e) {
      console.log('Existing token expired, re-authorizing...');
    }
  }

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force refresh token
  });

  console.log('\n=== Gmail API Authorization ===');
  console.log('Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('');
  console.log('After authorizing, the browser will redirect to http://localhost/?code=...');
  console.log('The page will fail to load (that\'s OK). Copy the FULL URL from your');
  console.log('browser\'s address bar and paste it below.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question('Paste the redirect URL here: ', resolve);
  });
  rl.close();

  // Extract code from the pasted URL
  let code;
  try {
    const redirectUrl = new URL(answer.trim());
    code = redirectUrl.searchParams.get('code');
  } catch {
    // Maybe they pasted just the code
    code = answer.trim();
  }

  if (!code) {
    throw new Error('No authorization code found in the pasted URL');
  }

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  saveTokens(tokens);

  // Verify
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  console.log(`\n✅ Authorized as: ${profile.data.emailAddress}`);
  console.log(`Messages total: ${profile.data.messagesTotal}`);
  return oauth2Client;
}

async function checkStatus() {
  const tokens = loadTokens();
  if (!tokens) {
    console.log('No tokens found. Run: node scripts/gmail-setup.js');
    return;
  }
  console.log('Token file:', TOKEN_PATH);
  console.log('Has refresh_token:', !!tokens.refresh_token);
  console.log('Has access_token:', !!tokens.access_token);
  if (tokens.expiry_date) {
    const exp = new Date(tokens.expiry_date);
    console.log('Access token expires:', exp.toISOString(), exp > new Date() ? '(valid)' : '(expired)');
  }

  // Try to use it
  const creds = getCredentials();
  if (creds) {
    const oauth2Client = new google.auth.OAuth2(creds.client_id, creds.client_secret);
    oauth2Client.setCredentials(tokens);
    try {
      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const profile = await gmail.users.getProfile({ userId: 'me' });
      console.log('Account:', profile.data.emailAddress);
      console.log('Status: ✅ Working');
    } catch (e) {
      console.log('Status: ❌ Token invalid —', e.message);
    }
  }
}

// Main
(async () => {
  if (process.argv.includes('--status')) {
    await checkStatus();
  } else {
    await authorize();
  }
})();
