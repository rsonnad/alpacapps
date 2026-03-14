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

const TOKEN_PATH = path.join(require('os').homedir(), '.alpacapps-gmail-tokens.json');
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

  const REDIRECT_URI = 'http://localhost:3847/oauth2callback';
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

  // Start local server to receive callback
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://localhost:3847');
        if (url.pathname !== '/oauth2callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const code = url.searchParams.get('code');
        if (!code) {
          res.writeHead(400);
          res.end('No code received');
          return;
        }

        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);
        saveTokens(tokens);

        // Verify
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html><body style="font-family:system-ui;text-align:center;padding:60px">
            <h1>✅ Gmail API Authorized</h1>
            <p>Account: <strong>${profile.data.emailAddress}</strong></p>
            <p>You can close this tab.</p>
          </body></html>
        `);

        console.log(`\nAuthorized as: ${profile.data.emailAddress}`);
        server.close();
        resolve(oauth2Client);
      } catch (err) {
        res.writeHead(500);
        res.end('Error: ' + err.message);
        reject(err);
      }
    });

    server.listen(3847, () => {
      console.log('Waiting for OAuth callback on http://localhost:3847 ...');
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('OAuth timeout — no callback received within 5 minutes'));
    }, 300000);
  });
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
