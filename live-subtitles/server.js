#!/usr/bin/env node
/**
 * Live Subtitles Server
 *
 * WebSocket server that broadcasts speech-to-text transcription and translations.
 * Run with --mock flag for local testing with simulated transcription.
 *
 * Usage:
 *   node server.js          # Production (requires mic + STT)
 *   node server.js --mock   # Mock mode with sample sentences
 */

const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.SUBTITLE_PORT || '8910', 10);
const MOCK_MODE = process.argv.includes('--mock');

// ── State ──────────────────────────────────────────────────

/** @type {Map<string, Set<import('ws').WebSocket>>} lang → set of clients */
const clientsByLang = new Map();
let segmentCounter = 0;
let isActive = false;

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

// Simple mock translations (just prefixed for testing — real impl uses DeepL/Azure)
const MOCK_TRANSLATIONS = {
  pl: [
    'Witamy w Alpaca Playhouse! Czuj sie jak w domu.',
    'Haslo do WiFi jest na karcie w Twoim pokoju.',
    'Sniadanie jest miedzy osma a dziesiata rano.',
    'Mozesz korzystac z sauny po szesnastej.',
    'Alpaki sa dzis na przednim pastwisku.',
    'Reczniki sa w szafie przy lazience.',
    'Jesli czegokolwiek potrzebujesz, zapytaj asystenta domu.',
    'Kod do drzwi wejsciowych zostanie wyslany SMSem.',
    'Muzyka sterowana z kazdego glosnika Sonos.',
    'Wymeldowanie o jedenastej — bez pospieszania!',
    'Jacuzzi jest podgrzane i gotowe.',
    'Prosimy zamykac bramke, zeby alpaki nie wyszly.',
    'Na podworku jest ognisko, drewno przy szopie.',
    'Kuchnia jest w pelni wyposazona, czestuj sie.',
    'Mamy gry planszowe i karty w szafce w salonie.',
  ],
  es: [
    'Bienvenido a Alpaca Playhouse! Sientete como en casa.',
    'La contrasena del WiFi esta en la tarjeta de tu habitacion.',
    'El desayuno es entre las ocho y las diez de la manana.',
    'Puedes usar la sauna despues de las cuatro.',
    'Las alpacas estan en el pastizal delantero hoy.',
    'Las toallas estan en el armario del bano.',
    'Si necesitas algo, preguntale al asistente de la casa.',
    'El codigo de la puerta te llegara por mensaje.',
    'La musica se controla desde cualquier altavoz Sonos.',
    'El checkout es a las once — sin prisa!',
    'El jacuzzi esta caliente y listo.',
    'Por favor cierra la puerta para que las alpacas no salgan.',
    'Hay una fogata en el patio, la lena esta junto al cobertizo.',
    'La cocina esta completamente equipada, sirvete lo que quieras.',
    'Tenemos juegos de mesa y cartas en el gabinete de la sala.',
  ],
};

// ── HTTP Server ────────────────────────────────────────────

const server = http.createServer((req, res) => {
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
  if (url.pathname === '/subtitles/inject' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { text, is_partial } = JSON.parse(body);
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'missing text' }));
          return;
        }
        isActive = true;
        if (is_partial) {
          broadcastPartial(text, buildMockTranslations(text, true));
        } else {
          broadcastSegment(text, buildMockTranslations(text, false));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, segment: segmentCounter }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
      }
    });
    return;
  }

  // Serve test client
  if (url.pathname === '/' || url.pathname === '/test') {
    const testFile = path.join(__dirname, 'test-client.html');
    if (fs.existsSync(testFile)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(testFile));
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// ── WebSocket Server ───────────────────────────────────────

const wss = new WebSocketServer({ server, path: '/subtitles' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const lang = url.searchParams.get('lang') || 'en';

  if (!SUPPORTED_LANGS.includes(lang)) {
    ws.close(4001, `Unsupported language: ${lang}`);
    return;
  }

  // Register client
  if (!clientsByLang.has(lang)) {
    clientsByLang.set(lang, new Set());
  }
  clientsByLang.get(lang).add(ws);
  console.log(`[WS] Client connected: lang=${lang} (${clientsByLang.get(lang).size} clients for ${lang})`);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    lang,
    supported_languages: SUPPORTED_LANGS,
    mock: MOCK_MODE,
  }));

  // Heartbeat
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

