/**
 * Cameras Page - Live camera feed embeds
 */

import { initResidentPage, showToast } from '../shared/resident-shell.js';

// =============================================
// CAMERA CONFIGURATION
// =============================================
const CAMERAS = [
  {
    name: 'Alpacamera',
    location: 'Backyard',
    shareUrl: 'https://monitor.ui.com/910c53f4-bd8a-41a7-b212-5ea9431d9cf9',
  },
  {
    name: 'Front Of House',
    location: 'Front yard',
    shareUrl: 'https://monitor.ui.com/82ddc7f3-aea3-4c34-9dd3-9b2d20786e27',
  },
  {
    name: 'Side Yard',
    location: 'Side yard',
    shareUrl: 'https://monitor.ui.com/cca34fb6-f592-4a3c-b2cf-233432d7f40f',
  },
];

// =============================================
// INITIALIZATION
// =============================================
document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'cameras',
    requiredRole: 'resident',
    onReady: () => {
      renderCameras();
    },
  });
});

// =============================================
// RENDER
// =============================================
function renderCameras() {
  const grid = document.getElementById('cameraGrid');
  if (!grid) return;

  grid.innerHTML = CAMERAS.map(cam => `
    <div class="camera-card">
      <div class="camera-card__label">
        <span class="status-dot"></span>
        <span>${cam.name}</span>
        <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem;margin-left:auto">${cam.location}</span>
      </div>
      <iframe
        src="${cam.shareUrl}"
        allow="autoplay; encrypted-media"
        loading="lazy"
        sandbox="allow-scripts allow-same-origin"
        title="${cam.name} camera feed"
      ></iframe>
    </div>
  `).join('');

  // Test if iframes load — add fallback links if they fail
  setTimeout(() => {
    const iframes = grid.querySelectorAll('iframe');
    iframes.forEach((iframe, i) => {
      iframe.addEventListener('error', () => {
        addFallbackLink(iframe, CAMERAS[i]);
      });
    });
  }, 100);
}

function addFallbackLink(iframe, cam) {
  const fallback = document.createElement('div');
  fallback.className = 'camera-card__fallback';
  fallback.innerHTML = `
    <a href="${cam.shareUrl}" target="_blank" rel="noopener noreferrer">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      Open ${cam.name} feed
    </a>
  `;
  iframe.replaceWith(fallback);
}
