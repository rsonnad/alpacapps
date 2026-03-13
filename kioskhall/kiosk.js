/**
 * Kiosk Display - Hallway Tablet
 * No auth required. Polls data every 60s.
 * Weather cached for 10 minutes to stay within OWM rate limits.
 */

import { supabase, SUPABASE_URL } from '../shared/supabase.js';

const POLL_INTERVAL = 60_000;        // 60s data refresh
const WEATHER_CACHE_MS = 600_000;    // 10 min weather cache
const AUSTIN_TZ = 'America/Chicago';

let weatherCache = null;
let weatherCacheTime = 0;
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

    // Filter to current occupants (today is between start and end)
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

    // Check if "new" (arrived in last 7 days)
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
// WEATHER
// =============================================
async function loadWeather() {
  try {
    // Use cache if fresh
    if (weatherCache && (Date.now() - weatherCacheTime) < WEATHER_CACHE_MS) {
      renderWeather(weatherCache);
      return;
    }

    const { data: config } = await supabase
      .from('weather_config')
      .select('owm_api_key, latitude, longitude, location_name, is_active')
      .single();

    if (!config?.is_active || !config?.owm_api_key) {
      document.getElementById('weatherSummary').innerHTML =
        '<span class="kiosk-empty">Weather not configured</span>';
      return;
    }

    // Try One Call 3.0, fallback to 2.5
    let weather = null;
    try {
      const url30 = `https://api.openweathermap.org/data/3.0/onecall?lat=${config.latitude}&lon=${config.longitude}&exclude=minutely,daily,alerts&units=imperial&appid=${config.owm_api_key}`;
      const resp = await fetch(url30);
      if (resp.ok) {
        const d = await resp.json();
        weather = {
          temp: Math.round(d.current.temp),
          desc: d.current.weather?.[0]?.description || '',
          icon: d.current.weather?.[0]?.icon || '01d',
          humidity: d.current.humidity,
          feelsLike: Math.round(d.current.feels_like),
        };
      }
    } catch (_) { /* fallback */ }

    if (!weather) {
      const url25 = `https://api.openweathermap.org/data/2.5/weather?lat=${config.latitude}&lon=${config.longitude}&units=imperial&appid=${config.owm_api_key}`;
      const resp = await fetch(url25);
      if (resp.ok) {
        const d = await resp.json();
        weather = {
          temp: Math.round(d.main.temp),
          desc: d.weather?.[0]?.description || '',
          icon: d.weather?.[0]?.icon || '01d',
          humidity: d.main.humidity,
          feelsLike: Math.round(d.main.feels_like),
        };
      }
    }

    if (weather) {
      weatherCache = weather;
      weatherCacheTime = Date.now();
      renderWeather(weather);
    }
  } catch (err) {
    console.error('Failed to load weather:', err);
  }
}

function renderWeather(w) {
  const capitalize = s => s.replace(/\b\w/g, c => c.toUpperCase());
  document.getElementById('weatherSummary').innerHTML = `
    <img class="weather-icon" src="https://openweathermap.org/img/wn/${w.icon}@2x.png" alt="${w.desc}">
    <span class="weather-temp">${w.temp}\u00B0</span>
    <span class="weather-desc">${capitalize(w.desc)}</span>
    <span class="weather-detail">Feels ${w.feelsLike}\u00B0 \u2022 ${w.humidity}% humidity</span>
  `;
}

// =============================================
// ALPACA FACT
// =============================================
async function loadFact() {
  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/generate-daily-fact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { fact } = await resp.json();
    if (fact) {
      document.getElementById('factText').textContent = fact;
    }
  } catch (err) {
    console.error('Failed to load fact:', err);
    // Try cached fact from DB directly
    try {
      const today = new Date().toLocaleDateString('en-CA', { timeZone: AUSTIN_TZ });
      const { data } = await supabase
        .from('kiosk_facts')
        .select('fact_text')
        .eq('generated_date', today)
        .single();
      if (data?.fact_text) {
        document.getElementById('factText').textContent = data.fact_text;
      }
    } catch (_) {}
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
// REFRESH & INIT
// =============================================
async function refreshAll() {
  await Promise.allSettled([
    loadOccupants(),
    loadEvents(),
    loadWeather(),
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