function broadcastSegment(sourceText, translations = {}) {
  segmentCounter++;
  const id = `seg_${String(segmentCounter).padStart(4, '0')}`;
  const timestamp = Math.floor(Date.now() / 1000);

  // Broadcast English (source)
  broadcast('en', {
    type: 'subtitle',
    id,
    text: sourceText,
    lang: 'en',
    source_lang: 'en',
    source_text: sourceText,
    timestamp,
    is_partial: false,
  });

  // Broadcast translations
  for (const [lang, text] of Object.entries(translations)) {
    broadcast(lang, {
      type: 'subtitle',
      id,
      text,
      lang,
      source_lang: 'en',
      source_text: sourceText,
      timestamp,
      is_partial: false,
    });
  }
}

function broadcastPartial(sourceText, translations = {}) {
  const id = `seg_${String(segmentCounter + 1).padStart(4, '0')}`;
  const timestamp = Math.floor(Date.now() / 1000);

  broadcast('en', {
    type: 'subtitle',
    id,
    text: sourceText,
    lang: 'en',
    source_lang: 'en',
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
      source_lang: 'en',
      source_text: sourceText,
      timestamp,
      is_partial: true,
    });
  }
}

// ── Translation helper for inject mode ─────────────────────

/** Build placeholder translations for injected text (real translation comes in Phase 2) */
function buildMockTranslations(text, isPartial) {
  const translations = {};
  // Only translate for languages with active listeners
  for (const [lang, clients] of clientsByLang.entries()) {
    if (lang === 'en' || clients.size === 0) continue;
    // Placeholder: prefix with lang code. Replace with DeepL/Azure in Phase 2.
    translations[lang] = `[${lang.toUpperCase()}] ${text}`;
  }
  return translations;
}

// ── Mock STT Loop ──────────────────────────────────────────

function startMockSTT() {
  isActive = true;
  let sentenceIdx = 0;

  console.log('[Mock] Starting mock STT — broadcasting sample sentences every 4s');

  setInterval(() => {
    const sentence = MOCK_SENTENCES[sentenceIdx % MOCK_SENTENCES.length];
    const words = sentence.split(' ');

    // Simulate partial results: reveal word by word over ~2 seconds
    let wordIdx = 0;
    const partialInterval = setInterval(() => {
      wordIdx++;
      if (wordIdx < words.length) {
        const partial = words.slice(0, wordIdx).join(' ');
        const translations = {};
        // Build partial translations proportionally
        for (const lang of ['pl', 'es']) {
          const mockTrans = MOCK_TRANSLATIONS[lang];
          if (mockTrans) {
            const fullTrans = mockTrans[sentenceIdx % mockTrans.length];
            const transWords = fullTrans.split(' ');
            const ratio = wordIdx / words.length;
            const transWordCount = Math.max(1, Math.round(transWords.length * ratio));
            translations[lang] = transWords.slice(0, transWordCount).join(' ');
          }
        }
        broadcastPartial(partial, translations);
      } else {
        clearInterval(partialInterval);
        // Final segment
        const translations = {};
        for (const lang of ['pl', 'es']) {
          const mockTrans = MOCK_TRANSLATIONS[lang];
          if (mockTrans) {
            translations[lang] = mockTrans[sentenceIdx % mockTrans.length];
          }
        }
        broadcastSegment(sentence, translations);
        sentenceIdx++;
      }
    }, 250);
  }, 5000);
}

// ── Start ──────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Subtitles] Server listening on http://0.0.0.0:${PORT}`);
  console.log(`[Subtitles] WebSocket: ws://localhost:${PORT}/subtitles?lang=en`);
  console.log(`[Subtitles] Status: http://localhost:${PORT}/subtitles/status`);
  console.log(`[Subtitles] Test UI: http://localhost:${PORT}/test`);
  console.log(`[Subtitles] Mode: ${MOCK_MODE ? 'MOCK (simulated speech)' : 'PRODUCTION (requires mic + STT)'}`);

  if (MOCK_MODE) {
    startMockSTT();
  }
});
