#!/usr/bin/env node
/**
 * Live Subtitles Server
 *
 * WebSocket server that broadcasts speech-to-text transcription and translations.
 * Supports any source language → translates to all connected listeners' languages.
 *
 * Usage:
 *   node server.js                # Production (requires mic + STT)
 *   node server.js --mock         # Mock mode with English source
 *   node server.js --mock-pl      # Mock mode with Polish source
 *
 * Env vars:
 *   GEMINI_API_KEY  — Gemini API key for real translation
 *   SUBTITLE_PORT   — Port (default 8910)
 */

const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.SUBTITLE_PORT || '8910', 10);
const MOCK_MODE = process.argv.includes('--mock') || process.argv.includes('--mock-pl');
const MOCK_LANG = process.argv.includes('--mock-pl') ? 'pl' : 'en';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';

// ── State ──────────────────────────────────────────────────

/** @type {Map<string, Set<import('ws').WebSocket>>} lang → set of clients */
const clientsByLang = new Map();
let segmentCounter = 0;
let isActive = false;
let lastActivityTime = 0;
const ACTIVITY_TIMEOUT_MS = 60_000; // isActive goes false after 60s of no input

// ── Supported Languages ────────────────────────────────────

const SUPPORTED_LANGS = ['en', 'pl', 'es', 'fr', 'de', 'pt', 'it', 'hi', 'ar'];

// ── Mock Data ──────────────────────────────────────────────

const MOCK_SENTENCES = [
  'Welcome to Alpaca Playhouse! Make yourself at home.',
  'The WiFi password is on the card in your room.',
  'Breakfast is between eight and ten in the morning.',
  'Feel free to use the sauna any time after four PM.',
  'The alpacas are in the front pasture today.',
  'There are towels in the closet by the bathroom.',
  'If you need anything, just ask the house assistant.',
  'The front door code will be texted to you.',
  'Music can be controlled from any Sonos speaker.',
  'Checkout is at eleven AM — no rush though!',
  'The hot tub is heated and ready for you.',
  'Please keep the gate closed so the alpacas stay in.',
  'There is a fire pit in the backyard, firewood is by the shed.',
  'The kitchen is fully stocked, help yourself to anything.',
  'We have board games and cards in the living room cabinet.',
];

// Polish source sentences for --mock-pl mode
const MOCK_PL_SENTENCES = [
  'Witamy w Alpaca Playhouse! Czuj się jak w domu.',
  'Hasło do WiFi jest na karcie w Twoim pokoju.',
  'Śniadanie jest między ósmą a dziesiątą rano.',
  'Możesz korzystać z sauny po szesnastej.',
  'Alpaki są dziś na przednim pastwisku.',
  'Ręczniki są w szafie przy łazience.',
  'Jeśli czegokolwiek potrzebujesz, zapytaj asystenta domu.',
  'Kod do drzwi wejściowych zostanie wysłany SMSem.',
  'Muzyka sterowana z każdego głośnika Sonos.',
  'Wymeldowanie o jedenastej — bez pośpieszania!',
  'Jacuzzi jest podgrzane i gotowe.',
  'Prosimy zamykać bramkę, żeby alpaki nie wyszły.',
  'Na podwórku jest ognisko, drewno przy szopie.',
  'Kuchnia jest w pełni wyposażona, częstuj się.',
  'Mamy gry planszowe i karty w szafce w salonie.',
];

