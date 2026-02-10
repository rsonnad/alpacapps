/**
 * Devices Page - Hub of device categories with links to Cameras, Lighting, Music, etc.
 * Only shows cards for categories the user has permission to access.
 */

import { initResidentPage } from '../shared/resident-shell.js';

const DEVICE_CATEGORIES = [
  { id: 'cameras', label: 'Cameras', href: 'cameras.html', permission: 'view_cameras', description: 'Live feeds, PTZ, talkback' },
  { id: 'lighting', label: 'Lighting', href: 'lighting.html', permission: 'view_lighting', description: 'Govee lights, groups, scenes' },
  { id: 'music', label: 'Music', href: 'sonos.html', permission: 'view_music', description: 'Sonos zones, playback, volume' },
  { id: 'climate', label: 'Climate', href: 'climate.html', permission: 'view_climate', description: 'Nest thermostats, weather' },
  { id: 'laundry', label: 'Laundry', href: 'laundry.html', permission: 'view_laundry', description: 'Washer & dryer status' },
  { id: 'cars', label: 'Cars', href: 'cars.html', permission: 'view_cars', description: 'Tesla vehicles, lock, flash' },
];

const ICONS = {
  cameras: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  lighting: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21h6M12 3a6 6 0 00-4 10.5V17h8v-3.5A6 6 0 0012 3z"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
  climate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z"/></svg>',
  laundry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>',
  cars: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 17h14M7.5 17a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM16.5 17a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/><path d="M5 12l1.5-4.5h11L19 12"/></svg>',
};

document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'devices',
    requiredRole: 'resident',
    onReady: (state) => {
      renderDeviceCards(state);
    },
  });
});

function renderDeviceCards(state) {
  const grid = document.getElementById('devicesGrid');
  if (!grid) return;

  const allowed = DEVICE_CATEGORIES.filter(cat => state.hasPermission?.(cat.permission));
  if (allowed.length === 0) {
    grid.innerHTML = '<p class="text-muted" style="padding:1rem;">No device categories available for your account.</p>';
    return;
  }

  grid.innerHTML = allowed.map(cat => `
    <a href="${cat.href}" class="device-card" data-device="${cat.id}">
      <span class="device-card__icon">${ICONS[cat.id] || ''}</span>
      <div class="device-card__body">
        <span class="device-card__label">${cat.label}</span>
        ${cat.description ? `<span class="device-card__desc">${cat.description}</span>` : ''}
      </div>
      <span class="device-card__arrow" aria-hidden="true">→</span>
    </a>
  `).join('');
}
