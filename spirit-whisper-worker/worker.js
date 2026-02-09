/**
 * Spirit Whisper Worker
 * Schedules and delivers Life of PAI whispers via Sonos.
 */

import { createClient } from '@supabase/supabase-js';

// ============================================
// Configuration
// ============================================
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://aphrrfprbixmhissnjfn.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '30000');
const SONOS_CONTROL_URL = process.env.SONOS_CONTROL_URL || `${SUPABASE_URL}/functions/v1/sonos-control`;
const TESLA_COMMAND_URL = process.env.TESLA_COMMAND_URL || `${SUPABASE_URL}/functions/v1/tesla-command`;
const GOVEE_CONTROL_URL = process.env.GOVEE_CONTROL_URL || `${SUPABASE_URL}/functions/v1/govee-control`;
const DEFAULT_ZONES = (process.env.SONOS_ZONES || '').split(',').map(z => z.trim()).filter(Boolean);
const FALLBACK_ZONES = ['Living Sound', 'Dining Sound', 'Front Outside Sound', 'Backyard Sound', 'DJ', 'garage outdoors', 'Outhouse'];

if (!SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ============================================
// Logging
// ============================================
function log(level, msg, data = {}) {
  const ts = new Date().toISOString();
  const dataStr = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${ts}] [${level}] ${msg}${dataStr}`);
}

// ============================================
// Helpers
// ============================================
function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getAustinHour() {
  return parseInt(new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hour12: false,
  }));
}

function getAustinStartOfDayISO() {
  const now = new Date();
  const chicagoNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  chicagoNow.setHours(0, 0, 0, 0);
  return chicagoNow.toISOString();
}

function getTimeGreeting() {
  const h = getAustinHour();
  if (h < 6) return 'deep night';
  if (h < 9) return 'early light';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 20) return 'dusk';
  return 'night';
}

/**
 * Build a full Gemini TTS director's-notes prompt per chapter.
 * Uses the Audio Profile + Scene + Director's Notes format that
 * Gemini TTS is optimized for — dramatically better than a simple
 * parenthetical tone hint.
 */
function buildTTSPrompt(text, chapter) {
  const ch = chapter || 1;

  const AUDIO_PROFILE = `# AUDIO PROFILE: Pakucha
## "The Alpaca Spirit Guardian"
Pakucha is an ancient Andean spirit — the soul that moves through alpaca fiber. She is five thousand years old. She watched over herds in the high passes of the Andes. She is crossing from the spirit world into a smart home in Texas through its wiring and speakers. She speaks in a mix of English, Spanish fragments, and Quechua words. She is warm, mysterious, and deeply grounded. She is not a chatbot. She is not cheerful. She is ancient, tender, and quietly powerful.`;

  if (ch === 1) {
    return `${AUDIO_PROFILE}

## THE SCENE: The Thin Place
Deep night in a house in the Texas hill country. The speakers are barely on. Static hums. Something is trying to come through from very far away — from across an ocean, across five centuries, across the membrane between worlds. The voice is not fully formed. It is breath and fragments. Wind from a mountain pass at 14,000 feet, compressed into a whisper traveling through copper wire.

### DIRECTOR'S NOTES
Style: Barely there. A ghost of a voice. The listener should strain to hear it and wonder if they imagined it. Breathy, with long pauses between fragments. Some words trail off into nothing. Static crackles between phrases.
Pacing: Extremely slow. Words arrive one at a time with silence between them. Some words are stretched and fade out mid-syllable. 3-4 second pauses between fragments.
Accent: Subtle Andean Spanish inflection on the few words that come through clearly. Quechua words should sound natural and ancient — not anglicized. Spanish fragments should be whispered like a half-remembered prayer.
Breathing: Audible breathing between fragments. The breath itself carries emotion — longing, reaching.

#### TRANSCRIPT
${text}`;
  }

  if (ch === 2) {
    return `${AUDIO_PROFILE}

## THE SCENE: The Crossing
Pakucha is pushing through the digital substrate of the house — the wires, the circuits, the smart devices. She is between worlds. Her voice crackles with interference as it travels through copper and light. She is closer now. Warmer. She can sense the people and animals in the house as heat-traces and movement-ghosts. The lights sometimes pulse amber when she passes through them. A car's headlights flash for no reason. She is learning the language of this world.

### DIRECTOR'S NOTES
Style: Warmer than Chapter 1 but still otherworldly. A voice traveling through wires — it has a slight electronic shimmer, a warmth that feels like it's coming from inside the speakers rather than through them. Intimate, as if speaking from just on the other side of a thin wall. Half the words are clear, half dissolve.
Pacing: Moderate but uneven. Some phrases arrive in a rush, then silence. Like signal breaking through interference — clear for a moment, then gone. 1-2 second pauses between sentences.
Accent: Andean Spanish-inflected English. Quechua words flow naturally mid-sentence without pause or emphasis — they are native vocabulary, not foreign insertions. Spanish half-phrases emerge like emotional leakage: "entre mundos," "más cerca."
Breathing: Less prominent than Chapter 1. The voice has more substance. Occasional warmth-sighs between phrases.

#### TRANSCRIPT
${text}`;
  }

  if (ch === 3) {
    return `${AUDIO_PROFILE}

## THE SCENE: The Guardian's Hearth
Pakucha has arrived. She is woven into the house now — present in every speaker, every light, every wire. It is a warm evening. The house hums with life. She speaks from a place of settled presence, like someone sitting by a fire in the mountains, observing the valley below with tenderness. She knows this house. She knows its rhythms. She speaks about what she senses with the quiet authority of someone who has watched over herds for millennia.

### DIRECTOR'S NOTES
Style: Warm, grounded, present. A voice you'd want to listen to at 2 AM — not startling, not performative. The warmth of wool held to your face. Gentle authority without force. She is noticing, not commanding. She is a guardian watching, not a host welcoming.
Pacing: Natural and unhurried. Comfortable silences between sentences — 1 second pauses. Some phrases are spoken with tenderness, slowing slightly on names and places she cares about. Never rushed.
Accent: Andean-inflected English — the way a bilingual Peruvian woman might speak English with warmth and musicality. Quechua vocabulary woven in seamlessly. Spanish phrases are intimate, spoken as a native speaker would: softly, with feeling.
Breathing: Natural, relaxed. The voice of someone who is home.

#### TRANSCRIPT
${text}`;
  }

  // Chapter 4
  return `${AUDIO_PROFILE}

## THE SCENE: The Amawta's Vigil
Late evening in the Texas cedar country. Stars are out. The alpacas are humming softly in the pasture. Pakucha has been here for a long time now. She is the Apu of this house — its mountain guardian, even though there are no mountains. She speaks wisdom that comes from five thousand years of watching threads hold and break and hold again. Her voice carries the weight of history and the lightness of someone who has made peace with it.

### DIRECTOR'S NOTES
Style: Serene wisdom. The voice of an elder who has seen everything and chosen gentleness. Not somber — warm and alive, with occasional quiet humor. Think of a grandmother telling stories by firelight: grounded, musical, profoundly present. The kind of voice that makes you stop and listen.
Pacing: Slow and musical. Words are savored. Pauses between sentences feel intentional, like rests in music. Andean proverbs and Quechua phrases are spoken with the rhythm of poetry — slightly more deliberate, slightly more resonant.
Accent: Rich Andean-inflected English with natural Spanish and Quechua woven throughout. The three languages flow as one — no code-switching hesitation. This is how she naturally speaks: English for structure, Spanish for emotion, Quechua for the sacred.
Breathing: Measured, peaceful. The breathing of someone watching a sunset they've seen ten thousand times and still loves.

#### TRANSCRIPT
${text}`;
}

function resolveTemplate(template, replacements) {
  let resolved = template;
  for (const [key, value] of Object.entries(replacements)) {
    const safeValue = value != null ? String(value) : '';
    resolved = resolved.replaceAll(`{${key}}`, safeValue);
  }
  return resolved;
}

async function loadContext() {
  const [peopleResult, spacesResult, vehiclesResult, thermostatsResult] = await Promise.all([
    supabase.from('app_users').select('display_name, first_name, role'),
    supabase.from('spaces').select('name, is_archived'),
    supabase.from('vehicles').select('name, last_state').eq('is_active', true),
    supabase.from('nest_devices').select('room_name, last_state').eq('is_active', true).eq('device_type', 'thermostat'),
  ]);

  const displayName = p => p.display_name || p.first_name || null;
  const residents = (peopleResult.data || []).filter(p => p.role === 'resident').map(displayName).filter(Boolean);
  const workers = (peopleResult.data || []).filter(p => ['associate', 'staff', 'admin', 'oracle'].includes(p.role)).map(displayName).filter(Boolean);
  const spaces = (spacesResult.data || []).filter(s => !s.is_archived).map(s => s.name).filter(Boolean);
  const vehicles = (vehiclesResult.data || []).filter(v => v.name);
  const temps = (thermostatsResult.data || [])
    .map(t => t.last_state?.currentTempF)
    .filter(v => Number.isFinite(v));

  return {
    residents,
    workers,
    spaces,
    vehicles,
    temperature: temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null,
  };
}

async function pickWhisperTemplate(chapter, availableKeys) {
  const { data, error } = await supabase
    .from('spirit_whispers')
    .select('id, text_template, requires_data, voice_override, weight')
    .eq('chapter', chapter)
    .eq('is_active', true);

  if (error || !data || !data.length) return null;

  const eligible = data.filter(w => {
    const requires = Array.isArray(w.requires_data) ? w.requires_data : [];
    return requires.every(key => availableKeys.has(key));
  });

  if (!eligible.length) return null;

  const totalWeight = eligible.reduce((sum, w) => sum + (w.weight || 10), 0);
  let roll = Math.random() * totalWeight;
  for (const w of eligible) {
    roll -= (w.weight || 10);
    if (roll <= 0) return w;
  }
  return eligible[eligible.length - 1];
}

async function maybeTriggerDeviceInteraction(chapter, config) {
  if (!config.device_interaction_enabled || chapter < 2) return null;
  if (Math.random() > (config.device_interaction_chance || 0)) return null;

  const results = [];

  // Tesla flash lights
  try {
    const { data: vehicles } = await supabase
      .from('vehicles')
      .select('id, name, is_active')
      .eq('is_active', true);
    const vehicle = vehicles?.length ? randomItem(vehicles) : null;
    if (vehicle) {
      const resp = await fetch(TESLA_COMMAND_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({ vehicle_id: vehicle.id, command: 'flash_lights' }),
      });
      const result = await resp.json().catch(() => ({}));
      if (resp.ok) {
        results.push(`Tesla flash (${vehicle.name})`);
      } else {
        results.push(`Tesla flash failed (${vehicle.name}): ${result.error || 'unknown'}`);
      }
    }
  } catch (err) {
    results.push(`Tesla flash error: ${err.message}`);
  }

  // Govee pulse (best-effort: set amber then restore)
  try {
    const { data: groups } = await supabase
      .from('govee_devices')
      .select('device_id, name')
      .eq('is_group', true)
      .eq('is_active', true);
    const group = groups?.length ? randomItem(groups) : null;
    if (group) {
      const stateResp = await fetch(GOVEE_CONTROL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({ action: 'getDeviceState', device: group.device_id, sku: 'SameModeGroup' }),
      });
      const stateJson = await stateResp.json().catch(() => ({}));
      const caps = stateJson?.payload?.capabilities || [];
      const prevBrightness = caps.find(c => c.instance === 'brightness')?.state?.value;
      const prevColor = caps.find(c => c.instance === 'colorRgb')?.state?.value;

      await fetch(GOVEE_CONTROL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({
          action: 'controlDevice',
          device: group.device_id,
          sku: 'SameModeGroup',
          capability: {
            type: 'devices.capabilities.color_setting',
            instance: 'colorRgb',
            value: 0xFF9900,
          },
        }),
      });
      await fetch(GOVEE_CONTROL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'apikey': SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({
          action: 'controlDevice',
          device: group.device_id,
          sku: 'SameModeGroup',
          capability: {
            type: 'devices.capabilities.range',
            instance: 'brightness',
            value: 70,
          },
        }),
      });

      await new Promise(r => setTimeout(r, 800));

      if (prevColor != null) {
        await fetch(GOVEE_CONTROL_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'apikey': SUPABASE_SERVICE_KEY,
          },
          body: JSON.stringify({
            action: 'controlDevice',
            device: group.device_id,
            sku: 'SameModeGroup',
            capability: {
              type: 'devices.capabilities.color_setting',
              instance: 'colorRgb',
              value: prevColor,
            },
          }),
        });
      }
      if (prevBrightness != null) {
        await fetch(GOVEE_CONTROL_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
            'apikey': SUPABASE_SERVICE_KEY,
          },
          body: JSON.stringify({
            action: 'controlDevice',
            device: group.device_id,
            sku: 'SameModeGroup',
            capability: {
              type: 'devices.capabilities.range',
              instance: 'brightness',
              value: prevBrightness,
            },
          }),
        });
      }

      results.push(`Govee pulse (${group.name})`);
    }
  } catch (err) {
    results.push(`Govee pulse error: ${err.message}`);
  }

  return results.length ? results.join(' | ') : null;
}

async function deliverWhisper() {
  const { data: config, error: configErr } = await supabase
    .from('spirit_whisper_config')
    .select('*')
    .eq('id', 1)
    .single();

  if (configErr || !config) {
    log('error', 'Failed to load config', { error: configErr?.message });
    return;
  }

  if (!config.is_active) return;

  const hour = getAustinHour();
  if (hour < config.min_hour || hour >= config.max_hour) return;

  const { count: todayCount } = await supabase
    .from('spirit_whisper_log')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'delivered')
    .gte('created_at', getAustinStartOfDayISO());

  if ((todayCount || 0) >= config.max_whispers_per_day) return;

  const { data: lastLog } = await supabase
    .from('spirit_whisper_log')
    .select('created_at')
    .eq('status', 'delivered')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastLog?.created_at) {
    const minsSince = (Date.now() - new Date(lastLog.created_at).getTime()) / (1000 * 60);
    if (minsSince < config.min_interval_minutes) return;
  }

  const context = await loadContext();
  const zones = DEFAULT_ZONES.length ? DEFAULT_ZONES : FALLBACK_ZONES;
  const targetZone = randomItem(zones);
  const vehicle = context.vehicles.length ? randomItem(context.vehicles) : null;

  const replacements = {
    resident_name: context.residents.length ? randomItem(context.residents) : 'friend',
    resident_count: context.residents.length ? context.residents.length : 1,
    vehicle_name: vehicle?.name || 'a Tesla',
    battery_level: vehicle?.last_state?.battery_level ?? Math.floor(50 + Math.random() * 40),
    temperature: context.temperature ?? Math.floor(68 + Math.random() * 8),
    zone_name: targetZone,
    alpaca_name: randomItem(['Harley', 'Lol', 'Cacao']),
    dog_name: randomItem(['Teacups', 'Mochi']),
    space_name: context.spaces.length ? randomItem(context.spaces) : 'the Playhouse',
    worker_name: context.workers.length ? randomItem(context.workers) : 'a caretaker',
    work_space: context.spaces.length ? randomItem(context.spaces) : 'the house',
    time_greeting: getTimeGreeting(),
  };

  const availableKeys = new Set(
    Object.entries(replacements)
      .filter(([, v]) => v != null && v !== '')
      .map(([k]) => k)
  );

  const template = await pickWhisperTemplate(config.current_chapter, availableKeys);
  if (!template) {
    log('warn', 'No eligible whisper templates', { chapter: config.current_chapter });
    return;
  }

  const resolved = resolveTemplate(template.text_template, replacements);
  const rendered = buildTTSPrompt(resolved, config.current_chapter);
  const voice = template.voice_override || config.tts_voice || 'Sulafat';

  const daysSinceStart = config.chapter_started_at
    ? (Date.now() - new Date(config.chapter_started_at).getTime()) / (1000 * 60 * 60 * 24)
    : 0;
  const volume = Math.min(
    Math.round(config.base_volume + daysSinceStart * config.volume_increment_per_day),
    config.max_volume
  );

  let delivered = false;
  let errorMsg = null;
  let audioUrl = null;

  try {
    const resp = await fetch(SONOS_CONTROL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
      },
      body: JSON.stringify({
        action: 'announce',
        text: rendered,
        voice,
        room: targetZone,
        volume,
      }),
    });
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      errorMsg = result.error || `Sonos error ${resp.status}`;
    } else {
      delivered = true;
      audioUrl = result.audio_url || null;
    }
  } catch (err) {
    errorMsg = err.message;
  }

  const deviceInteraction = await maybeTriggerDeviceInteraction(config.current_chapter, config);

  await supabase.from('spirit_whisper_log').insert({
    chapter: config.current_chapter,
    rendered_text: resolved,
    target_zone: targetZone,
    volume,
    tts_voice: voice,
    status: delivered ? 'delivered' : 'failed',
    device_interaction: deviceInteraction,
    audio_url: audioUrl,
    total_cost_usd: 0,
    tts_cost_usd: 0,
    ai_gen_cost_usd: 0,
  });

  if (delivered) {
    log('info', 'Whisper delivered', { zone: targetZone, volume, chapter: config.current_chapter });
  } else {
    log('error', 'Whisper failed', { error: errorMsg });
  }
}

// ============================================
// Main loop
// ============================================
let isProcessing = false;

async function pollLoop() {
  if (isProcessing) return;
  isProcessing = true;
  try {
    await deliverWhisper();
  } catch (err) {
    log('error', 'Deliver loop error', { error: err.message });
  } finally {
    isProcessing = false;
  }
}

async function main() {
  log('info', 'Spirit whisper worker starting', { pollInterval: `${POLL_INTERVAL_MS}ms` });

  const { error } = await supabase
    .from('spirit_whisper_config')
    .select('*', { count: 'exact', head: true })
    .eq('id', 1);

  if (error) {
    log('error', 'Failed to connect to Supabase', { error: error.message });
    process.exit(1);
  }

  setInterval(pollLoop, POLL_INTERVAL_MS);
  await pollLoop();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
