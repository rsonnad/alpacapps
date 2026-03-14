/**
 * Kiosk Display - Hallway Tablet
 * No auth required. Polls data every 60s.
 * Landscape-optimized two-column layout.
 */

import { supabase, SUPABASE_URL } from '../shared/supabase.js';

const POLL_INTERVAL = 60_000;        // 60s data refresh
const VERSION_CHECK_INTERVAL = 300_000; // 5min version check
const AUSTIN_TZ = 'America/Chicago';
let currentVersion = null;

// Hardcoded alpaca facts as fallback when edge function + DB both fail
const FALLBACK_FACTS = [
  "Alpacas hum to communicate — it's their primary social sound and can express curiosity, contentment, or concern.",
  "Baby alpacas are called 'crias' and can stand and walk within an hour of birth.",
  "Alpaca fiber comes in over 22 natural colors, from white to black and everything in between.",
  "Alpacas are herd animals and can become stressed or depressed if kept alone.",
  "Unlike llamas, alpacas rarely spit at humans — they mostly reserve it for disagreements with other alpacas.",
  "Alpacas have soft padded feet instead of hooves, making them gentle on terrain and pastures.",
  "An alpaca's fleece grows about 5 inches per year and is warmer, softer, and lighter than sheep's wool.",
  "Alpacas originated in the Andes Mountains of South America and were domesticated over 6,000 years ago.",
  "Alpacas have a communal dung pile — the whole herd uses the same spot, making cleanup easy.",
  "Alpacas can recognize individual humans and other animals by sight and sound.",
];

let pollTimer = null;

// =============================================
// CLOCK
// =============================================
function updateClock() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: AUSTIN_TZ,
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: AUSTIN_TZ,
  });
  const el = document.getElementById('datetime');
  if (el) el.textContent = `${dateStr} \u2022 ${timeStr}`;
}

// =============================================
// OCCUPANTS
// =============================================
async function loadOccupants() {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: AUSTIN_TZ });
    const { data } = await supabase
      .from('assignments')
      .select(`
        id, start_date, end_date, status,
        person:person_id(first_name),
        assignment_spaces(space:space_id(name))
      `)
      .eq('status', 'active');

    if (!data || data.length === 0) {
      document.getElementById('occupantsGrid').innerHTML =
        '<span class="kiosk-empty">No current occupants</span>';
      return;
    }

    const current = data.filter(a => {
      if (!a.start_date) return false;
      if (a.start_date > today) return false;
      if (a.end_date && a.end_date < today) return false;
      return true;
    });

    if (current.length === 0) {
      document.getElementById('occupantsGrid').innerHTML =
        '<span class="kiosk-empty">No current occupants</span>';
      return;
    }

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toLocaleDateString('en-CA', { timeZone: AUSTIN_TZ });

    const pills = current.map(a => {
      const name = a.person?.first_name || 'Guest';
      const spaces = (a.assignment_spaces || [])
        .map(as => as.space?.name)
        .filter(Boolean)
        .join(', ');
      const isNew = a.start_date >= sevenDaysAgoStr;
      return `<span class="occupant-pill${isNew ? ' occupant-new' : ''}">
        ${escapeHtml(name)}${spaces ? ` <span class="occupant-space">\u2022 ${escapeHtml(spaces)}</span>` : ''}
      </span>`;
    }).join('');

    document.getElementById('occupantsGrid').innerHTML = pills;
  } catch (err) {
    console.error('Failed to load occupants:', err);
  }
}

// =============================================
// EVENTS
// =============================================
async function loadEvents() {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: AUSTIN_TZ });
    const { data } = await supabase
      .from('event_hosting_requests')
      .select('event_name, event_date, event_start_time, event_end_time')
      .eq('request_status', 'approved')
      .gte('event_date', today)
      .order('event_date')
      .limit(3);

    const section = document.getElementById('eventsSection');
    if (!data || data.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    const rows = data.map(e => {
      const dateObj = new Date(e.event_date + 'T12:00:00');
      const dateLabel = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: AUSTIN_TZ });
      const timeLabel = e.event_start_time
        ? formatTime(e.event_start_time) + (e.event_end_time ? ` - ${formatTime(e.event_end_time)}` : '')
        : '';
      return `<div class="event-row">
        <span class="event-date">${dateLabel}</span>
        <span class="event-name">${escapeHtml(e.event_name || 'Event')}</span>
        ${timeLabel ? `<span class="event-time">${timeLabel}</span>` : ''}
      </div>`;
    }).join('');

    document.getElementById('eventsList').innerHTML = rows;
  } catch (err) {
    console.error('Failed to load events:', err);
  }
}

function formatTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${m} ${ampm}`;
}

// =============================================
// ALPACA FACT
// =============================================
async function loadFact() {
  const el = document.getElementById('factText');

  // 1. Try edge function
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/generate-daily-fact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (resp.ok) {
      const { fact } = await resp.json();
      if (fact) { el.textContent = fact; return; }
    }
  } catch (_) { /* fall through */ }

  // 2. Try most recent fact from DB
  try {
    const { data } = await supabase
      .from('kiosk_facts')
      .select('fact_text')
      .order('generated_date', { ascending: false })
      .limit(1)
      .single();
    if (data?.fact_text) { el.textContent = data.fact_text; return; }
  } catch (_) { /* fall through */ }

  // 3. Use a deterministic fallback based on day of year
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  el.textContent = FALLBACK_FACTS[dayOfYear % FALLBACK_FACTS.length];
}

// =============================================
// GUESTBOOK
// =============================================
async function loadGuestbook() {
  try {
    const { data } = await supabase
      .from('guestbook_entries')
      .select('guest_name, message, created_at')
      .not('message', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5);

    const container = document.getElementById('guestbookEntries');
    if (!data || data.length === 0) {
      container.innerHTML = '<span class="kiosk-empty">No messages yet — be the first!</span>';
      return;
    }

    container.innerHTML = data.map(entry => {
      const ago = timeAgo(new Date(entry.created_at));
      const name = entry.guest_name || 'Anonymous';
      return `<div class="guestbook-entry">
        <div class="guestbook-entry-header">
          <span class="guestbook-entry-name">${escapeHtml(name)}</span>
          <span class="guestbook-entry-time">${ago}</span>
        </div>
        <p class="guestbook-entry-msg">${escapeHtml(entry.message)}</p>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('Failed to load guestbook:', err);
  }
}

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: AUSTIN_TZ });
}

async function submitGuestbookEntry() {
  const nameEl = document.getElementById('guestName');
  const msgEl = document.getElementById('guestMessage');
  const btn = document.getElementById('guestSubmit');
  const message = msgEl.value.trim();

  if (!message) {
    msgEl.placeholder = 'Please write a message first...';
    msgEl.focus();
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const { error } = await supabase
      .from('guestbook_entries')
      .insert({
        guest_name: nameEl.value.trim() || null,
        message,
        entry_type: 'text',
      });

    if (error) throw error;

    nameEl.value = '';
    msgEl.value = '';
    btn.textContent = 'Signed!';
    setTimeout(() => { btn.textContent = 'Sign Guestbook'; btn.disabled = false; }, 2000);
    loadGuestbook();
  } catch (err) {
    console.error('Failed to submit guestbook entry:', err);
    btn.textContent = 'Error — try again';
    setTimeout(() => { btn.textContent = 'Sign Guestbook'; btn.disabled = false; }, 2000);
  }
}

// =============================================
// PAI QUERY COUNT
// =============================================
async function loadPaiCount() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('pai_interactions')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', since);

    const el = document.getElementById('paiCount');
    if (count !== null && count > 0) {
      el.textContent = `${count} AI quer${count === 1 ? 'y' : 'ies'} today`;
    } else {
      el.textContent = '';
    }
  } catch (err) {
    console.error('Failed to load PAI count:', err);
  }
}

// =============================================
// VERSION CHECK + AUTO-RELOAD
// =============================================
async function checkVersion() {
  try {
    const resp = await fetch('/version.json?t=' + Date.now());
    if (!resp.ok) return;
    const data = await resp.json();
    const ver = data.version || data.sha;
    const versionEl = document.querySelector('.kiosk-version');
    if (versionEl) versionEl.textContent = data.version || '';
    if (!currentVersion) {
      currentVersion = ver;
      return;
    }
    if (ver !== currentVersion) {
      console.log('New version detected, reloading...', ver);
      window.location.reload();
    }
  } catch (_) { /* ignore */ }
}

// =============================================
// REFRESH & INIT
// =============================================
async function refreshAll() {
  await Promise.allSettled([
    loadOccupants(),
    loadEvents(),
    loadGuestbook(),
    loadPaiCount(),
  ]);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshAll, POLL_INTERVAL);
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', async () => {
  updateClock();
  setInterval(updateClock, 1000);

  // Load fact once (doesn't change during the day)
  loadFact();

  // Version check + auto-reload every 5 min
  checkVersion();
  setInterval(checkVersion, VERSION_CHECK_INTERVAL);

  // Guestbook submit
  document.getElementById('guestSubmit')?.addEventListener('click', submitGuestbookEntry);

  // Allow Enter in message textarea to submit (Shift+Enter for newline)
  document.getElementById('guestMessage')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitGuestbookEntry();
    }
  });

  // Load dynamic data
  await refreshAll();
  startPolling();

  // Visibility-based polling pause
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(pollTimer);
      pollTimer = null;
    } else {
      refreshAll();
      startPolling();
    }
  });
});
