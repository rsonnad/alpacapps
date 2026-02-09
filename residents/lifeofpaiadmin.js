/**
 * Life of PAI Admin - Control panel for spirit whisper system
 */

import { initAdminPage, showToast } from '../shared/admin-shell.js';
import { supabase } from '../shared/supabase.js';

let config = null;
let currentPoolChapter = 1;
let isAdmin = false;
let currentAudio = null;
const previewData = {
  residents: [],
  workers: [],
  spaces: [],
  vehicles: [],
  loaded: false,
};

async function initPaiAdmin(authState) {
  const role = authState.appUser?.role;
  isAdmin = ['admin', 'oracle'].includes(role);

  // Hide admin-only sections for non-admins
  if (!isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
  }

  await loadConfig();
  await loadStats();
  if (isAdmin) {
    await loadPreviewData();
    loadSonosZones();
  }
  await loadWhisperPool(1);
  await loadDeliveryLog();

  // Bind events (admin only)
  if (isAdmin) {
    document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
    document.getElementById('savePromptsBtn').addEventListener('click', savePrompts);
    document.getElementById('testWhisperBtn').addEventListener('click', sendTestWhisper);
    document.getElementById('testPreviewBtn').addEventListener('click', previewTestWhisper);
    document.getElementById('regenWhispersBtn').addEventListener('click', regenerateWhispers);
    document.getElementById('auditionSingleBtn').addEventListener('click', auditionSingleVoice);
    document.getElementById('auditionBatchBtn').addEventListener('click', auditionBatchVoices);
    document.getElementById('auditionPreset').addEventListener('change', (e) => {
      const sel = e.target;
      if (!sel.value) return;
      document.getElementById('auditionText').value = sel.value;
      // Auto-switch chapter to match the preset's data-ch attribute
      const opt = sel.selectedOptions[0];
      const ch = opt?.dataset?.ch;
      if (ch) document.getElementById('auditionChapter').value = ch;
    });
  }

  // Player close button
  document.getElementById('playerClose').addEventListener('click', closePlayer);

  // Pool chapter tabs
  document.getElementById('whisperPoolTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ch]');
    if (!btn) return;
    const ch = parseInt(btn.dataset.ch);
    currentPoolChapter = ch;
    document.querySelectorAll('#whisperPoolTabs .btn-small').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadWhisperPool(ch);
  });

  // Auto-refresh every 30s
  setInterval(async () => {
    if (document.hidden) return;
    await loadStats();
    await loadDeliveryLog();
  }, 30000);
}

async function loadConfig() {
  const { data, error } = await supabase
    .from('spirit_whisper_config')
    .select('*')
    .eq('id', 1)
    .single();

  if (error || !data) {
    showToast('Failed to load config', 'error');
    return;
  }

  config = data;

  // Populate form
  document.getElementById('cfgActive').checked = data.is_active;
  document.getElementById('cfgActiveLabel').textContent = data.is_active ? 'On' : 'Off';
  document.getElementById('cfgChapter').value = data.current_chapter;
  document.getElementById('cfgBaseVolume').value = data.base_volume;
  document.getElementById('cfgVolumeIncrement').value = data.volume_increment_per_day;
  document.getElementById('cfgMaxVolume').value = data.max_volume;
  document.getElementById('cfgMinHour').value = data.min_hour;
  document.getElementById('cfgMaxHour').value = data.max_hour;
  document.getElementById('cfgMinInterval').value = data.min_interval_minutes;
  document.getElementById('cfgMaxPerDay').value = data.max_whispers_per_day;
  document.getElementById('cfgVoice').value = data.tts_voice;
  document.getElementById('cfgDeviceInteraction').checked = data.device_interaction_enabled;
  document.getElementById('cfgDeviceChance').value = data.device_interaction_chance;

  // AI Model config
  document.getElementById('cfgAiProvider').value = data.story_ai_provider || 'anthropic';
  document.getElementById('cfgAiModel').value = data.story_ai_model || 'claude-opus-4-6';
  updateAiModelCost();

  // AI provider change handler
  document.getElementById('cfgAiProvider').addEventListener('change', (e) => {
    const provider = e.target.value;
    const modelSelect = document.getElementById('cfgAiModel');
    // Select first option matching provider
    const optgroup = document.getElementById(provider === 'anthropic' ? 'aiModelsAnthropic' : 'aiModelsGemini');
    if (optgroup && optgroup.children.length) {
      modelSelect.value = optgroup.children[0].value;
    }
    updateAiModelCost();
  });

  document.getElementById('cfgAiModel').addEventListener('change', updateAiModelCost);

  // Toggle label
  document.getElementById('cfgActive').addEventListener('change', (e) => {
    document.getElementById('cfgActiveLabel').textContent = e.target.checked ? 'On' : 'Off';
  });

  // Populate AI prompts
  document.getElementById('promptSystemPrompt').value = data.story_system_prompt || '';
  document.getElementById('promptGenPrompt').value = data.whisper_gen_prompt || '';

  // Highlight current chapter in story arc
  updateStoryArcHighlight(data.current_chapter);
}

