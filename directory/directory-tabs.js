/**
 * Directory Tab Navigation
 * Renders a tab bar connecting Lighting, All Devices, and Services pages.
 * Uses initNavTabList() from tab-utils for ARIA compliance.
 */
import { initNavTabList, scrollActiveIntoView } from '../shared/tab-utils.js';

const TABS = [
  { id: 'lighting',  label: 'Lighting',    href: '/directory/lightingdevices.html' },
  { id: 'devices',   label: 'All Devices', href: '/directory/devices.html' },
  { id: 'services',  label: 'Services',    href: '/directory/services.html' },
];

export function renderDirectoryTabs(containerId = 'directoryTabs') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const path = window.location.pathname;

  container.innerHTML = `<nav class="dir-tabs" role="tablist" aria-label="Directory sections">
    ${TABS.map(tab => {
      const active = path.includes(tab.href.split('/').pop());
      return `<a href="${tab.href}" class="dir-tab${active ? ' active' : ''}" role="tab"${active ? ' aria-selected="true" aria-current="page"' : ''}>${tab.label}</a>`;
    }).join('')}
  </nav>`;

  initNavTabList(container.querySelector('.dir-tabs'), 'a');
  scrollActiveIntoView(container.querySelector('.dir-tabs'), '.active');
}
