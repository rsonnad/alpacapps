/**
 * Setup Todo - Checklist for infrastructure and configuration tasks
 */

import { initAdminPage, showToast } from '../../shared/admin-shell.js';

// =============================================
// TODO DATA
// =============================================

const TODO_CATEGORIES = [
  {
    id: 'meta',
    title: 'Meta Business Account',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>',
    items: [
      { id: 'meta-1', title: 'Create Meta Business Account', desc: 'Go to <a href="https://business.facebook.com" target="_blank">business.facebook.com</a> and create a business account for VENTURABLES LLC.', badge: 'critical' },
      { id: 'meta-2', title: 'Verify business identity', desc: 'Submit business verification documents (EIN, D-U-N-S #068507936, business address).', badge: 'critical' },
      { id: 'meta-3', title: 'Create Facebook Page for ALPACA Playhouse', desc: 'Create a business Facebook page linked to the Meta Business account.' },
      { id: 'meta-4', title: 'Create Instagram Business account', desc: 'Link or create an Instagram business profile under the Meta Business account.' },
      { id: 'meta-5', title: 'Set up Meta Pixel (optional)', desc: 'Install Meta Pixel on alpacaplayhouse.com for visitor analytics and ad targeting.', badge: 'nice' },
    ]
  },
  {
    id: 'whatsapp',
    title: 'WhatsApp Business Messaging',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>',
    items: [
      { id: 'wa-1', title: 'Complete Meta Business verification (prerequisite)', desc: 'WhatsApp Business API requires a verified Meta Business account. Complete the Meta Business items first.', badge: 'critical' },
      { id: 'wa-2', title: 'Add WhatsApp to Meta Business Account', desc: 'In <a href="https://business.facebook.com/settings/whatsapp" target="_blank">Meta Business Settings</a> → WhatsApp Accounts → Add WhatsApp Account.' },
      { id: 'wa-3', title: 'Register a phone number for WhatsApp', desc: 'Register a dedicated phone number (can use the Telnyx number +17377474737 or a new one). Number must be able to receive SMS/voice for verification.' },
      { id: 'wa-4', title: 'Set up WhatsApp Cloud API', desc: 'Go to <a href="https://developers.facebook.com" target="_blank">developers.facebook.com</a> → create app → add WhatsApp product → get API token and Phone Number ID.' , badge: 'important' },
      { id: 'wa-5', title: 'Create message templates', desc: 'WhatsApp requires pre-approved templates for business-initiated messages. Create templates for: payment reminders, booking confirmations, maintenance alerts.' , badge: 'important' },
      { id: 'wa-6', title: 'Set up webhook for inbound messages', desc: 'Configure a Supabase edge function to receive incoming WhatsApp messages (similar to Telnyx SMS webhook).' },
      { id: 'wa-7', title: 'Build WhatsApp service module', desc: 'Create <code>shared/whatsapp-service.js</code> mirroring the SMS service pattern for sending templated messages.' },
      { id: 'wa-8', title: 'Test end-to-end messaging', desc: 'Send a test template message and verify inbound message receipt through the webhook.' },
    ]
  },
  {
    id: 'telnyx',
    title: 'Telnyx 10DLC Verification',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    items: [
      { id: 'telnyx-1', title: 'Create brand in Telnyx Compliance portal', desc: 'Go to <a href="https://portal.telnyx.com/#/app/messaging/compliance" target="_blank">Telnyx Compliance</a> → Create Brand → enter VENTURABLES LLC details.', badge: 'critical' },
      { id: 'telnyx-2', title: 'Submit brand for verification', desc: 'Submit the brand with EIN, business address, and contact info. Approval can take days to weeks.' , badge: 'critical' },
      { id: 'telnyx-3', title: 'Create 10DLC Campaign', desc: 'After brand approval, create a campaign. Use case: business notifications / property management alerts.' , badge: 'critical' },
      { id: 'telnyx-4', title: 'Assign phone number to campaign', desc: 'Link phone number +17377474737 to the approved campaign.' , badge: 'important' },
      { id: 'telnyx-5', title: 'Wait for campaign approval', desc: 'Campaign review takes 1-5 business days. SMS will not work for A2P messaging until approved.' , badge: 'blocked' },
      { id: 'telnyx-6', title: 'Test SMS sending after approval', desc: 'Send a test SMS from <a href="https://alpacaplayhouse.com/spaces/admin/settings.html" target="_blank">Settings → SMS</a> to verify 10DLC is working.' },
    ]
  },
  {
    id: 'paypal',
    title: 'PayPal Business Setup',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    items: [
      { id: 'paypal-1', title: 'Create PayPal Business account', desc: 'Go to <a href="https://www.paypal.com/business" target="_blank">paypal.com/business</a> and create an account under VENTURABLES LLC.', badge: 'critical' },
      { id: 'paypal-2', title: 'Get sandbox API credentials', desc: 'Go to <a href="https://developer.paypal.com" target="_blank">developer.paypal.com</a> → create a sandbox app → copy Client ID and Secret.', badge: 'important' },
      { id: 'paypal-3', title: 'Enter sandbox credentials in Settings', desc: 'Go to <a href="https://alpacaplayhouse.com/spaces/admin/settings.html" target="_blank">Settings → PayPal Configuration</a> → paste sandbox Client ID + Secret → Save.', badge: 'important' },
      { id: 'paypal-4', title: 'Test a payout in sandbox mode', desc: 'Go to <a href="https://alpacaplayhouse.com/spaces/admin/worktracking.html" target="_blank">Hours tab</a> → select entries → Mark as Paid → PayPal → Send via PayPal.' },
      { id: 'paypal-5', title: 'Get production API credentials', desc: 'Create a live app on developer.paypal.com and copy production Client ID + Secret.' },
      { id: 'paypal-6', title: 'Switch to production mode', desc: 'Update PayPal config in Settings to use production credentials and disable test mode.' },
    ]
  },
  {
    id: 'raspberry-pi',
    title: 'Raspberry Pi Setup',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
    items: [
      { id: 'rpi-1', title: 'Acquire Raspberry Pi hardware', desc: 'Get a Raspberry Pi (4 or 5) with power supply, SD card, and case.', badge: 'critical' },
      { id: 'rpi-2', title: 'Flash OS and initial setup', desc: 'Flash Raspberry Pi OS to SD card. Configure WiFi (Black Rock City), enable SSH, set hostname.' },
      { id: 'rpi-3', title: 'Install Tailscale on Pi', desc: 'Install Tailscale for mesh VPN access from DO droplet. Join to alpacaplayhouse@gmail.com Tailscale network.' },
      { id: 'rpi-4', title: 'Configure static IP on LAN', desc: 'Set a static IP on 192.168.1.x via DHCP reservation on UDM Pro or Pi config.' },
      { id: 'rpi-5', title: 'Migrate services from Alpaca Mac', desc: 'Move Sonos HTTP API, go2rtc, talkback relay, and Uptime Kuma to the Pi.' , badge: 'important' },
      { id: 'rpi-6', title: 'Set up auto-start services', desc: 'Create systemd services for all migrated applications. Enable on boot.' },
      { id: 'rpi-7', title: 'Test remote access via Tailscale', desc: 'Verify SSH and all services are accessible from DO droplet via Tailscale IP.' },
      { id: 'rpi-8', title: 'Install Chrome Remote Desktop (fallback)', desc: 'Set up a fallback remote access method in case Tailscale goes down.' , badge: 'important' },
    ]
  },
  {
    id: 'sensors',
    title: 'UP-SENSE Smart Sensor Setup',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    items: [
      { id: 'sensor-1', title: 'Inventory all UP-SENSE sensors', desc: 'Count and catalog all UniFi Protect UP-SENSE sensors available for installation.' , badge: 'important' },
      { id: 'sensor-2', title: 'Plan sensor placement per space', desc: 'Decide which spaces get sensors: doors, windows, motion, temperature, humidity, light.' },
      { id: 'sensor-3', title: 'Install sensors in common areas', desc: 'Mount sensors at entry points: front door, garage, side yard gate.' , badge: 'important' },
      { id: 'sensor-4', title: 'Install sensors in individual spaces', desc: 'Mount door/window sensors in each rental space per the <a href="https://alpacaplayhouse.com/residents/sensorinstallation.html" target="_blank">installation guide</a>.' },
      { id: 'sensor-5', title: 'Adopt sensors in UniFi Protect', desc: 'Add each sensor to the UniFi Protect controller on the UDM Pro.' },
      { id: 'sensor-6', title: 'Configure sensor alerts', desc: 'Set up notifications in UniFi Protect for door open/close, motion, and environmental thresholds.' },
      { id: 'sensor-7', title: 'Build sensor dashboard page', desc: 'Create a resident-facing page showing live sensor data (temperature, humidity, door status).', badge: 'nice' },
    ]
  },
  {
    id: 'payments',
    title: 'Payment & Financial Setup',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    items: [
      { id: 'pay-1', title: 'Set up Zelle for VENTURABLES LLC', desc: 'Configure Zelle on the business bank account. Inbound email detection is already built.', badge: 'important' },
      { id: 'pay-2', title: 'Configure Stripe (optional alternative)', desc: 'Set up Stripe as an alternative/backup to Square for card processing.', badge: 'nice' },
      { id: 'pay-3', title: 'Test Square production payments', desc: 'Switch Square from sandbox to production and process a real test charge.' },
      { id: 'pay-4', title: 'Set up accounting categories', desc: 'Define income/expense categories in the <a href="https://alpacaplayhouse.com/spaces/admin/accounting.html" target="_blank">Accounting page</a>.' },
    ]
  },
  {
    id: 'associate',
    title: 'Associate Onboarding',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    items: [
      { id: 'assoc-1', title: 'Create associate invitation flow', desc: 'Invite associates via <a href="https://alpacaplayhouse.com/spaces/admin/users.html" target="_blank">Users page</a> with the associate role.' },
      { id: 'assoc-2', title: 'Test identity verification end-to-end', desc: 'Have an associate upload their DL via the secure upload link and verify Claude Vision processes it.' },
      { id: 'assoc-3', title: 'Configure hourly rates per associate', desc: 'Set up hourly rates in associate profiles from the <a href="https://alpacaplayhouse.com/spaces/admin/worktracking.html" target="_blank">Hours admin page</a>.' },
      { id: 'assoc-4', title: 'Test clock in/out on mobile', desc: 'Verify the associate work tracking page works on mobile with GPS capture.' },
      { id: 'assoc-5', title: 'Test full payout cycle', desc: 'Clock in → work → clock out → admin approves → payout via PayPal → associate receives funds.' },
    ]
  },
  {
    id: 'infra',
    title: 'Infrastructure & DevOps',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    items: [
      { id: 'infra-1', title: 'Install Chrome Remote Desktop on Alpaca Mac', desc: 'Critical fallback for remote access. Tailscale has failed before and left us locked out.', badge: 'critical' },
      { id: 'infra-2', title: 'Delete stale Tailscale device', desc: 'Remove old <code>alpacaopenmac</code> (100.110.178.14) from <a href="https://login.tailscale.com/admin/machines" target="_blank">Tailscale admin</a>.', badge: 'important' },
      { id: 'infra-3', title: 'Replace Alpaca Mac battery', desc: 'MacBook Pro battery at 698 cycles, "Service Recommended". Short UPS window on power loss.', badge: 'important' },
      { id: 'infra-4', title: 'Set up Uptime Kuma monitors', desc: 'Configure monitors at <a href="http://100.102.122.65:3001" target="_blank">Uptime Kuma</a> for all critical services (edge functions, cameras, Sonos, etc.).' },
      { id: 'infra-5', title: 'Configure error digest notifications', desc: 'Verify daily error digest emails are being sent to admin. Check <a href="https://alpacaplayhouse.com/spaces/admin/settings.html" target="_blank">Settings</a>.' },
      { id: 'infra-6', title: 'Set up automated backups', desc: 'Configure regular Supabase database backups (free tier has automatic daily backups).', badge: 'nice' },
    ]
  },
  {
    id: 'homeauto',
    title: 'Home Automation Pending',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    items: [
      { id: 'home-1', title: 'Get Garage Mahal TV discovered', desc: 'Configure the Garage Mahal TV to be discovered and controllable via the home automation system.', badge: 'important' },
      { id: 'home-2', title: 'Build thermostat rules engine', desc: 'Implement automated thermostat control using the <code>thermostat_rules</code> table (schema exists, logic pending).' , badge: 'nice' },
      { id: 'home-3', title: 'Implement laundry QR codes (Phase 5-6)', desc: 'Generate QR codes for washer/dryer → deep link to auto-subscribe for cycle-end notifications.' , badge: 'nice' },
      { id: 'home-4', title: 'Build herd@ email AI handler', desc: 'Implement AI processing logic for emails sent to herd@alpacaplayhouse.com (currently a stub).' , badge: 'nice' },
      { id: 'home-5', title: 'Build sensor data dashboard', desc: 'Create a resident page showing live UP-SENSE sensor data (temp, humidity, doors).', badge: 'nice' },
    ]
  },
];