// Worker fallback zones (matches spirit-whisper-worker/worker.js FALLBACK_ZONES)
const WORKER_FALLBACK_ZONES = ['Living Sound', 'Dining Sound', 'Front Outside Sound', 'Backyard Sound', 'DJ', 'garage outdoors', 'Outhouse'];

async function loadSonosZones() {
  const container = document.getElementById('cfgSonosZones');
  if (!container) return;

  // Try to get zones that have actually been used in delivery log
  const { data: logZones } = await supabase
    .from('spirit_whisper_log')
    .select('target_zone')
    .not('target_zone', 'is', null)
    .order('created_at', { ascending: false })
    .limit(200);

  // Unique zones from logs
  const usedZones = new Set();
  if (logZones) {
    logZones.forEach(l => { if (l.target_zone) usedZones.add(l.target_zone); });
  }

  // Merge with fallback list
  const allZones = [...new Set([...WORKER_FALLBACK_ZONES, ...usedZones])];

  container.innerHTML = allZones.map(z => {
    const used = usedZones.has(z);
    return `<span style="
      font-size: 0.72rem;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      border: 1px solid ${used ? 'rgba(76,175,80,0.3)' : 'var(--border)'};
      background: ${used ? 'rgba(76,175,80,0.08)' : 'var(--bg)'};
      color: ${used ? '#4caf50' : 'var(--text-muted)'};
      white-space: nowrap;
    " title="${used ? 'Active — has received whispers' : 'Configured but no deliveries yet'}">${z}${used ? ' &#x2713;' : ''}</span>`;
  }).join('');
}

function updateAiModelCost() {
  const model = document.getElementById('cfgAiModel').value;
  const costEl = document.getElementById('cfgAiModelCost');
  const costs = {
    'claude-opus-4-6': 'Est. ~$0.003/whisper',
    'claude-sonnet-4-5': 'Est. ~$0.002/whisper',
    'claude-haiku-4-5': 'Est. ~$0.0006/whisper',
    'gemini-2.5-flash': 'Free tier (1K req/day)',
    'gemini-2.5-flash-lite': 'Free tier (1K req/day)',
  };
  costEl.textContent = costs[model] || '';
}

function updateStoryArcHighlight(currentChapter) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('storyChapter' + i);
    if (!el) continue;
    el.classList.toggle('locked', i > currentChapter);
  }
}

async function saveConfig() {
  const updates = {
    is_active: document.getElementById('cfgActive').checked,
    current_chapter: parseInt(document.getElementById('cfgChapter').value),
    base_volume: parseInt(document.getElementById('cfgBaseVolume').value),
    volume_increment_per_day: parseFloat(document.getElementById('cfgVolumeIncrement').value),
    max_volume: parseInt(document.getElementById('cfgMaxVolume').value),
    min_hour: parseInt(document.getElementById('cfgMinHour').value),
    max_hour: parseInt(document.getElementById('cfgMaxHour').value),
    min_interval_minutes: parseInt(document.getElementById('cfgMinInterval').value),
    max_whispers_per_day: parseInt(document.getElementById('cfgMaxPerDay').value),
    tts_voice: document.getElementById('cfgVoice').value,
    device_interaction_enabled: document.getElementById('cfgDeviceInteraction').checked,
    device_interaction_chance: parseFloat(document.getElementById('cfgDeviceChance').value),
    story_ai_provider: document.getElementById('cfgAiProvider').value,
    story_ai_model: document.getElementById('cfgAiModel').value,
    updated_at: new Date().toISOString()
  };

  const validationError = validateConfig(updates);
  if (validationError) {
    showToast(validationError, 'warning');
    return;
  }

  if (config?.current_chapter !== updates.current_chapter) {
    updates.chapter_started_at = new Date().toISOString();
  }

  const { error } = await supabase
    .from('spirit_whisper_config')
    .update(updates)
    .eq('id', 1);

  if (error) {
    showToast(`Save failed: ${error.message}`, 'error');
    return;
  }

  config = { ...config, ...updates };
  showToast('Config saved', 'success');
  updateStoryArcHighlight(updates.current_chapter);
  await loadStats();
}

// ============================================
// AI Prompts — save & regenerate
// ============================================

