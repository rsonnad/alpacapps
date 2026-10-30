/**
 * Resident/Device Tab Definitions - Shared tab config for Devices and Residents.
 * Extracted from resident-shell.js so lightweight pages (e.g. /intranet/) can
 * import the tab list without pulling in the whole shell.
 */

import { DEVICE_PERMISSION_KEYS } from './context-switcher.js';
import { ROUTES } from './routes.js';

// Compact SVG icons for tabs (16x16, stroke-based)
const _i = (d) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const TAB_ICONS = {
  list:       _i('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>'),
  homeauto:   _i('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0018 8 6 6 0 006 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 018.91 14"/>'),
  music:      _i('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  cameras:    _i('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>'),
  climate:    _i('<path d="M14 14.76V3.5a2.5 2.5 0 00-5 0v11.26a4.5 4.5 0 105 0z"/>'),
  appliances: _i('<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="6" x2="12.01" y2="6"/>'),
  cars:       _i('<path d="M5 17h14v-3l2-4H3l2 4v3z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/><path d="M5 10l1.5-4h11L19 10"/>'),
  sensors:    _i('<path d="M2 12C2 6.48 6.48 2 12 2s10 4.48 10 10"/><path d="M7 12a5 5 0 015-5"/><circle cx="12" cy="12" r="1"/>'),
  printer3d:  _i('<rect x="4" y="3" width="16" height="4" rx="1"/><path d="M7 7v7a5 5 0 0010 0V7"/><rect x="9" y="14" width="6" height="7" rx="1"/>'),
  profile:    _i('<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  bookkeeping:_i('<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>'),
  media:      _i('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>'),
  askpai:     _i('<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>'),
  'my-access':_i('<path d="M7 11V7a5 5 0 0110 0v4"/><rect x="3" y="11" width="18" height="11" rx="2"/><circle cx="12" cy="16" r="1"/>'),
};

// Hrefs are absolute paths sourced from ./routes.js. To move a page,
// edit /shared/routes.js — every tab here picks up the change.
export const DEVICE_SUBTABS = [
  { id: 'list',       label: 'List',       href: ROUTES.devices.list,       permissionsAny: DEVICE_PERMISSION_KEYS },
  { id: 'homeauto',   label: 'Lighting',   href: ROUTES.devices.lighting,   permission: 'view_lighting', feature: 'lighting' },
  { id: 'music',      label: 'Music',      href: ROUTES.devices.music,      permission: 'view_music',    feature: 'music' },
  { id: 'cameras',    label: 'Cameras',    href: ROUTES.devices.cameras,    permission: 'view_cameras',  feature: 'cameras' },
  { id: 'climate',    label: 'Climate',    href: ROUTES.devices.climate,    permission: 'view_climate',  feature: 'climate' },
  { id: 'appliances', label: 'Appliances', href: ROUTES.devices.appliances, permission: 'view_laundry',  feature: 'oven' },
  { id: 'cars',       label: 'Cars',       href: ROUTES.devices.cars,       permission: 'view_cars',     feature: 'vehicles' },
  { id: 'sensors',    label: 'Sensors',    href: ROUTES.devices.sensors,    permission: 'view_cameras',  feature: 'cameras' },
  { id: 'printer3d',  label: '3D Printer', href: ROUTES.devices.printer,    permission: 'view_printer',  feature: 'printer_3d' },
];

// my-access.html stays in /residents/ — not yet in ROUTES (legacy page; add when moved).
export const RESIDENT_CORE_TABS = [
  { id: 'profile',     label: 'Profile',     href: ROUTES.residents.profile,     permission: 'view_profile' },
  { id: 'my-access',   label: 'My Access',   href: '/residents/my-access.html',  permission: 'view_profile' },
  { id: 'bookkeeping', label: 'Bookkeeping', href: ROUTES.residents.bookkeeping, permission: 'view_profile' },
  { id: 'media',       label: 'Imagery',     href: ROUTES.residents.media,       permission: 'view_profile' },
  { id: 'askpai',      label: 'Ask PAI',     href: ROUTES.residents.askPai,      permission: 'view_profile', feature: 'pai' },
];

export const RESIDENT_STAFF_TABS = [
  { id: 'profile',     label: 'Profile',     href: ROUTES.residents.profile,     permission: 'view_profile' },
  { id: 'my-access',   label: 'My Access',   href: '/residents/my-access.html',  permission: 'view_profile' },
  { id: 'bookkeeping', label: 'Bookkeeping', href: ROUTES.residents.bookkeeping, permission: 'view_profile' },
  { id: 'media',       label: 'Imagery',     href: ROUTES.residents.media,       permission: 'view_profile' },
  { id: 'askpai',      label: 'Ask PAI',     href: ROUTES.residents.askPai,      permission: 'view_profile', feature: 'pai' },
];
