#!/usr/bin/env node
/**
 * Gmail Management Utility
 *
 * Manages labels, filters, and reads emails for alpacaplayhouse@gmail.com.
 * Requires: node scripts/gmail-setup.js (one-time OAuth)
 *
 * Usage:
 *   node scripts/gmail-manage.js labels                    # List labels
 *   node scripts/gmail-manage.js create-label "Name"       # Create label
 *   node scripts/gmail-manage.js filters                   # List filters
 *   node scripts/gmail-manage.js setup-bcc-filter          # Create BCC archive filter
 *   node scripts/gmail-manage.js recent [count]            # Show recent emails
 *   node scripts/gmail-manage.js search "query" [count]    # Search emails
 */

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

// Support --account <name> for multi-account tokens
const accountFlag = process.argv.indexOf('--account');
const ACCOUNT_NAME = accountFlag !== -1 ? process.argv[accountFlag + 1] : null;
const TOKEN_PATH = ACCOUNT_NAME
  ? path.join(require('os').homedir(), `.gmail-tokens-${ACCOUNT_NAME}.json`)
  : path.join(require('os').homedir(), '.alpacapps-gmail-tokens.json');

function getClient() {
  // Load credentials
  let clientId, clientSecret;
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
    clientId = process.env.GMAIL_CLIENT_ID;
    clientSecret = process.env.GMAIL_CLIENT_SECRET;
  } else {
    const credPath = path.join(__dirname, 'gmail-credentials.json');
    if (!fs.existsSync(credPath)) {
      console.error('No credentials. Run gmail-setup.js first.');
      process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    const cred = raw.installed || raw.web || raw;
    clientId = cred.client_id;
    clientSecret = cred.client_secret;
  }

  // Load tokens
  if (!fs.existsSync(TOKEN_PATH)) {
    console.error('No tokens. Run: node scripts/gmail-setup.js');
    process.exit(1);
  }
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials(tokens);

  // Save refreshed tokens
  oauth2.on('tokens', (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
  });

  return google.gmail({ version: 'v1', auth: oauth2 });
}

async function listLabels(gmail) {
  const res = await gmail.users.labels.list({ userId: 'me' });
  const labels = res.data.labels || [];
  labels.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`\n${labels.length} labels:\n`);
  for (const l of labels) {
    const type = l.type === 'system' ? '(system)' : '';
    console.log(`  ${l.name} ${type}  [id: ${l.id}]`);
  }
}

async function createLabel(gmail, name) {
  try {
    const res = await gmail.users.labels.create({
      userId: 'me',
      requestBody: {
        name,
        labelListVisibility: 'labelShow',
        messageListVisibility: 'show',
      },
    });
    console.log(`Created label: "${res.data.name}" [id: ${res.data.id}]`);
    return res.data;
  } catch (e) {
    if (e.message?.includes('already exists')) {
      console.log(`Label "${name}" already exists`);
      // Find and return it
      const labels = (await gmail.users.labels.list({ userId: 'me' })).data.labels;
      return labels.find(l => l.name === name);
    }
    throw e;
  }
}

async function listFilters(gmail) {
  const res = await gmail.users.settings.filters.list({ userId: 'me' });
  const filters = res.data.filter || [];
  console.log(`\n${filters.length} filters:\n`);
  for (const f of filters) {
    const c = f.criteria || {};
    const a = f.action || {};
    const criteria = [];
    if (c.from) criteria.push(`from:${c.from}`);
    if (c.to) criteria.push(`to:${c.to}`);
    if (c.subject) criteria.push(`subject:${c.subject}`);
    if (c.query) criteria.push(`query:${c.query}`);
    if (c.hasAttachment) criteria.push('has:attachment');

    const actions = [];
    if (a.addLabelIds) actions.push(`+label: ${a.addLabelIds.join(', ')}`);
    if (a.removeLabelIds) actions.push(`-label: ${a.removeLabelIds.join(', ')}`);
    if (a.forward) actions.push(`fwd: ${a.forward}`);

    console.log(`  [${f.id}]`);
    console.log(`    Criteria: ${criteria.join(' AND ') || '(none)'}`);
    console.log(`    Actions: ${actions.join('; ') || '(none)'}`);
    console.log();
  }
}