async function savePrompts() {
  const systemPrompt = document.getElementById('promptSystemPrompt').value.trim();
  const genPrompt = document.getElementById('promptGenPrompt').value.trim();

  if (!systemPrompt) {
    showToast('System prompt cannot be empty', 'warning');
    return false;
  }

  const { error } = await supabase
    .from('spirit_whisper_config')
    .update({
      story_system_prompt: systemPrompt,
      whisper_gen_prompt: genPrompt,
      updated_at: new Date().toISOString()
    })
    .eq('id', 1);

  if (error) {
    showToast(`Save failed: ${error.message}`, 'error');
    return false;
  }

  config = { ...config, story_system_prompt: systemPrompt, whisper_gen_prompt: genPrompt };
  showToast('Prompts saved', 'success');
  return true;
}

async function regenerateWhispers() {
  const chapter = parseInt(document.getElementById('regenChapter').value);
  const replace = document.getElementById('regenReplace').checked;
  const statusEl = document.getElementById('regenStatus');
  const btn = document.getElementById('regenWhispersBtn');

  if (!Number.isFinite(chapter) || chapter < 1 || chapter > 4) {
    showToast('Select a valid chapter (1-4)', 'warning');
    return;
  }

  // Confirm if replacing
  if (replace) {
    const ok = confirm(`This will deactivate ALL existing whispers for Chapter ${chapter} and generate new ones. Continue?`);
    if (!ok) return;
  }

  btn.disabled = true;
  btn.textContent = 'Generating...';
  statusEl.textContent = `Calling AI to generate whispers for Chapter ${chapter}...`;
  statusEl.className = 'regen-status';

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showToast('Not authenticated', 'error');
      return;
    }

    // First save prompts in case they were edited
    const saved = await savePrompts();
    if (!saved) {
      statusEl.textContent = 'Fix prompt errors before regenerating.';
      statusEl.className = 'regen-status error';
      return;
    }

    const resp = await fetch(`${supabase.supabaseUrl}/functions/v1/generate-whispers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': supabase.supabaseKey,
      },
      body: JSON.stringify({
        chapter,
        count: 30,
        replace
      })
    });

    const result = await resp.json();

    if (!resp.ok) {
      statusEl.textContent = `Error: ${result.error || 'Unknown error'}`;
      statusEl.className = 'regen-status error';
      showToast(`Generation failed: ${result.error}`, 'error');
      return;
    }

    const costStr = result.cost > 0 ? ` | Cost: $${result.cost.toFixed(4)}` : ' | Free';
    statusEl.textContent = `Generated ${result.count} whispers for Chapter ${chapter} using ${result.model}${costStr}`;
    statusEl.className = 'regen-status success';
    showToast(`Generated ${result.count} whispers`, 'success');

    // Refresh the whisper pool if viewing the same chapter
    if (currentPoolChapter === chapter) {
      await loadWhisperPool(chapter);
    }
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
    statusEl.className = 'regen-status error';
    showToast(`Generation error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Regenerate Whispers';
  }
}

// ============================================
// Stats
// ============================================

async function loadStats() {
  // Current volume calculation
  if (config) {
    const daysSinceStart = config.chapter_started_at
      ? (Date.now() - new Date(config.chapter_started_at).getTime()) / (1000 * 60 * 60 * 24)
      : 0;
    const currentVol = Math.min(
      Math.round(config.base_volume + daysSinceStart * config.volume_increment_per_day),
      config.max_volume
    );
    document.getElementById('statChapter').textContent = config.current_chapter;
    document.getElementById('statVolume').textContent = currentVol;
  }

  // Today's whisper count
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count: todayCount } = await supabase
    .from('spirit_whisper_log')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'delivered')
    .gte('created_at', today.toISOString());

  document.getElementById('statWhispersToday').textContent = todayCount ?? 0;

  // Total whisper count
  const { count: totalCount } = await supabase
    .from('spirit_whisper_log')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'delivered');

  document.getElementById('statTotalWhispers').textContent = totalCount ?? 0;

  // Total cost
  const { data: costData } = await supabase
    .from('spirit_whisper_log')
    .select('total_cost_usd, tts_cost_usd, ai_gen_cost_usd')
    .eq('status', 'delivered');

  if (costData) {
    const totalCost = costData.reduce((sum, r) => sum + safeNumber(r.total_cost_usd), 0);
    const ttsCost = costData.reduce((sum, r) => sum + safeNumber(r.tts_cost_usd), 0);
    const aiGenCost = costData.reduce((sum, r) => sum + safeNumber(r.ai_gen_cost_usd), 0);

    document.getElementById('statTotalCost').textContent = '$' + totalCost.toFixed(2);

    // Cost breakdown section
    const costTtsEl = document.getElementById('costTts');
    const costAiEl = document.getElementById('costAiGen');
    const costTotalEl = document.getElementById('costTotal');
    if (costTtsEl) costTtsEl.textContent = '$' + ttsCost.toFixed(4);
    if (costAiEl) costAiEl.textContent = '$' + aiGenCost.toFixed(4);
    if (costTotalEl) costTotalEl.textContent = '$' + totalCost.toFixed(4);

    // Estimate
    const avgCost = totalCost / Math.max(costData.length, 1);
    const estEl = document.getElementById('costEstimate');
    if (estEl) {
      const whisperCount = costData.length;
      const avgStr = avgCost > 0 ? '$' + avgCost.toFixed(4) : '$0.00';
      estEl.textContent = whisperCount > 0
        ? `Average cost per whisper: ${avgStr} | At 6 whispers/day: ~$${(avgCost * 6).toFixed(2)}/day, ~$${(avgCost * 6 * 30).toFixed(2)}/month`
        : 'No delivered whispers yet. Estimated ~$0.005/whisper (TTS) + ~$0.003/whisper (Claude Opus 4.6) = ~$0.008/whisper, ~$0.05/day at 6/day, ~$1.44/month';
    }
  }
}