// Pre-built mock translations for both directions
const MOCK_TRANSLATIONS = {
  // English translations of the Polish mock sentences
  pl_to_en: [
    'Welcome to Alpaca Playhouse! Make yourself at home.',
    'The WiFi password is on the card in your room.',
    'Breakfast is between eight and ten in the morning.',
    'Feel free to use the sauna any time after four PM.',
    'The alpacas are in the front pasture today.',
    'There are towels in the closet by the bathroom.',
    'If you need anything, just ask the house assistant.',
    'The front door code will be texted to you.',
    'Music can be controlled from any Sonos speaker.',
    'Checkout is at eleven AM — no rush though!',
    'The hot tub is heated and ready for you.',
    'Please keep the gate closed so the alpacas stay in.',
    'There is a fire pit in the backyard, firewood is by the shed.',
    'The kitchen is fully stocked, help yourself to anything.',
    'We have board games and cards in the living room cabinet.',
  ],
  // Polish translations of the English mock sentences
  en_to_pl: [
    'Witamy w Alpaca Playhouse! Czuj się jak w domu.',
    'Hasło do WiFi jest na karcie w Twoim pokoju.',
    'Śniadanie jest między ósmą a dziesiątą rano.',
    'Możesz korzystać z sauny po szesnastej.',
    'Alpaki są dziś na przednim pastwisku.',
    'Ręczniki są w szafie przy łazience.',
    'Jeśli czegokolwiek potrzebujesz, zapytaj asystenta domu.',
    'Kod do drzwi wejściowych zostanie wysłany SMSem.',
    'Muzyka sterowana z każdego głośnika Sonos.',
    'Wymeldowanie o jedenastej — bez pośpieszania!',
    'Jacuzzi jest podgrzane i gotowe.',
    'Prosimy zamykać bramkę, żeby alpaki nie wyszły.',
    'Na podwórku jest ognisko, drewno przy szopie.',
    'Kuchnia jest w pełni wyposażona, częstuj się.',
    'Mamy gry planszowe i karty w szafce w salonie.',
  ],
  // Spanish translations of English mock sentences
  en_to_es: [
    'Bienvenido a Alpaca Playhouse! Siéntete como en casa.',
    'La contraseña del WiFi está en la tarjeta de tu habitación.',
    'El desayuno es entre las ocho y las diez de la mañana.',
    'Puedes usar la sauna después de las cuatro.',
    'Las alpacas están en el pastizal delantero hoy.',
    'Las toallas están en el armario del baño.',
    'Si necesitas algo, pregúntale al asistente de la casa.',
    'El código de la puerta te llegará por mensaje.',
    'La música se controla desde cualquier altavoz Sonos.',
    'El checkout es a las once — sin prisa!',
    'El jacuzzi está caliente y listo.',
    'Por favor cierra la puerta para que las alpacas no salgan.',
    'Hay una fogata en el patio, la leña está junto al cobertizo.',
    'La cocina está completamente equipada, sírvete lo que quieras.',
    'Tenemos juegos de mesa y cartas en el gabinete de la sala.',
  ],
};

// ── Gemini Translation ────────────────────────────────────

const LANG_NAMES = {
  en: 'English', pl: 'Polish', es: 'Spanish', fr: 'French',
  de: 'German', pt: 'Portuguese', it: 'Italian', hi: 'Hindi', ar: 'Arabic',
};

/** Translate text using Gemini Flash */
async function translateWithGemini(text, fromLang, toLang) {
  if (!GEMINI_KEY) return `[${toLang.toUpperCase()}] ${text}`;
  if (fromLang === toLang) return text;

  const fromName = LANG_NAMES[fromLang] || fromLang;
  const toName = LANG_NAMES[toLang] || toLang;

  const body = JSON.stringify({
    contents: [{
      parts: [{ text: `Translate the following ${fromName} text to ${toName}. Return ONLY the translation, no explanation:\n\n${text}` }],
    }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 256 },
  });

  return new Promise((resolve) => {
    const req = https.request(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const translated = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
            resolve(translated || `[${toLang.toUpperCase()}] ${text}`);
          } catch {
            resolve(`[${toLang.toUpperCase()}] ${text}`);
          }
        });
      }
    );
    req.on('error', () => resolve(`[${toLang.toUpperCase()}] ${text}`));
    req.setTimeout(5000, () => { req.destroy(); resolve(`[${toLang.toUpperCase()}] ${text}`); });
    req.end(body);
  });
}

/** Translate text to all languages that have active listeners */
async function translateForListeners(text, sourceLang) {
  const translations = {};
  const promises = [];
  for (const [lang, clients] of clientsByLang.entries()) {
    if (lang === sourceLang || clients.size === 0) continue;
    promises.push(
      translateWithGemini(text, sourceLang, lang).then(t => { translations[lang] = t; })
    );
  }
  await Promise.all(promises);
  return translations;
}

// ── HTTPS + HTTP Servers ──────────────────────────────────

const HTTPS_PORT = parseInt(process.env.SUBTITLE_HTTPS_PORT || '8911', 10);
const CERT_PATH = process.env.SUBTITLE_CERT || '/tmp/subtitle-cert.pem';
const KEY_PATH = process.env.SUBTITLE_KEY || '/tmp/subtitle-key.pem';

// Try to load TLS certs for HTTPS
let tlsOptions = null;
try {
  tlsOptions = {
    key: fs.readFileSync(KEY_PATH),
    cert: fs.readFileSync(CERT_PATH),
  };
  console.log('[TLS] Loaded self-signed cert — HTTPS enabled');
} catch {
  console.log('[TLS] No cert found — HTTPS disabled, HTTP only');
}