// =============================================
// STATE
// =============================================

const STORAGE_KEY = 'alpacapps_setup_todo';
let checkedItems = {};

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    checkedItems = saved ? JSON.parse(saved) : {};
  } catch {
    checkedItems = {};
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(checkedItems));
}

// =============================================
// RENDERING
// =============================================

function getStats() {
  let total = 0, done = 0;
  for (const cat of TODO_CATEGORIES) {
    for (const item of cat.items) {
      total++;
      if (checkedItems[item.id]) done++;
    }
  }
  return { total, done, remaining: total - done };
}

function getCategoryStats(cat) {
  let total = 0, done = 0;
  for (const item of cat.items) {
    total++;
    if (checkedItems[item.id]) done++;
  }
  return { total, done };
}

function renderSummary() {
  const { total, done, remaining } = getStats();
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  document.getElementById('todoSummary').innerHTML = `
    <div class="todo-summary-stat">
      <span class="todo-summary-value total">${total}</span>
      <span class="todo-summary-label">Total Tasks</span>
    </div>
    <div class="todo-summary-stat">
      <span class="todo-summary-value done">${done}</span>
      <span class="todo-summary-label">Completed</span>
    </div>
    <div class="todo-summary-stat">
      <span class="todo-summary-value remaining">${remaining}</span>
      <span class="todo-summary-label">Remaining</span>
    </div>
    <div class="todo-summary-stat">
      <span class="todo-summary-value" style="color:${pct === 100 ? 'var(--success)' : 'var(--text)'}">${pct}%</span>
      <span class="todo-summary-label">Progress</span>
    </div>
  `;

  document.getElementById('todoProgressFill').style.width = `${pct}%`;
}

