/**
 * Directory Tab Navigation
 * Services remains as a public standalone page.
 * Lighting and Devices have moved to /staff/inventory.html#devices (behind auth).
 */
import { initNavTabList, scrollActiveIntoView } from '../shared/tab-utils.js';

const TABS = [
  { id: 'devices',   label: 'All Devices (Staff)',  href: '/staff/inventory.html#devices' },
  { id: 'services',  label: 'Services',             href: '/directory/services.html' },
];

export function renderDirectoryTabs(containerId = 'directoryTabs') {
  const container = document.getElementById(containerId);
  if (!container) return;

  const path = window.location.pathname;

  container.innerHTML = `<nav class="dir-tabs" role="tablist" aria-label="Directory sections">
    ${TABS.map(tab => {
      const active = path.includes(tab.href.split('/').pop().split('#')[0]);
      return `<a href="${tab.href}" class="dir-tab${active ? ' active' : ''}" role="tab"${active ? ' aria-selected="true" aria-current="page"' : ''}>${tab.label}</a>`;
    }).join('')}
  </nav>`;

  initNavTabList(container.querySelector('.dir-tabs'), 'a');
  scrollActiveIntoView(container.querySelector('.dir-tabs'), '.active');
}