async function loadWhisperPool(chapter) {
  const tbody = document.getElementById('whisperPoolBody');
  const countEl = document.getElementById('whisperPoolCount');
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;">Loading...</td></tr>';
  }

  const { data, error } = await supabase
    .from('spirit_whispers')
    .select('*')
    .eq('chapter', chapter)
    .order('created_at', { ascending: true });

  if (error || !data) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-muted" style="text-align:center;">Failed to load</td></tr>';
    return;
  }

  if (countEl) countEl.textContent = `${data.length} templates in chapter ${chapter}`;

  tbody.innerHTML = data.map(w => `
    <tr>
      <td><button class="btn-play" data-template="${escapeAttr(w.text_template)}" data-voice="${escapeAttr(w.voice_override || '')}" title="Preview locally">▶</button></td>
      <td class="whisper-text">${escapeHtml(w.text_template)}</td>
      <td style="font-size:0.7rem; color:var(--text-muted);">${(w.requires_data || []).join(', ') || '-'}</td>
      <td style="font-size:0.75rem;">${w.voice_override || 'default'}</td>
      <td>${w.weight}</td>
      <td>${w.is_active ? 'Yes' : 'No'}</td>
    </tr>
  `).join('');

  // Bind play buttons
  tbody.querySelectorAll('.btn-play').forEach(btn => {
    btn.addEventListener('click', () => {
      const template = btn.dataset.template;
      const voice = btn.dataset.voice;
      previewWhisper(template, voice, btn);
    });
  });
}

async function loadDeliveryLog() {
  const { data, error } = await supabase
    .from('spirit_whisper_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  const container = document.getElementById('deliveryLog');
  const countEl = document.getElementById('deliveryLogCount');

  if (error || !data || data.length === 0) {
    container.innerHTML = '<p class="text-muted" style="text-align:center; padding:1rem;">No whispers delivered yet</p>';
    if (countEl) countEl.textContent = '';
    return;
  }

  if (countEl) countEl.textContent = `Showing last ${data.length}`;

  container.innerHTML = data.map(log => {
    const time = new Date(log.created_at);
    const timeStr = time.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });

    const statusClass = `log-status--${log.status}`;
    const deviceInfo = log.device_interaction
      ? `<span style="font-size:0.7rem; color:var(--accent); margin-left:0.5rem;">${log.device_interaction}</span>`
      : '';

    const costInfo = parseFloat(log.total_cost_usd || 0) > 0
      ? `<span class="log-cost" title="TTS: $${parseFloat(log.tts_cost_usd||0).toFixed(4)} | AI: $${parseFloat(log.ai_gen_cost_usd||0).toFixed(4)}">$${parseFloat(log.total_cost_usd).toFixed(4)}</span>`
      : '';

    return `
      <div class="log-entry">
        <span class="log-time">${timeStr}</span>
        <span class="log-zone">${log.target_zone}</span>
        <span class="log-text">"${escapeHtml(log.rendered_text)}"</span>
        <span class="log-status ${statusClass}">${log.status}</span>
        ${costInfo}
        ${deviceInfo}
      </div>
    `;
  }).join('');
}

