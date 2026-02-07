/**
 * Cars Page - Tesla Fleet overview
 */

import { initResidentPage, showToast } from '../shared/resident-shell.js';

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
    icon: 'cars/model3-white.png',
  },
  {
    name: 'Delphi',
    model: 'Model Y',
    year: 2024,
    color: 'White',
    colorHex: '#f5f5f5',
    icon: 'cars/modely-white.png',
  },
  {
    name: 'Sloop',
    model: 'Model Y',
    year: 2026,
    color: 'Grey',
    colorHex: '#8a8a8a',
    icon: 'cars/modely-grey.png',
  },
  {
    name: 'Cygnus',
    model: 'Model Y',
    year: 2026,
    color: 'Grey',
    colorHex: '#8a8a8a',
    icon: 'cars/modely-grey.png',
  },
];

// =============================================
// RENDERING
// =============================================

function renderFleet() {
  const grid = document.getElementById('carGrid');
  if (!grid) return;

  grid.innerHTML = FLEET.map(car => {
    const imgSrc = car.icon;
    return `
      <div class="car-card">
        <div class="car-card__image">
          <img src="${imgSrc}" alt="${car.name}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
          <div class="car-card__placeholder" style="display:none;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48">
              <path d="M5 17h1a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H5"/>
              <path d="M19 17h-1a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1"/>
              <rect x="3" y="7" width="18" height="10" rx="2"/>
              <circle cx="7.5" cy="17" r="2.5"/>
              <circle cx="16.5" cy="17" r="2.5"/>
            </svg>
          </div>
        </div>
        <div class="car-card__info">
          <div class="car-card__name">${car.name}</div>
          <div class="car-card__details">
            <span class="car-card__model">${car.year} ${car.model}</span>
            <span class="car-card__color-chip">
              <span class="car-card__color-dot" style="background:${car.colorHex}"></span>
              ${car.color}
            </span>
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