function handleRequest(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health / status endpoint
  if (url.pathname === '/subtitles/status') {
    // Auto-expire isActive after timeout (no mock, no inject for a while)
    if (isActive && !MOCK_MODE && Date.now() - lastActivityTime > ACTIVITY_TIMEOUT_MS) {
      isActive = false;
    }
    const languages = [...clientsByLang.keys()].filter(l => clientsByLang.get(l).size > 0);
    const totalListeners = [...clientsByLang.values()].reduce((sum, s) => sum + s.size, 0);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      active: isActive,
      mock: MOCK_MODE,
      listeners: totalListeners,
      languages,
      supported_languages: SUPPORTED_LANGS,
    }));
    return;
  }

  // Inject endpoint: POST text from browser mic (Web Speech API)
  // Accepts: { text, is_partial, source_lang? }
  if (url.pathname === '/subtitles/inject' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { text, is_partial, source_lang } = JSON.parse(body);
        const srcLang = source_lang || 'en';
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing text' }));
          return;
        }
        isActive = true;
        lastActivityTime = Date.now();

        // For partials, use fast placeholder translations (no API call)
        // For finals, use Gemini if available
        let translations;
        if (is_partial || !GEMINI_KEY) {
          translations = buildPlaceholderTranslations(text, srcLang);
          if (is_partial) broadcastPartial(text, srcLang, translations);
          else broadcastSegment(text, srcLang, translations);
        } else {
          translations = await translateForListeners(text, srcLang);
          broadcastSegment(text, srcLang, translations);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, segment: segmentCounter, source_lang: srcLang }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
      }
    });
    return;
  }

  // Serve event speaker client
  if (url.pathname === '/' || url.pathname === '/eventspeaker' || url.pathname === '/test') {
    const testFile = path.join(__dirname, 'test-client.html');
    if (fs.existsSync(testFile)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(testFile));
      return;
    }
  }

  // Serve APK download
  if (url.pathname === '/apk' || url.pathname === '/alpaca-playhouse.apk') {
    const apkFile = path.join(__dirname, 'alpaca-playhouse.apk');
    if (fs.existsSync(apkFile)) {
      res.writeHead(200, {
        'Content-Type': 'application/vnd.android.package-archive',
        'Content-Disposition': 'attachment; filename="alpaca-playhouse.apk"',
        'Content-Length': fs.statSync(apkFile).size,
      });
      fs.createReadStream(apkFile).pipe(res);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
}

const server = http.createServer(handleRequest);

// ── HTTPS Server (for Web Speech API) ─────────────────────

let httpsServer = null;
if (tlsOptions) {
  httpsServer = require('https').createServer(tlsOptions, handleRequest);
}

// ── WebSocket Servers ─────────────────────────────────────

function setupWebSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/subtitles' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const lang = url.searchParams.get('lang') || 'en';

    if (!SUPPORTED_LANGS.includes(lang)) {
      ws.close(4001, `Unsupported language: ${lang}`);
      return;
    }

    if (!clientsByLang.has(lang)) {
      clientsByLang.set(lang, new Set());
    }
    clientsByLang.get(lang).add(ws);
    console.log(`[WS] Client connected: lang=${lang} (${clientsByLang.get(lang).size} clients for ${lang})`);

    ws.send(JSON.stringify({
      type: 'connected',
      lang,
      supported_languages: SUPPORTED_LANGS,
      mock: MOCK_MODE,
    }));

    const pingInterval = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, 30000);

    ws.on('close', () => {
      clientsByLang.get(lang)?.delete(ws);
      clearInterval(pingInterval);
      console.log(`[WS] Client disconnected: lang=${lang}`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Error: ${err.message}`);
      clientsByLang.get(lang)?.delete(ws);
      clearInterval(pingInterval);
    });
  });

  return wss;
}

setupWebSocket(server);
if (httpsServer) setupWebSocket(httpsServer);

// ── Broadcast ──────────────────────────────────────────────

function broadcast(lang, message) {
  const clients = clientsByLang.get(lang);
  if (!clients || clients.size === 0) return;

  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

function broadcastSegment(sourceText, sourceLang, translations = {}) {
  segmentCounter++;
  const id = `seg_${String(segmentCounter).padStart(4, '0')}`;
  const timestamp = Math.floor(Date.now() / 1000);

  // Broadcast source language (listeners who want the original)
  broadcast(sourceLang, {
    type: 'subtitle',
    id,
    text: sourceText,
    lang: sourceLang,
    source_lang: sourceLang,
    source_text: sourceText,
    timestamp,
    is_partial: false,
  });

  // Broadcast translations to other language listeners
  for (const [lang, text] of Object.entries(translations)) {
    broadcast(lang, {
      type: 'subtitle',
      id,
      text,
      lang,
      source_lang: sourceLang,
      source_text: sourceText,
      timestamp,
      is_partial: false,
    });
  }
}

function broadcastPartial(sourceText, sourceLang, translations = {}) {
  const id = `seg_${String(segmentCounter + 1).padStart(4, '0')}`;
  const timestamp = Math.floor(Date.now() / 1000);

  broadcast(sourceLang, {
    type: 'subtitle',
    id,
    text: sourceText,
    lang: sourceLang,
    source_lang: sourceLang,
    source_text: sourceText,
    timestamp,
    is_partial: true,
  });

  for (const [lang, text] of Object.entries(translations)) {
    broadcast(lang, {
      type: 'subtitle',
      id,
      text,
      lang,
      source_lang: sourceLang,
      source_text: sourceText,
      timestamp,
      is_partial: true,
    });
  }
}

// ── Translation helpers ───────────────────────────────────

/** Fast placeholder translations (no API call — used for partials) */
function buildPlaceholderTranslations(text, sourceLang) {
  const translations = {};
  for (const [lang, clients] of clientsByLang.entries()) {
    if (lang === sourceLang || clients.size === 0) continue;
    translations[lang] = `[${lang.toUpperCase()}] ${text}`;
  }
  return translations;
}

// ── Mock STT Loop ──────────────────────────────────────────

function startMockSTT() {
  isActive = true;
  let sentenceIdx = 0;
  const sourceLang = MOCK_LANG;
  const sentences = sourceLang === 'pl' ? MOCK_PL_SENTENCES : MOCK_SENTENCES;

  // Pick translation targets based on source language
  const transKey = sourceLang === 'pl' ? 'pl_to_en' : 'en_to_pl';
  const transKey2 = sourceLang === 'pl' ? null : 'en_to_es';

  console.log(`[Mock] Starting mock STT — source: ${sourceLang}, broadcasting every 5s`);

  setInterval(() => {
    const sentence = sentences[sentenceIdx % sentences.length];
    const words = sentence.split(' ');

    let wordIdx = 0;
    const partialInterval = setInterval(() => {
      wordIdx++;
      if (wordIdx < words.length) {
        const partial = words.slice(0, wordIdx).join(' ');
        const translations = {};
        const ratio = wordIdx / words.length;

        // Build partial translations proportionally
        const mockTrans1 = MOCK_TRANSLATIONS[transKey];
        if (mockTrans1) {
          const targetLang = sourceLang === 'pl' ? 'en' : 'pl';
          const fullTrans = mockTrans1[sentenceIdx % mockTrans1.length];
          const transWords = fullTrans.split(' ');
          const transWordCount = Math.max(1, Math.round(transWords.length * ratio));
          translations[targetLang] = transWords.slice(0, transWordCount).join(' ');
        }
        if (transKey2) {
          const mockTrans2 = MOCK_TRANSLATIONS[transKey2];
          if (mockTrans2) {
            const fullTrans = mockTrans2[sentenceIdx % mockTrans2.length];
            const transWords = fullTrans.split(' ');
            const transWordCount = Math.max(1, Math.round(transWords.length * ratio));
            translations['es'] = transWords.slice(0, transWordCount).join(' ');
          }
        }
        broadcastPartial(partial, sourceLang, translations);
      } else {
        clearInterval(partialInterval);
        const translations = {};
        const mockTrans1 = MOCK_TRANSLATIONS[transKey];
        if (mockTrans1) {
          const targetLang = sourceLang === 'pl' ? 'en' : 'pl';
          translations[targetLang] = mockTrans1[sentenceIdx % mockTrans1.length];
        }
        if (transKey2) {
          const mockTrans2 = MOCK_TRANSLATIONS[transKey2];
          if (mockTrans2) translations['es'] = mockTrans2[sentenceIdx % mockTrans2.length];
        }
        broadcastSegment(sentence, sourceLang, translations);
        sentenceIdx++;
      }
    }, 250);
  }, 5000);
}

// ── Start ──────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Subtitles] HTTP server on http://0.0.0.0:${PORT}`);
  console.log(`[Subtitles] Event Speaker: http://localhost:${PORT}/eventspeaker`);
  console.log(`[Subtitles] Status: http://localhost:${PORT}/subtitles/status`);
  console.log(`[Subtitles] Mode: ${MOCK_MODE ? 'MOCK' : 'PRODUCTION'}`);

  if (MOCK_MODE) startMockSTT();
});

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`[Subtitles] HTTPS server on https://0.0.0.0:${HTTPS_PORT}`);
    console.log(`[Subtitles] Event Speaker (HTTPS): https://192.168.1.200:${HTTPS_PORT}/eventspeaker`);
  });
}