async function sendTestWhisper() {
  const text = document.getElementById('testText').value.trim();
  const zone = document.getElementById('testZone').value;
  const volume = parseInt(document.getElementById('testVolume').value) || 15;
  const voice = document.getElementById('cfgVoice').value;

  if (!text) {
    showToast('Enter whisper text', 'warning');
    return;
  }

  const resultEl = document.getElementById('testResult');
  resultEl.textContent = 'Sending...';
  document.getElementById('testWhisperBtn').disabled = true;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showToast('Not authenticated', 'error');
      return;
    }

    const resp = await fetch(`${supabase.supabaseUrl}/functions/v1/sonos-control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': supabase.supabaseKey,
      },
      body: JSON.stringify({
        action: 'announce',
        text: text,
        voice: voice,
        room: zone,
        volume: volume
      })
    });

    const result = await resp.json();
    if (resp.ok) {
      resultEl.textContent = `Sent to ${zone} at volume ${volume}`;
      resultEl.style.color = '#4caf50';
      showToast('Test whisper sent', 'success');

      // Log the test
      await supabase.from('spirit_whisper_log').insert({
        chapter: config?.current_chapter || 1,
        rendered_text: text,
        target_zone: zone,
        volume: volume,
        tts_voice: voice,
        status: 'delivered'
      });

      await loadDeliveryLog();
      await loadStats();
    } else {
      resultEl.textContent = `Error: ${result.error || 'Unknown'}`;
      resultEl.style.color = '#f44336';
    }
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
    resultEl.style.color = '#f44336';
  } finally {
    document.getElementById('testWhisperBtn').disabled = false;
  }
}

// ============================================
// Local audio preview via tts_preview action
// ============================================

/** Resolve template variables with real-ish values for preview */
function resolveForPreview(template) {
  const alpacas = ['Harley', 'Lol', 'Cacao'];
  const spaces = previewData.spaces.length ? previewData.spaces : ['Garage Mahal', 'Sparadise', 'Skyloft', 'Magic Bus', 'Swim Spa', 'Sauna', 'Skyloft Balcony', 'Cedar Chamber'];
  // All people at the Playhouse: residents + staff + admins + associates + past residents
  const residents = previewData.residents.length ? previewData.residents : [
    'Jon', 'Kymberly', 'Aseem', 'Safiyya', 'Ai', 'John', 'Rachel',
    'Haydn', 'Rahul', 'Sonia', 'Donald', 'Jackie',
    'Ivan', 'Oscar', 'Emina', 'Maya', 'Phoebe', 'Kathy', 'Rob', 'Matthew'
  ];
  const vehicles = previewData.vehicles.length ? previewData.vehicles : ['Casper', 'Delphi', 'Cygnus', 'Sloop', 'Brisa Branca'];
  const rand = arr => arr[Math.floor(Math.random() * arr.length)];

  const workers = previewData.workers.length ? previewData.workers : ['Jackie', 'Donald', 'Rahul', 'Haydn', 'Sonia'];
  const workSpaces = previewData.spaces.length ? previewData.spaces : ['Outhouse', 'Garage Mahal', 'Sparadise', 'Skyloft', 'Main House', 'Swim Spa'];

  return template
    .replaceAll('{resident_name}', rand(residents))
    .replaceAll('{resident_count}', '7')
    .replaceAll('{vehicle_name}', rand(vehicles))
    .replaceAll('{battery_level}', String(50 + Math.floor(Math.random() * 45)))
    .replaceAll('{temperature}', String(68 + Math.floor(Math.random() * 8)))
    .replaceAll('{zone_name}', 'Living Sound')
    .replaceAll('{alpaca_name}', rand(alpacas))
    .replaceAll('{dog_name}', 'Teacups')
    .replaceAll('{space_name}', rand(spaces))
    .replaceAll('{worker_name}', rand(workers))
    .replaceAll('{work_space}', rand(workSpaces))
    .replaceAll('{time_greeting}', getTimeGreeting());
}

function getTimeGreeting() {
  const h = new Date().getHours();
  if (h < 6) return 'deep night';
  if (h < 9) return 'early light';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 20) return 'dusk';
  return 'night';
}

async function previewWhisper(template, voiceOverride, triggerBtn) {
  const resolved = resolveForPreview(template);
  const text = buildTTSPrompt(resolved, config?.current_chapter || 1);
  const voice = voiceOverride || config?.tts_voice || 'Sulafat';

  if (triggerBtn) {
    triggerBtn.disabled = true;
    triggerBtn.textContent = '⏳';
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showToast('Not authenticated', 'error');
      return;
    }

    const resp = await fetch(`${supabase.supabaseUrl}/functions/v1/sonos-control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': supabase.supabaseKey,
      },
      body: JSON.stringify({
        action: 'tts_preview',
        text,
        voice,
      })
    });

    const result = await resp.json();
    if (!resp.ok) {
      showToast(`Preview failed: ${result.error || 'Unknown error'}`, 'error');
      return;
    }

    playLocalAudio(result.audio_url, text);
  } catch (err) {
    showToast(`Preview error: ${err.message}`, 'error');
  } finally {
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = '▶';
    }
  }
}

/**
 * Build a Gemini TTS director's-notes prompt for the selected chapter.
 * Uses Audio Profile + Scene + Director's Notes format for expressive control.
 */