async function setupBccFilter(gmail) {
  // Step 1: Create label "AlpacApps Outbound" if not exists
  console.log('Setting up BCC archive filter...\n');

  const label = await createLabel(gmail, 'AlpacApps Outbound');
  const labelId = label?.id;
  if (!labelId) {
    console.error('Failed to create/find label');
    return;
  }

  // Step 2: Create filter matching BCC'd emails from our senders
  // Gmail filters can match on deliveredto or list headers, but for BCC
  // the best approach is matching the from addresses since we control them.
  const senders = [
    'noreply@alpacaplayhouse.com',
    'team@alpacaplayhouse.com',
    'pai@alpacaplayhouse.com',
    'notifications@alpacaplayhouse.com',
    'claudero@alpacaplayhouse.com',
    'auto@alpacaplayhouse.com',
  ];

  // Gmail filter "from" accepts OR with spaces/braces
  const fromQuery = `{${senders.join(' ')}}`;

  try {
    const res = await gmail.users.settings.filters.create({
      userId: 'me',
      requestBody: {
        criteria: {
          from: fromQuery,
        },
        action: {
          addLabelIds: [labelId],
          removeLabelIds: ['INBOX'], // Skip inbox
        },
      },
    });
    console.log(`✅ Filter created [${res.data.id}]`);
    console.log(`   From: ${fromQuery}`);
    console.log(`   Action: Apply "AlpacApps Outbound" label, skip inbox`);
    console.log('\nAll BCC emails from AlpacApps will now go to the "AlpacApps Outbound" label and skip the inbox.');
  } catch (e) {
    if (e.message?.includes('already exists') || e.code === 409) {
      console.log('A matching filter already exists.');
    } else {
      throw e;
    }
  }
}

async function recentEmails(gmail, count = 10) {
  const res = await gmail.users.messages.list({
    userId: 'me',
    maxResults: count,
  });
  const messages = res.data.messages || [];
  console.log(`\nLast ${messages.length} emails:\n`);

  for (const msg of messages) {
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date', 'To'],
    });
    const headers = detail.data.payload?.headers || [];
    const get = (name) => headers.find(h => h.name === name)?.value || '';
    const labels = detail.data.labelIds || [];
    console.log(`  ${get('Date')}`);
    console.log(`    From: ${get('From')}`);
    console.log(`    To: ${get('To')}`);
    console.log(`    Subject: ${get('Subject')}`);
    console.log(`    Labels: ${labels.join(', ')}`);
    console.log();
  }
}

async function searchEmails(gmail, query, count = 10) {
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: count,
  });
  const messages = res.data.messages || [];
  console.log(`\n${messages.length} results for "${query}":\n`);

  for (const msg of messages) {
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date'],
    });
    const headers = detail.data.payload?.headers || [];
    const get = (name) => headers.find(h => h.name === name)?.value || '';
    console.log(`  ${get('Date')} | ${get('From')}`);
    console.log(`    ${get('Subject')}`);
    console.log();
  }
}

// Main
(async () => {
  // Strip --account <name> from argv before parsing command
  const filteredArgs = process.argv.slice(2).filter((a, i, arr) => a !== '--account' && arr[i - 1] !== '--account');
  const [command, ...args] = filteredArgs;
  const gmail = getClient();

  switch (command) {
    case 'labels':
      await listLabels(gmail);
      break;
    case 'create-label':
      if (!args[0]) { console.error('Usage: create-label "Name"'); process.exit(1); }
      await createLabel(gmail, args[0]);
      break;
    case 'filters':
      await listFilters(gmail);
      break;
    case 'setup-bcc-filter':
      await setupBccFilter(gmail);
      break;
    case 'recent':
      await recentEmails(gmail, parseInt(args[0]) || 10);
      break;
    case 'search':
      if (!args[0]) { console.error('Usage: search "query" [count]'); process.exit(1); }
      await searchEmails(gmail, args[0], parseInt(args[1]) || 10);
      break;
    default:
      console.log('Gmail Management Utility\n');
      console.log('Commands:');
      console.log('  labels                     List all labels');
      console.log('  create-label "Name"        Create a label');
      console.log('  filters                    List all filters');
      console.log('  setup-bcc-filter           Create BCC archive filter (skip inbox, label)');
      console.log('  recent [count]             Show recent emails');
      console.log('  search "query" [count]     Search emails');
  }
})();
