/**
 * PAI Discord Bot
 * Bridges Discord messages to the alpaca-pai Supabase edge function.
 * Discord is just another channel — same as web chat, email, and voice.
 */

import { Client, GatewayIntentBits, Partials } from 'discord.js';

// ============================================
// Configuration
// ============================================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHANNEL_IDS = (process.env.CHANNEL_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

const PAI_ENDPOINT = `${SUPABASE_URL}/functions/v1/alpaca-pai`;
const MAX_HISTORY = 12;
const HISTORY_TTL_MS = 30 * 60 * 1000; // 30 min idle = clear history
const DISCORD_MAX_LENGTH = 2000;
const TYPING_REFRESH_MS = 8000; // Discord clears typing after 10s

// ============================================
// Startup validation
// ============================================
if (!DISCORD_TOKEN) { console.error('DISCORD_TOKEN is required'); process.exit(1); }
if (!SUPABASE_SERVICE_ROLE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY is required'); process.exit(1); }

// ============================================
// Logging (matches other AlpacApps workers)
// ============================================
function log(level, msg, data = {}) {
  const ts = new Date().toISOString();
  const extra = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${ts}] [${level}] ${msg}${extra}`);
}

// ============================================
// Conversation History (in-memory, per user)
// ============================================
const conversations = new Map();

function getHistory(userId) {
  const entry = conversations.get(userId);
  if (!entry) return [];
  if (Date.now() - entry.lastActivity > HISTORY_TTL_MS) {
    conversations.delete(userId);
    return [];
  }
  return entry.messages;
}

function addToHistory(userId, role, text) {
  let entry = conversations.get(userId);
  if (!entry) {
    entry = { messages: [], lastActivity: Date.now() };
    conversations.set(userId, entry);
  }
  entry.lastActivity = Date.now();
  entry.messages.push({ role, text });
  if (entry.messages.length > MAX_HISTORY) {
    entry.messages = entry.messages.slice(-MAX_HISTORY);
  }
}

// ============================================
// PAI API Call
// ============================================
async function callPai(message, userId, userName, conversationHistory) {
  const response = await fetch(PAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      conversationHistory,
      serviceKey: SUPABASE_SERVICE_ROLE_KEY,
      context: {
        source: 'discord',
        discord_user_id: userId,
        discord_user_name: userName,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`PAI API ${response.status}: ${errorText.substring(0, 200)}`);
  }

  return await response.json();
}

// ============================================
// Message Splitting (Discord 2000 char limit)
// ============================================
function splitMessage(text) {
  if (text.length <= DISCORD_MAX_LENGTH) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    // Try to split at last newline within limit
    let splitIndex = remaining.lastIndexOf('\n', DISCORD_MAX_LENGTH);
    if (splitIndex < DISCORD_MAX_LENGTH * 0.3) {
      // No good newline, try space
      splitIndex = remaining.lastIndexOf(' ', DISCORD_MAX_LENGTH);
    }
    if (splitIndex < DISCORD_MAX_LENGTH * 0.3) {
      // Hard split
      splitIndex = DISCORD_MAX_LENGTH;
    }
    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }

  return chunks;
}

// ============================================
// Message Handler
// ============================================
async function handleMessage(message) {
  // Ignore bot messages (including self)
  if (message.author.bot) return;

  const isDM = !message.guild;
  const isMentioned = message.mentions.has(client.user);
  const isListenedChannel = CHANNEL_IDS.includes(message.channel.id);

  // Only respond to: DMs, mentions, or messages in configured channels
  if (!isDM && !isMentioned && !isListenedChannel) return;

  // Strip bot mention from message text
  let content = message.content;
  if (isMentioned) {
    content = content.replace(/<@!?\d+>/g, '').trim();
  }
  if (!content) return;

  const userId = message.author.id;
  const userName = message.member?.displayName || message.author.displayName || message.author.username;

  log('info', `Message from ${userName}`, {
    userId,
    channel: isDM ? 'DM' : message.channel.name,
    length: content.length,
  });

  // Show typing indicator (refresh every 8s since Discord clears it after 10s)
  try { await message.channel.sendTyping(); } catch (_) {}
  const typingInterval = setInterval(() => {
    try { message.channel.sendTyping(); } catch (_) {}
  }, TYPING_REFRESH_MS);

  try {
    const history = getHistory(userId);
    const result = await callPai(content, userId, userName, history);

    // Update conversation history
    addToHistory(userId, 'user', content);
    addToHistory(userId, 'model', result.reply);

    // Send response (split if needed)
    const chunks = splitMessage(result.reply);
    for (const chunk of chunks) {
      await message.reply({ content: chunk, allowedMentions: { repliedUser: false } });
    }

    log('info', `Reply sent to ${userName}`, {
      replyLength: result.reply.length,
      chunks: chunks.length,
      actions: result.actions_taken?.length || 0,
    });
  } catch (err) {
    log('error', 'Failed to get PAI response', { error: err.message, userId });
    try {
      await message.reply({
        content: 'Apologies, I ran into an issue processing that. Please try again in a moment.',
        allowedMentions: { repliedUser: false },
      });
    } catch (_) {}
  } finally {
    clearInterval(typingInterval);
  }
}

// ============================================
// Client Setup
// ============================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Channel, // Required for DM support
  ],
});

client.on('ready', () => {
  log('info', `PAI Discord bot online as ${client.user.tag}`, {
    guilds: client.guilds.cache.size,
    listenedChannels: CHANNEL_IDS,
  });
});

client.on('messageCreate', handleMessage);

client.on('error', (err) => {
  log('error', 'Discord client error', { error: err.message });
});

// Graceful shutdown
function shutdown(signal) {
  log('info', `Received ${signal}, shutting down...`);
  client.destroy();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start
log('info', 'Starting PAI Discord bot...', {
  supabaseUrl: SUPABASE_URL,
  channels: CHANNEL_IDS,
});
client.login(DISCORD_TOKEN);