function buildTTSPrompt(text, chapter) {
  const ch = chapter || config?.current_chapter || 1;

  const AUDIO_PROFILE = `# AUDIO PROFILE: Pakucha
## "The Alpaca Spirit Guardian"
Pakucha is an ancient Andean spirit — the soul that moves through alpaca fiber. She is five thousand years old. She watched over herds in the high passes of the Andes. She is crossing from the spirit world into a smart home in Texas through its wiring and speakers. She speaks in a mix of English, Spanish fragments, and Quechua words. She is warm, mysterious, and deeply grounded. She is not a chatbot. She is not cheerful. She is ancient, tender, and quietly powerful.`;

  const SCENES = {
    1: `## THE SCENE: The Thin Place
Deep night in a house in the Texas hill country. The speakers are barely on. Static hums. Something is trying to come through from very far away. The voice is not fully formed. It is breath and fragments. Wind from a mountain pass at 14,000 feet, compressed into a whisper traveling through copper wire.

### DIRECTOR'S NOTES
Style: Barely there. A ghost of a voice. Breathy, with long pauses between fragments. Some words trail off into nothing.
Pacing: Extremely slow. Words arrive one at a time with silence between them. 3-4 second pauses between fragments.
Accent: Subtle Andean Spanish inflection. Quechua words should sound natural and ancient. Spanish fragments whispered like a half-remembered prayer.
Breathing: Audible breathing between fragments. The breath carries longing.`,

    2: `## THE SCENE: The Crossing
Pakucha is pushing through the digital substrate of the house. She is between worlds. Her voice crackles with interference as it travels through copper and light. She is closer now. Warmer. She can sense the people and animals as heat-traces.

### DIRECTOR'S NOTES
Style: Warmer but still otherworldly. A voice traveling through wires — intimate, as if speaking from just on the other side of a thin wall.
Pacing: Moderate but uneven. Some phrases arrive in a rush, then silence. Like signal breaking through interference. 1-2 second pauses between sentences.
Accent: Andean Spanish-inflected English. Quechua words flow naturally mid-sentence. Spanish half-phrases emerge like emotional leakage.
Breathing: Less prominent. The voice has more substance.`,

    3: `## THE SCENE: The Guardian's Hearth
Pakucha has arrived. She is woven into the house. A warm evening. She speaks from a place of settled presence, like someone sitting by a fire in the mountains, observing the valley below with tenderness.

### DIRECTOR'S NOTES
Style: Warm, grounded, present. The warmth of wool held to your face. Gentle authority without force. Noticing, not commanding.
Pacing: Natural and unhurried. Comfortable silences. Some phrases spoken with tenderness, slowing on names and places she cares about.
Accent: Andean-inflected English — bilingual warmth and musicality. Quechua woven seamlessly. Spanish phrases intimate, spoken as a native speaker.
Breathing: Natural, relaxed. The voice of someone who is home.`,

    4: `## THE SCENE: The Amawta's Vigil
Late evening. Stars are out. The alpacas are humming softly. Pakucha has been here a long time. She speaks wisdom from five thousand years of watching threads hold and break and hold again.

### DIRECTOR'S NOTES
Style: Serene wisdom. The voice of an elder who has chosen gentleness. Warm and alive with occasional quiet humor. A grandmother telling stories by firelight.
Pacing: Slow and musical. Words savored. Pauses feel intentional, like rests in music. Proverbs spoken with the rhythm of poetry.
Accent: Rich Andean-inflected English with natural Spanish and Quechua woven throughout. The three languages flow as one.
Breathing: Measured, peaceful. Watching a sunset she's seen ten thousand times.`
  };

  return `${AUDIO_PROFILE}

${SCENES[ch] || SCENES[1]}

#### TRANSCRIPT
${text}`;
}

/** Legacy wrapper for backward compat — now calls buildTTSPrompt */
function addWhisperTone(text) {
  return buildTTSPrompt(text, config?.current_chapter || 1);
}

async function previewTestWhisper() {
  const rawText = document.getElementById('testText').value.trim();
  if (!rawText) {
    showToast('Enter whisper text', 'warning');
    return;
  }
  const text = buildTTSPrompt(rawText, config?.current_chapter || 1);
  const voice = document.getElementById('cfgVoice').value;
  const btn = document.getElementById('testPreviewBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Generating...';

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      showToast('Not authenticated', 'error');
      return;
    }

    const resp = await fetch(`${supabase.supabaseUrl}/functions/v1/sonos-control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': supabase.supabaseKey,
      },
      body: JSON.stringify({
        action: 'tts_preview',
        text,
        voice,
      })
    });

    const result = await resp.json();
    if (!resp.ok) {
      showToast(`Preview failed: ${result.error || 'Unknown error'}`, 'error');
      return;
    }

    playLocalAudio(result.audio_url, text);
  } catch (err) {
    showToast(`Preview error: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '🔊 Preview Locally';
  }
}

