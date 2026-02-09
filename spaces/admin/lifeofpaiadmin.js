/**
 * Life of PAI Admin - Control panel for spirit whisper system
 */

import { initAdminPage, showToast } from '../../shared/admin-shell.js';
import { supabase } from '../../shared/supabase.js';

let config = null;
let currentPoolChapter = 1;
let isAdmin = false;
let currentAudio = null;

async function initPaiAdmin(authState) {
  const role = authState.appUser?.role;
  isAdmin = ['admin', 'oracle'].includes(role);

  // Hide admin-only sections for non-admins
  if (!isAdmin) {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hidden'));
  }

  await loadConfig();
  await loadStats();
  await loadWhisperPool(1);
  await loadDeliveryLog();

  // Bind events (admin only)
  if (isAdmin) {
    document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
    document.getElementById('testWhisperBtn').addEventListener('click', sendTestWhisper);
    document.getElementById('testPreviewBtn').addEventListener('click', previewTestWhisper);
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

  // Toggle label
  document.getElementById('cfgActive').addEventListener('change', (e) => {
    document.getElementById('cfgActiveLabel').textContent = e.target.checked ? 'On' : 'Off';
  });
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
    updated_at: new Date().toISOString()
  };

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
  await loadStats();
}

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
}

async function loadWhisperPool(chapter) {
  const { data, error } = await supabase
    .from('spirit_whispers')
    .select('*')
    .eq('chapter', chapter)
    .order('created_at', { ascending: true });

  const tbody = document.getElementById('whisperPoolBody');
  const countEl = document.getElementById('whisperPoolCount');

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

    return `
      <div class="log-entry">
        <span class="log-time">${timeStr}</span>
        <span class="log-zone">${log.target_zone}</span>
        <span class="log-text">"${escapeHtml(log.rendered_text)}"</span>
        <span class="log-status ${statusClass}">${log.status}</span>
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
  const spaces = ['Garage Mahal', 'Sparadise', 'Skyloft', 'Magic Bus', 'Swim Spa', 'Sauna', 'Skyloft Balcony', 'Cedar Chamber'];
  const residents = ['Jon', 'Kymberly', 'Aseem', 'Safiyya', 'Ai', 'John', 'Rachel'];
  const vehicles = ['Casper', 'Delphi', 'Cygnus', 'Sloop', 'Brisa Branca'];
  const rand = arr => arr[Math.floor(Math.random() * arr.length)];

  const workers = ['Jackie', 'Justin', 'Donald', 'Rahul'];
  const workSpaces = ['Outhouse', 'Garage Mahal', 'Sparadise', 'Skyloft', 'Main House', 'Swim Spa'];

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
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

async function previewWhisper(template, voiceOverride, triggerBtn) {
  const resolved = resolveForPreview(template);
  const text = addWhisperTone(resolved);
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

/** Wrap text with whisper tone delivery cue for Gemini TTS */
function addWhisperTone(text) {
  // Gemini TTS responds to SSML-like cues and textual delivery hints
  return `(speaking in a soft, gentle whisper, slowly and mysteriously) ${text}`;
}

async function previewTestWhisper() {
  const rawText = document.getElementById('testText').value.trim();
  if (!rawText) {
    showToast('Enter whisper text', 'warning');
    return;
  }
  const text = addWhisperTone(rawText);
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

// Initialize
initAdminPage({
  activeTab: null,
  requiredRole: 'resident',
  onReady: initPaiAdmin
});
