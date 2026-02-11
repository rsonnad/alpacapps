/**
 * Sensors Page — UP-SENSE environment sensor list.
 * Queries protect_sensors table and renders sensor cards.
 * Currently shows an empty state until sensors are installed.
 */

import { initResidentPage } from '../shared/resident-shell.js';
import { supabase } from '../shared/supabase.js';

document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'sensors',
    requiredRole: 'resident',
    onReady: () => {
      loadSensors();
    },
  });
});

async function loadSensors() {
  const grid = document.getElementById('sensorsGrid');
  const empty = document.getElementById('sensorsEmpty');
  const meta = document.getElementById('sensorsMeta');

  // Try to load from protect_sensors table
  try {
    const { data: sensors, error } = await supabase
      .from('protect_sensors')
      .select('*')
      .eq('is_active', true)
      .order('display_order');

    if (error) {
      console.warn('Sensors fetch error:', error);
      // Table may not exist yet — show empty state
      if (grid) grid.innerHTML = '';
      if (empty) empty.style.display = '';
      if (meta) meta.textContent = '0 sensors';
      return;
    }

    if (!sensors || sensors.length === 0) {
      if (grid) grid.innerHTML = '';
      if (empty) empty.style.display = '';
      if (meta) meta.textContent = '0 sensors';
      return;
    }

    // Sensors found — hide empty state, render cards
    if (empty) empty.style.display = 'none';
    if (meta) meta.textContent = `${sensors.length} sensor${sensors.length !== 1 ? 's' : ''}`;
    if (grid) grid.innerHTML = sensors.map(renderSensorCard).join('');

  } catch (e) {
    console.warn('Sensors load failed:', e);
    if (grid) grid.innerHTML = '';
    if (empty) empty.style.display = '';
    if (meta) meta.textContent = '0 sensors';
  }
}

function renderSensorCard(sensor) {
  const name = escapeHtml(sensor.name || 'Unnamed Sensor');
  const location = escapeHtml(sensor.location || '');
  const mountType = escapeHtml(sensor.mount_type || '');

  return `
    <div class="sensor-card" style="background:var(--bg-card);border-radius:var(--radius-lg,12px);padding:1.25rem;border:1px solid rgba(0,0,0,0.04);box-shadow:var(--shadow);">
      <div style="font-weight:600;margin-bottom:0.25rem;">${name}</div>
      ${location ? `<div style="font-size:0.85rem;color:var(--text-muted);">${location}</div>` : ''}
      ${mountType ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.25rem;">Type: ${mountType}</div>` : ''}
    </div>
  `;
}

function escapeHtml(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