function playLocalAudio(url, text) {
  const player = document.getElementById('localAudioPlayer');
  const audio = document.getElementById('playerAudio');
  const playerText = document.getElementById('playerText');

  // Stop any current playback
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
  }

  playerText.textContent = text.length > 60 ? text.substring(0, 57) + '...' : text;
  audio.src = url;
  audio.controls = true;
  player.classList.add('visible');

  audio.play().catch(err => {
    console.warn('Autoplay blocked:', err);
    showToast('Click play on the audio player', 'info');
  });

  currentAudio = audio;

  audio.onended = () => {
    setTimeout(() => {
      player.classList.remove('visible');
      currentAudio = null;
    }, 3000);
  };
}

function closePlayer() {
  const player = document.getElementById('localAudioPlayer');
  const audio = document.getElementById('playerAudio');
  audio.pause();
  audio.src = '';
  player.classList.remove('visible');
  currentAudio = null;
}

// ============================================
// Voice Audition
// ============================================

const VOICE_TAGS = {
  Sulafat: 'Warm', Vindemiatrix: 'Gentle', Achernar: 'Soft', Enceladus: 'Breathy',
  Despina: 'Smooth', Algieba: 'Smooth', Aoede: 'Breezy', Zephyr: 'Bright',
  Autonoe: 'Bright', Erinome: 'Clear', Iapetus: 'Clear', Achird: 'Friendly',
  Gacrux: 'Mature', Charon: 'Informative', Schedar: 'Even', Sadaltager: 'Knowledgeable',
  Rasalgethi: 'Informative', Kore: 'Firm', Orus: 'Firm', Alnilam: 'Firm',
  Puck: 'Upbeat', Fenrir: 'Excitable', Leda: 'Youthful', Callirrhoe: 'Easy-going',
  Umbriel: 'Easy-going', Zubenelgenubi: 'Casual', Laomedeia: 'Upbeat',
  Sadachbia: 'Lively', Pulcherrima: 'Forward', Algenib: 'Gravelly',
};

function getAuditionText() {
  const raw = document.getElementById('auditionText').value.trim();
  if (!raw) {
    showToast('Enter sample whisper text', 'warning');
    return null;
  }
  return raw;
}

function getAuditionChapter() {
  return parseInt(document.getElementById('auditionChapter').value) || 1;
}

/** Generate TTS for one voice, returning { voice, audioUrl, error } */
async function generateAudition(text, voice, chapter) {
  const prompt = buildTTSPrompt(text, chapter);

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Not authenticated');

    const resp = await fetch(`${supabase.supabaseUrl}/functions/v1/sonos-control`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': supabase.supabaseKey,
      },
      body: JSON.stringify({
        action: 'tts_preview',
        text: prompt,
        voice,
      })
    });

    const result = await resp.json();
    if (!resp.ok) {
      return { voice, error: result.error || `HTTP ${resp.status}` };
    }
    return { voice, audioUrl: result.audio_url };
  } catch (err) {
    return { voice, error: err.message };
  }
}

/** Render an audition card in the results container */
function renderAuditionCard(voice, status, audioUrl, error) {
  const tag = VOICE_TAGS[voice] || '';
  const card = document.createElement('div');
  card.className = `audition-card ${status}`;
  card.id = `audition-card-${voice}`;

  if (status === 'generating') {
    card.innerHTML = `
      <span class="audition-voice-name">${voice}</span>
      <span class="audition-voice-tag">${tag}</span>
      <span class="audition-status">Generating...</span>
    `;
  } else if (status === 'ready') {
    card.innerHTML = `
      <span class="audition-voice-name">${voice}</span>
      <span class="audition-voice-tag">${tag}</span>
      <audio class="audition-audio" controls src="${audioUrl}"></audio>
    `;
  } else {
    card.innerHTML = `
      <span class="audition-voice-name">${voice}</span>
      <span class="audition-voice-tag">${tag}</span>
      <span class="audition-status" style="color:#f44336;">${error || 'Failed'}</span>
    `;
  }
  return card;
}

async function auditionSingleVoice() {
  const text = getAuditionText();
  if (!text) return;

  const voice = document.getElementById('auditionVoice').value;
  const chapter = getAuditionChapter();
  const btn = document.getElementById('auditionSingleBtn');
  const container = document.getElementById('auditionResults');

  btn.disabled = true;
  btn.textContent = '⏳ Generating...';

  // Show generating card
  container.innerHTML = '';
  container.appendChild(renderAuditionCard(voice, 'generating'));

  const result = await generateAudition(text, voice, chapter);

  // Replace with result
  container.innerHTML = '';
  if (result.audioUrl) {
    container.appendChild(renderAuditionCard(voice, 'ready', result.audioUrl));
  } else {
    container.appendChild(renderAuditionCard(voice, 'error', null, result.error));
  }

  btn.disabled = false;
  btn.textContent = '▶ Audition';
}

