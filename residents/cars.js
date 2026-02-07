/**
 * Cars Page - Tesla Fleet overview
 */

import { initResidentPage, showToast } from '../shared/resident-shell.js';

// =============================================
// SVG ICONS (inline for data rows)
// =============================================
const ICONS = {
  battery: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="18" height="12" rx="2"/><line x1="23" y1="10" x2="23" y2="14"/></svg>',
  odometer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  status: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  climate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>',
  location: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  tires: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="22"/><line x1="2" y1="12" x2="8" y2="12"/><line x1="16" y1="12" x2="22" y2="12"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
};

// Tesla car SVG silhouettes (fallback when images fail to load)
const CAR_SVG = {
  model3: `<svg viewBox="0 0 400 160" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M50 110 C50 110 55 65 90 55 L160 45 C170 43 200 38 240 38 L310 42 C340 48 360 65 365 80 L370 95 C372 100 370 110 365 110" stroke="currentColor" stroke-width="3" fill="none"/>
    <path d="M90 55 C95 50 160 45 160 45" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M160 45 L240 38" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M240 38 C260 40 280 42 310 42" stroke="currentColor" stroke-width="2" fill="none"/>
    <line x1="160" y1="45" x2="155" y2="80" stroke="currentColor" stroke-width="2"/>
    <line x1="240" y1="38" x2="245" y2="80" stroke="currentColor" stroke-width="2"/>
    <circle cx="105" cy="112" r="22" stroke="currentColor" stroke-width="3" fill="none"/>
    <circle cx="105" cy="112" r="12" stroke="currentColor" stroke-width="2" fill="none"/>
    <circle cx="315" cy="112" r="22" stroke="currentColor" stroke-width="3" fill="none"/>
    <circle cx="315" cy="112" r="12" stroke="currentColor" stroke-width="2" fill="none"/>
    <line x1="50" y1="112" x2="83" y2="112" stroke="currentColor" stroke-width="2"/>
    <line x1="127" y1="112" x2="293" y2="112" stroke="currentColor" stroke-width="2"/>
    <line x1="337" y1="112" x2="365" y2="112" stroke="currentColor" stroke-width="2"/>
  </svg>`,
  modelY: `<svg viewBox="0 0 400 160" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M45 115 C45 112 48 70 85 52 L150 40 C165 37 200 33 245 33 L315 38 C345 45 362 65 368 82 L373 98 C375 105 372 115 368 115" stroke="currentColor" stroke-width="3" fill="none"/>
    <path d="M85 52 C90 47 150 40 150 40" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M150 40 L245 33" stroke="currentColor" stroke-width="2" fill="none"/>
    <path d="M245 33 C270 35 290 37 315 38" stroke="currentColor" stroke-width="2" fill="none"/>
    <line x1="150" y1="40" x2="148" y2="82" stroke="currentColor" stroke-width="2"/>
    <line x1="245" y1="33" x2="248" y2="82" stroke="currentColor" stroke-width="2"/>
    <path d="M85 52 C82 58 78 75 76 85" stroke="currentColor" stroke-width="2" fill="none"/>
    <circle cx="105" cy="117" r="23" stroke="currentColor" stroke-width="3" fill="none"/>
    <circle cx="105" cy="117" r="13" stroke="currentColor" stroke-width="2" fill="none"/>
    <circle cx="318" cy="117" r="23" stroke="currentColor" stroke-width="3" fill="none"/>
    <circle cx="318" cy="117" r="13" stroke="currentColor" stroke-width="2" fill="none"/>
    <line x1="45" y1="117" x2="82" y2="117" stroke="currentColor" stroke-width="2"/>
    <line x1="128" y1="117" x2="295" y2="117" stroke="currentColor" stroke-width="2"/>
    <line x1="341" y1="117" x2="368" y2="117" stroke="currentColor" stroke-width="2"/>
  </svg>`,
};

// =============================================
// FLEET DATA
// =============================================
const FLEET = [
  {
    name: 'Casper',
    model: 'Model 3',
    year: 2018,
    color: 'White',
    colorHex: '#f5f5f5',
    svgKey: 'model3',
    svgColor: '#999',
    imageUrl: 'https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/ai-gen/1770443383830-6r0bxc.jpg',
  },
  {
    name: 'Delphi',
    model: 'Model Y',
    year: 2024,
    color: 'White',
    colorHex: '#f5f5f5',
    svgKey: 'modelY',
    svgColor: '#999',
    imageUrl: 'https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/ai-gen/1770443394322-ajaz4j.jpg',
  },
  {
    name: 'Sloop',
    model: 'Model Y',
    year: 2026,
    color: 'Grey',
    colorHex: '#8a8a8a',
    svgKey: 'modelY',
    svgColor: '#777',
    imageUrl: 'https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/ai-gen/1770443406118-zsjutd.jpg',
  },
  {
    name: 'Cygnus',
    model: 'Model Y',
    year: 2026,
    color: 'Grey',
    colorHex: '#8a8a8a',
    svgKey: 'modelY',
    svgColor: '#777',
    imageUrl: 'https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/ai-gen/1770443424118-dxo6h4.jpg',
  },
];

// Data rows to display per car (label, icon key, value — placeholder for now)
const DATA_ROWS = [
  { label: 'Battery', icon: 'battery', value: '--' },
  { label: 'Odometer', icon: 'odometer', value: '--' },
  { label: 'Status', icon: 'status', value: '--' },
  { label: 'Climate', icon: 'climate', value: '--' },
  { label: 'Location', icon: 'location', value: '--' },
  { label: 'Tires', icon: 'tires', value: '--' },
  { label: 'Locked', icon: 'lock', value: '--' },
];

// =============================================
// RENDERING
// =============================================

function renderFleet() {
  const grid = document.getElementById('carGrid');
  if (!grid) return;

  grid.innerHTML = FLEET.map(car => {
    const carSvg = CAR_SVG[car.svgKey] || CAR_SVG.modelY;
    const dataRowsHtml = DATA_ROWS.map(row => `
      <div class="car-data-row">
        <span class="car-data-row__icon">${ICONS[row.icon]}</span>
        <span class="car-data-row__label">${row.label}</span>
        <span class="car-data-row__value">${row.value}</span>
      </div>
    `).join('');

    // Use AI-generated image with SVG fallback
    const imageContent = car.imageUrl
      ? `<img src="${car.imageUrl}" alt="${car.name} - ${car.year} ${car.model}"
             class="car-card__img"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"
         /><div class="car-card__svg-fallback" style="display:none;color:${car.svgColor}">${carSvg}</div>`
      : `<div class="car-card__svg-fallback" style="color:${car.svgColor}">${carSvg}</div>`;

    return `
      <div class="car-card">
        <div class="car-card__image">
          ${imageContent}
        </div>
        <div class="car-card__info">
          <div class="car-card__header">
            <div class="car-card__name">${car.name}</div>
            <span class="car-card__color-chip">
              <span class="car-card__color-dot" style="background:${car.colorHex}"></span>
              ${car.color}
            </span>
          </div>
          <div class="car-card__model">${car.year} ${car.model}</div>
          <div class="car-data-grid">
            ${dataRowsHtml}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// =============================================
// INITIALIZATION
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  await initResidentPage({
    activeTab: 'cars',
    requiredRole: 'resident',
    onReady: async () => {
      renderFleet();
    },
  });
});