function renderCategories() {
  const container = document.getElementById('todoContainer');
  container.innerHTML = TODO_CATEGORIES.map(cat => {
    const stats = getCategoryStats(cat);
    const allDone = stats.done === stats.total;
    const collapsed = allDone ? ' collapsed' : '';

    return `
      <div class="todo-category${collapsed}" data-cat="${cat.id}">
        <div class="todo-category-header" onclick="this.parentElement.classList.toggle('collapsed')">
          ${cat.icon}
          <h2>${cat.title}</h2>
          <span class="todo-category-progress">
            <span class="${allDone ? 'done' : ''}">${stats.done}/${stats.total}</span>
          </span>
          <svg class="todo-category-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="todo-items">
          ${cat.items.map(item => renderItem(item)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderItem(item) {
  const checked = checkedItems[item.id];
  const badgeHtml = item.badge ? `<span class="todo-badge ${item.badge}">${item.badge}</span>` : '';

  return `
    <div class="todo-item${checked ? ' checked' : ''}">
      <input type="checkbox" class="todo-checkbox" data-id="${item.id}" ${checked ? 'checked' : ''}>
      <div class="todo-item-content">
        <div class="todo-item-title">${item.title}</div>
        ${item.desc ? `<div class="todo-item-desc">${item.desc}</div>` : ''}
      </div>
      ${badgeHtml}
    </div>
  `;
}

function render() {
  renderSummary();
  renderCategories();
}

// =============================================
// EVENT HANDLERS
// =============================================

function handleCheckboxChange(e) {
  if (!e.target.classList.contains('todo-checkbox')) return;
  const id = e.target.dataset.id;
  if (e.target.checked) {
    checkedItems[id] = true;
  } else {
    delete checkedItems[id];
  }
  saveState();
  render();
}

function handleResetAll() {
  if (!confirm('Reset all checkboxes? This will uncheck everything.')) return;
  checkedItems = {};
  saveState();
  render();
  showToast('All tasks reset', 'info');
}

// =============================================
// INITIALIZATION
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  await initAdminPage({
    activeTab: 'todo',
    requiredRole: 'staff',
    section: 'staff',
    onReady: async () => {
      loadState();
      render();

      document.getElementById('todoContainer').addEventListener('change', handleCheckboxChange);
      document.getElementById('resetAllBtn').addEventListener('click', handleResetAll);
    }
  });
});