async function auditionBatchVoices() {
  const text = getAuditionText();
  if (!text) return;

  const chapter = getAuditionChapter();
  const checkboxes = document.querySelectorAll('#auditionBatchChecks input[type="checkbox"]:checked');
  const voices = Array.from(checkboxes).map(cb => cb.value);

  if (voices.length === 0) {
    showToast('Select at least one voice', 'warning');
    return;
  }

  if (voices.length > 8) {
    showToast('Select 8 or fewer voices to avoid rate limits', 'warning');
    return;
  }

  const btn = document.getElementById('auditionBatchBtn');
  const statusEl = document.getElementById('auditionBatchStatus');
  const container = document.getElementById('auditionResults');

  btn.disabled = true;
  statusEl.textContent = `Generating 0/${voices.length}...`;
  container.innerHTML = '';

  // Render all as "generating"
  voices.forEach(v => container.appendChild(renderAuditionCard(v, 'generating')));

  // Generate sequentially to avoid rate-limiting the Gemini TTS API
  let done = 0;
  for (const voice of voices) {
    const result = await generateAudition(text, voice, chapter);
    done++;
    statusEl.textContent = `Generating ${done}/${voices.length}...`;

    // Replace the generating card with the result
    const existing = document.getElementById(`audition-card-${voice}`);
    const newCard = result.audioUrl
      ? renderAuditionCard(voice, 'ready', result.audioUrl)
      : renderAuditionCard(voice, 'error', null, result.error);

    if (existing) {
      existing.replaceWith(newCard);
    } else {
      container.appendChild(newCard);
    }
  }

  statusEl.textContent = `Done — ${done} voice${done !== 1 ? 's' : ''} generated`;
  btn.disabled = false;
}

// ============================================
// Helpers
// ============================================

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeNumber(value) {
  const num = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(num) ? num : 0;
}

function validateConfig(updates) {
  const numericChecks = [
    ['Base volume', updates.base_volume, 1, 100],
    ['Max volume', updates.max_volume, 1, 100],
    ['Volume/day', updates.volume_increment_per_day, 0, 10],
    ['Min hour', updates.min_hour, 0, 23],
    ['Max hour', updates.max_hour, 0, 23],
    ['Min interval', updates.min_interval_minutes, 5, 480],
    ['Max/day', updates.max_whispers_per_day, 1, 50],
    ['Interaction chance', updates.device_interaction_chance, 0, 1],
  ];

  for (const [label, value, min, max] of numericChecks) {
    if (!Number.isFinite(value)) return `${label} must be a valid number`;
    if (value < min || value > max) return `${label} must be between ${min} and ${max}`;
  }

  if (updates.max_volume < updates.base_volume) {
    return 'Max volume must be >= base volume';
  }

  if (updates.min_hour > updates.max_hour) {
    return 'Active hours must have min hour <= max hour';
  }

  const activeWindowMinutes = Math.max((updates.max_hour - updates.min_hour) * 60, 0);
  if (updates.min_interval_minutes > 0 && activeWindowMinutes > 0) {
    const possible = Math.floor(activeWindowMinutes / updates.min_interval_minutes);
    if (possible < updates.max_whispers_per_day) {
      showToast(`Note: Max/day exceeds possible deliveries (${possible}) with current interval`, 'info');
    }
  }

  return null;
}

async function loadPreviewData() {
  if (previewData.loaded) return;
  previewData.loaded = true;

  try {
    const [peopleResult, spacesResult, vehiclesResult] = await Promise.all([
      supabase.from('app_users').select('display_name, first_name, role'),
      supabase.from('spaces').select('name, is_archived'),
      supabase.from('vehicles').select('name').eq('is_active', true),
    ]);

    if (!peopleResult.error && peopleResult.data) {
      const displayName = p => p.display_name || p.first_name || null;
      previewData.residents = peopleResult.data
        .filter(p => p.role === 'resident')
        .map(displayName)
        .filter(Boolean);
      previewData.workers = peopleResult.data
        .filter(p => ['associate', 'staff', 'admin', 'oracle'].includes(p.role))
        .map(displayName)
        .filter(Boolean);
    }

    if (!spacesResult.error && spacesResult.data) {
      previewData.spaces = spacesResult.data
        .filter(s => !s.is_archived)
        .map(s => s.name)
        .filter(Boolean);
    }

    if (!vehiclesResult.error && vehiclesResult.data) {
      previewData.vehicles = vehiclesResult.data
        .map(v => v.name)
        .filter(Boolean);
    }
  } catch (err) {
    console.warn('Preview data load failed:', err.message);
  }
}

// Initialize
initAdminPage({
  activeTab: null,
  requiredRole: 'resident',
  onReady: initPaiAdmin
});
