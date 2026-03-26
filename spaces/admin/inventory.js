import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';

let authState = null;
let activeSubtab = 'dashboard';
const loadedTabs = new Set();

// ── Helpers ──
function esc(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }
function badge(text, color = 'gray') { return `<span class="inv-badge inv-badge-${color}">${esc(text)}</span>`; }

function detailsBlock(title, meta, bodyHtml) {
  return `<details class="inv-details">
    <summary>${esc(title)}<span class="inv-summary-meta">${meta}</span></summary>
    <div class="inv-details-body">${bodyHtml}</div>
  </details>`;
}

function tableHtml(headers, rows) {
  return `<div class="inv-table-wrap"><table class="inv-table">
    <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>`;
}

// ══════════════════════════════════════════════════════════════
// STATIC DATA ARRAYS
// ══════════════════════════════════════════════════════════════

const INFRASTRUCTURE = [
  {
    name: 'Alpuca Mac Mini M4',
    meta: '192.168.1.200 · M4 · 24 GB RAM',
    body: `<p>Primary host machine running all local services, VMs, cron jobs, and file syncs. Serves as the on-premise hub connecting cloud services to physical devices.</p>
      <dl>
        <dt>SSH</dt><dd><code>ssh paca@192.168.1.200</code></dd>
        <dt>OS</dt><dd>macOS (Apple Silicon)</dd>
        <dt>Key Roles</dt><dd>Home Assistant VM host, rclone sync, media processing (ffmpeg), Docker (Colima), Cloudflare Tunnel endpoint, all LaunchAgent services</dd>
        <dt>Logs</dt><dd><code>/Users/alpuca/logs/</code> — finleg-backup, alpacapps-backup, gdrive-sync, up-sense-monitor</dd>
      </dl>`
  },
  {
    name: 'UniFi Dream Machine Pro',
    meta: '192.168.1.1 · 8 cameras',
    body: `<p>Network gateway and security camera NVR. Runs UniFi Protect with 8 cameras for property surveillance. Firmware 5.0.12.</p>
      <dl>
        <dt>Web UI</dt><dd><code>https://192.168.1.1/</code></dd>
        <dt>Cameras</dt><dd>8 UniFi Protect cameras (outdoor and indoor coverage)</dd>
        <dt>Access</dt><dd>UDM Tunnel LaunchAgent proxies Protect API for remote access</dd>
      </dl>`
  },
  {
    name: 'Home Assistant OS (HAOS)',
    meta: '192.168.1.39:8123 · QEMU VM',
    body: `<p>Central smart home automation hub running as a QEMU virtual machine on the Alpuca Mac. Manages WiZ bulbs, Sonos, Cast devices, TP-Link switches, and Music Assistant.</p>
      <dl>
        <dt>Web UI</dt><dd><code>http://192.168.1.39:8123</code></dd>
        <dt>Version</dt><dd>HAOS 17.1</dd>
        <dt>Auto-start</dt><dd>LaunchDaemon: <code>com.alpacapps.homeassistant-vm.plist</code></dd>
        <dt>Start Script</dt><dd><code>~/homeassistant-vm/start-ha.sh</code></dd>
        <dt>Integrations</dt><dd>WiZ, Sonos, Google Cast, TP-Link Kasa, HP Printer, Music Assistant</dd>
      </dl>`
  },
  {
    name: 'RVAULT20 External Drive',
    meta: 'USB · Backup + Sync Storage',
    body: `<p>External storage drive mounted at <code>/Volumes/RVAULT20/</code>. Houses all Google Drive syncs, Google Takeout exports, Tesla cam footage, and weekly repo backups.</p>
      <dl>
        <dt>Mount Point</dt><dd><code>/Volumes/RVAULT20/</code></dd>
        <dt>Key Folders</dt>
        <dd>
          <code>googledrivesync-rahulioson/</code> — Rahul's GDrive (~5.5 GB, syncs every 4h)<br>
          <code>googledrivesync-tesloop/</code> — TesLoop GDrive (~512 MB, Sundays 3am)<br>
          <code>GoogleTakeout/</code> — Photos takeout exports<br>
          <code>TESLACAM/</code> — Tesla dashcam footage<br>
          <code>backups/</code> — Weekly repo backups<br>
          <code>Terraformer/</code> — Infrastructure configs
        </dd>
      </dl>`
  },
  {
    name: 'Hostinger VPS',
    meta: '93.188.164.224 · Batch Processing',
    body: `<p>Remote virtual private server used for background workers and batch processing that don't need to run locally.</p>
      <dl>
        <dt>IP</dt><dd>93.188.164.224</dd>
        <dt>Runs</dt><dd>Bug Scout, Feature Builder, PAI Discord bot</dd>
      </dl>`
  }
];

const DATA_ASSETS = [
  {
    name: 'Google Drive — rahulioson@gmail.com',
    meta: badge('Syncing', 'green') + ' ~5.5 GB',
    body: `<p>Personal Google Drive synced to RVAULT20 via rclone every 4 hours. Contains documents, spreadsheets, and project files.</p>
      <dl>
        <dt>Local Path</dt><dd><code>/Volumes/RVAULT20/googledrivesync-rahulioson/</code></dd>
        <dt>Sync Schedule</dt><dd>Every 4 hours at :07 — <code>sync-gdrive-to-rvault.sh rahulioson</code></dd>
        <dt>rclone Remote</dt><dd><code>gdrive-rahulioson:</code></dd>
      </dl>`
  },
  {
    name: 'Google Drive — tesloop@gmail.com',
    meta: badge('Syncing', 'green') + ' ~512 MB',
    body: `<p>TesLoop company Google Drive synced weekly. Contains historical business documents and operational files.</p>
      <dl>
        <dt>Local Path</dt><dd><code>/Volumes/RVAULT20/googledrivesync-tesloop/</code></dd>
        <dt>Sync Schedule</dt><dd>Sundays 3:07 AM — <code>sync-gdrive-to-rvault.sh tesloop</code></dd>
        <dt>rclone Remote</dt><dd><code>gdrive-tesloop:</code></dd>
      </dl>`
  },
  {
    name: 'Google Photos — rahulioson@gmail.com',
    meta: badge('Complete', 'blue') + ' via Takeout',
    body: `<p>Full photo library exported via Google Takeout. Downloaded and stored on RVAULT20.</p>
      <dl><dt>Location</dt><dd><code>/Volumes/RVAULT20/GoogleTakeout/</code></dd></dl>`
  },
  {
    name: 'Google Photos — tesloop@gmail.com',
    meta: badge('Missing', 'red') + ' Takeout expired',
    body: `<p>Takeout was initiated March 17 but download links expired March 23 before completion. Needs a new takeout request from the TesLoop Google account.</p>
      <dl><dt>Action Required</dt><dd>Re-request Google Takeout from tesloop@gmail.com (Photos only)</dd></dl>`
  },
  {
    name: 'Tesla Dashcam Footage',
    meta: 'RVAULT20',
    body: `<p>Tesla vehicle dashcam recordings archived on external storage. Last batch from November 2024.</p>
      <dl><dt>Location</dt><dd><code>/Volumes/RVAULT20/TESLACAM/</code></dd></dl>`
  },
  {
    name: 'Supabase Database',
    meta: badge('Live', 'green') + ' 70+ tables',
    body: `<p>Primary cloud database (PostgreSQL) hosting all application data. Includes core entities, payments, smart home configs, AI prompts, and audit trails.</p>
      <dl>
        <dt>Project</dt><dd><code>aphrrfprbixmhissnjfn</code> — us-east-1</dd>
        <dt>Table Groups</dt><dd>Core (spaces, people, assignments), Payments (ledger, payments), Comms (SMS, email), Smart Home (govee, nest, tesla, lg, anova), AI (prompts, image_gen_jobs), Admin (bug_reports, audit_log)</dd>
      </dl>`
  },
  {
    name: 'Cloudflare R2 Storage',
    meta: badge('Active', 'blue'),
    body: `<p>Object storage for documents, lease agreements, and uploaded files. Configured via <code>r2_config</code> Supabase table.</p>`
  },
  {
    name: 'Weekly Repo Backups',
    meta: badge('Automated', 'green'),
    body: `<p>Automated weekly backups of code repositories to RVAULT20.</p>
      <dl>
        <dt>finleg</dt><dd>Sundays 5:00 AM → <code>/Volumes/RVAULT20/backups/</code></dd>
        <dt>alpacapps</dt><dd>Mondays 1:00 AM → <code>/Volumes/RVAULT20/backups/</code></dd>
      </dl>`
  }
];

const SOFTWARE = [
  { name: 'rclone', desc: 'Cloud file synchronization — syncs Google Drive accounts to RVAULT20 on schedule.', tags: ['sync', 'backup'], where: 'Alpuca Mac (Homebrew)' },
  { name: 'ffmpeg', desc: 'Media processing — video transcoding, thumbnail generation, audio extraction for property media and dashcam footage.', tags: ['media', 'video', 'audio'], where: 'Alpuca Mac (Homebrew)' },
  { name: 'Node.js v20', desc: 'JavaScript runtime for all local services (Sonos HTTP API, WiZ Proxy, File Search, etc.) and development tooling.', tags: ['runtime', 'services'], where: 'Alpuca Mac (Homebrew, nvm)' },
  { name: 'Python 3.12 / 3.14', desc: 'Used for utility scripts including UPSense monitor, automation helpers, and data processing.', tags: ['runtime', 'scripts'], where: 'Alpuca Mac (Homebrew)' },
  { name: 'Colima + Docker', desc: 'Lightweight Docker runtime on macOS via Lima VMs. Used for containerized services.', tags: ['containers', 'infra'], where: 'Alpuca Mac (Homebrew)' },
  { name: 'QEMU', desc: 'Virtual machine hypervisor running the Home Assistant OS VM.', tags: ['vm', 'infra'], where: 'Alpuca Mac (Homebrew)' },
  { name: 'cloudflared', desc: 'Cloudflare Tunnel client — exposes local services (Sonos API, WiZ Proxy, HAOS) to the internet securely without port forwarding.', tags: ['tunnel', 'infra'], where: 'Alpuca Mac (Homebrew)' },
  { name: 'Tailwind CSS v4', desc: 'Utility-first CSS framework used across all AlpacApps pages. Custom <code>aap-*</code> design tokens defined in config. Run <code>npm run css:build</code> after adding new classes.', tags: ['frontend', 'css'], where: 'alpacapps repo (npm)' },
  { name: 'Capacitor 8', desc: 'Cross-platform mobile app framework. Wraps AlpacApps web UI into native iOS and Android apps with camera feeds, Sonos control, and device management.', tags: ['mobile', 'ios', 'android'], where: 'alpacapps/mobile/' },
  { name: 'Supabase CLI', desc: 'Local development, migrations, and edge function deployment for the Supabase backend.', tags: ['database', 'deploy'], where: 'Alpuca Mac (npm)' },
  { name: 'gh (GitHub CLI)', desc: 'GitHub command-line tool for PR management, releases, and CI/CD interaction.', tags: ['git', 'deploy'], where: 'Alpuca Mac (Homebrew)' },
  { name: 'jq', desc: 'JSON query tool used in shell scripts for parsing API responses and config files.', tags: ['utility'], where: 'Alpuca Mac (Homebrew)' },
];

const SERVICES_AGENTS = [
  { name: 'Sonos HTTP API', plist: 'com.sonos.httpapi', port: 5005, desc: 'RESTful API for controlling Sonos speakers — play, pause, volume, grouping, favorites.' },
  { name: 'WiZ Proxy', plist: 'com.alpacapps.wiz-proxy', port: 8902, desc: 'HTTP proxy for WiZ smart bulb UDP protocol — enables cloud control of local bulbs.' },
  { name: 'Music Assistant', plist: 'com.music-assistant.server', port: 8095, desc: 'Music library aggregator integrating Spotify, YouTube Music, and local files through HAOS.' },
  { name: 'File Search API', plist: 'com.alpacapps.file-search-api', port: null, desc: 'Full-text search service for property documents and files.' },
  { name: 'PTZ Proxy', plist: 'com.alpacapps.ptz-proxy', port: null, desc: 'Pan-tilt-zoom camera control proxy for PTZ-capable UniFi cameras.' },
  { name: 'UDM Tunnel', plist: 'com.alpacapps.udm-tunnel', port: null, desc: 'Reverse tunnel to UniFi Dream Machine Protect API for remote camera access.' },
  { name: 'Cloudflare Tunnel', plist: 'com.cloudflare.tunnel', port: null, desc: 'Secure tunnel exposing local services to the internet without port forwarding.' },
  { name: 'Colima (Docker)', plist: 'com.alpacapps.colima', port: null, desc: 'Lightweight Docker runtime on macOS — manages containerized services.' },
  { name: 'MediaMTX', plist: 'com.mediamtx', port: null, desc: 'RTSP/HLS media streaming server — restreams camera feeds for web playback.' },
  { name: 'go2rtc', plist: 'com.go2rtc', port: null, desc: 'Camera stream proxy — converts RTSP to WebRTC/HLS for browser-based camera viewing.' },
  { name: 'Blink Poller', plist: 'com.blink-poller', port: null, desc: 'Polls Blink camera API for motion events and stores clips.' },
  { name: 'PAI Wallpaper Rotator', plist: 'com.alpuca.pai-wallpaper-rotate', port: null, desc: 'Rotates AI-generated wallpapers on the Alpuca Mac desktop.' },
  { name: 'Printer Proxy', plist: 'com.printer-proxy', port: null, desc: 'HTTP proxy for FlashForge 3D printer TCP protocol.' },
  { name: 'PO Token Server', plist: 'com.po-token-server', port: null, desc: 'Token generation server for YouTube playback authentication.' },
  { name: 'Home Assistant VM', plist: 'com.alpacapps.homeassistant-vm (daemon)', port: null, desc: 'Auto-starts the HAOS QEMU VM on boot via LaunchDaemon.' },
];

const CRON_JOBS = [
  { schedule: '0:30 AM daily', cmd: 'nightly-cleanup.sh', desc: 'Nightly cleanup of temp files and stale data.' },
  { schedule: 'Sun 5:00 AM', cmd: 'backup-finleg-to-rvault.sh', desc: 'Weekly backup of finleg repository to RVAULT20.' },
  { schedule: 'Every 2 hours', cmd: 'up-sense-monitor.py', desc: 'UPS power monitoring — checks battery status and logs events.' },
  { schedule: 'Mon 1:00 AM', cmd: 'backup-alpacapps-to-rvault.sh', desc: 'Weekly backup of alpacapps repository to RVAULT20.' },
  { schedule: 'Every 4h at :07', cmd: 'sync-gdrive-to-rvault.sh rahulioson', desc: 'Syncs rahulioson Google Drive to RVAULT20.' },
  { schedule: 'Sun 3:07 AM', cmd: 'sync-gdrive-to-rvault.sh tesloop', desc: 'Syncs tesloop Google Drive to RVAULT20.' },
];

const CLOUD_SERVICES = {
  'Platform & Hosting': [
    { name: 'Supabase', desc: 'Database, Auth, Edge Functions, Storage — primary backend', badge: badge('Core', 'green') },
    { name: 'GitHub + Pages', desc: 'Code hosting, CI/CD via Actions, static site deployment', badge: badge('Core', 'green') },
    { name: 'Cloudflare', desc: 'DNS management, R2 object storage, Tunnel for local services', badge: badge('Core', 'green') },
    { name: 'DigitalOcean', desc: 'Droplet VPS for background workers (Bug Scout, PAI Discord)', badge: badge('Active', 'blue') },
  ],
  'Payments': [
    { name: 'Stripe', desc: 'Primary payment processor — ACH (0.8% capped $5), cards (2.9% + $0.30), Connect for associate payouts', badge: badge('Active', 'green') },
    { name: 'Square', desc: 'Backup payment processing (2.6% + $0.10)', badge: badge('Active', 'green') },
    { name: 'PayPal', desc: 'Associate payouts ($0.25 per payout)', badge: badge('Active', 'green') },
  ],
  'Communications': [
    { name: 'Resend', desc: 'Transactional email (100/day free) — notifications, branded templates, inbound webhook', badge: badge('Active', 'green') },
    { name: 'Telnyx', desc: 'SMS sending/receiving for property notifications', badge: badge('Active', 'green') },
    { name: 'SignWell', desc: 'E-signature platform for rental agreements and legal documents', badge: badge('Active', 'blue') },
    { name: 'Vapi', desc: 'Voice AI assistant — PAI phone interface for concierge calls', badge: badge('Active', 'blue') },
  ],
  'AI & Data': [
    { name: 'Gemini', desc: 'Image generation, PAI chat, payment matching, identity verification (Vision)', badge: badge('Active', 'green') },
    { name: 'Brave Search', desc: 'Web search API for PAI knowledge retrieval', badge: badge('Active', 'blue') },
    { name: 'OpenWeatherMap', desc: 'Weather forecasts for property dashboard', badge: badge('Active', 'blue') },
  ],
  'Device APIs': [
    { name: 'Google SDM API', desc: 'Nest thermostat control via OAuth (3 devices)', badge: badge('Active', 'green') },
    { name: 'Tesla Fleet API', desc: 'Vehicle data, commands (lock, unlock, flash, honk) for 5 vehicles', badge: badge('Active', 'green') },
    { name: 'LG ThinQ API', desc: 'Washer/dryer monitoring and control', badge: badge('Active', 'blue') },
    { name: 'Govee Cloud API', desc: 'RGB lighting control (57 devices)', badge: badge('Active', 'green') },
    { name: 'Anova Developer API', desc: 'Precision oven control via WebSocket', badge: badge('Active', 'blue') },
    { name: 'Glowforge Cloud API', desc: 'Laser cutter status monitoring (undocumented API)', badge: badge('Passive', 'gray') },
    { name: 'FlashForge TCP API', desc: '3D printer control via local TCP proxy', badge: badge('Active', 'blue') },
  ],
};

const DEVICES = {
  'Lighting — 91 devices': [
    { name: 'WiZ RGB Tunable Bulbs', count: 26, desc: 'WiFi-connected smart bulbs across all rooms + outdoor. Controlled via WiZ Proxy (port 8902) and Home Assistant.' },
    { name: 'Govee Lights', count: 57, desc: '16 light bars + 41 AiDot/OREIN. Groups: Garage Mahal (17), Spartan (14), Outhouse (6), fence/string lights. Cloud API controlled.' },
    { name: 'TP-Link Smart Switches', count: 3, desc: 'KL135 (Cabin 1, .180), HS220 Dimmer (Nook, .101), HS210 (Stair Landing, .230). Local Kasa protocol via HAOS.' },
    { name: 'OREIN Matter Bulbs', count: 5, desc: 'Master Bathroom. Currently blocked in HAOS — need Matter bridge setup.' },
  ],
  'Climate — 3 devices': [
    { name: 'Nest Thermostat — Kitchen', count: 1, desc: 'IP: 192.168.1.139. Google SDM API with OAuth token refresh.' },
    { name: 'Nest Thermostat — Master Bedroom', count: 1, desc: 'IP: 192.168.1.111' },
    { name: 'Nest Thermostat — Skyloft', count: 1, desc: 'IP: 192.168.1.249' },
  ],
  'Audio — 9+ speakers': [
    { name: 'Sonos Speakers', count: 9, desc: 'Zones: Living Sound, Kitchen, Skyloft Sound, DJ Room, Dining Sound, Office, Bedroom, TV Room, Bathroom. Garage Outdoors, Outhouse, Front Outside Sound. Controlled via Sonos HTTP API (port 5005) + HAOS.' },
    { name: 'WiiM Speaker (Spartan)', count: 1, desc: 'LinkPlay compatible speaker in Spartan room.' },
  ],
  'Cameras — 11 devices': [
    { name: 'UniFi Protect Cameras', count: 8, desc: 'On UDM Pro NVR. RTSP streams proxied via go2rtc/MediaMTX for web viewing.' },
    { name: 'Blink Cameras', count: 3, desc: 'Wireless battery cameras. Polled by blink-poller daemon for motion events.' },
  ],
  'Vehicles — 5 Teslas': [
    { name: 'Tesla Fleet', count: 5, desc: 'Monitored by tesla-poller daemon (every 2 hours). Commands: lock, unlock, wake, flash, honk via Tesla Fleet API edge function.' },
  ],
  'Appliances': [
    { name: 'LG Washer/Dryer', count: 2, desc: 'ThinQ API integration with cycle monitoring and laundry_watchers table for notifications.' },
    { name: 'Anova Precision Oven', count: 1, desc: 'WebSocket API for cook start/stop and temperature monitoring.' },
    { name: 'Glowforge Laser Cutter', count: 1, desc: 'Status-only monitoring via undocumented cloud API.' },
    { name: 'FlashForge 3D Printer', count: 1, desc: 'TCP protocol via printer-proxy LaunchAgent.' },
    { name: 'HP ENVY Photo 7800', count: 1, desc: 'Network printer with ink level monitoring via HAOS.' },
  ],
};

const REPOS = [
  {
    name: 'alpacapps',
    desc: 'Main property management platform — admin, resident portal, payment, smart home control, AI assistant (PAI)',
    tech: 'Vanilla HTML/JS + Tailwind v4 + Supabase + GitHub Pages + Capacitor 8',
    stats: '103 dirs · 66 edge functions · 49 shared modules · 36 migrations',
    url: 'https://github.com/rsonnad/alpacapps',
    live: 'https://alpacaplayhouse.com/',
  },
  {
    name: 'finleg',
    desc: 'Financial and legal document management — QuickBooks integration, flow migration automation',
    tech: 'Next.js 16 + React 19 + Tailwind + Supabase + AWS S3',
    stats: 'Hosted on Hostinger VPS',
    url: 'https://github.com/rsonnad/finleg',
  },
  {
    name: 'sponic-garden',
    desc: 'Horticulture and growing project management',
    tech: 'Next.js + Supabase',
    stats: '264 subdirs in branding',
    url: 'https://github.com/rsonnad/sponic-garden',
  },
  {
    name: 'AlpacApps Mobile',
    desc: 'Native iOS + Android app wrapping the web platform with camera feeds, music control, lights, climate, and vehicle tabs',
    tech: 'Capacitor 8 + Vanilla JS',
    stats: 'Located at alpacapps/mobile/',
  },
];

const EDGE_FUNCTION_GROUPS = {
  'Payments (14)': ['process-stripe-payment', 'stripe-payout', 'stripe-webhook', 'stripe-connect-onboard', 'stripe-connect-link', 'process-square-payment', 'square-webhook', 'refund-square-payment', 'paypal-payout', 'paypal-webhook', 'record-payment', 'resolve-payment', 'confirm-deposit-payment', 'event-payment-reminder'],
  'Communications (8)': ['send-email', 'send-sms', 'send-whatsapp', 'resend-inbound-webhook', 'telnyx-webhook', 'approve-email', 'edit-email-template', 'reprocess-pai-email'],
  'Smart Home (12)': ['sonos-control', 'govee-control', 'nest-control', 'nest-token-refresh', 'tesla-command', 'lg-control', 'anova-control', 'glowforge-control', 'printer-control', 'home-assistant-control', 'alexa-room-control', 'gemini-weather'],
  'AI & Documents (6)': ['alpaca-pai', 'verify-identity', 'ask-question', 'vapi-server', 'vapi-webhook', 'error-report'],
  'Account & Auth (3)': ['create-tesla-account', 'stripe-connect-onboard', 'stripe-connect-link'],
  'Scheduling & Sync (7)': ['ical', 'regenerate-ical', 'airbnb-sync', 'generate-daily-fact', 'generate-1099-data', 'weekly-payroll-summary', 'weekly-schedule-report'],
  'Utility (8)': ['api', 'release-info', 'share-space', 'contact-form', 'guestbook-upload', 'w9-submit', 'lesson-nav', 'audit-email-compliance'],
};

const DB_TABLE_GROUPS = {
  'Core Entities': ['spaces', 'people', 'assignments', 'assignment_spaces', 'media', 'media_spaces', 'media_tags', 'media_tag_assignments', 'app_users', 'user_invitations', 'rental_applications', 'documents', 'document_index'],
  'Payments & Accounting': ['payments', 'ledger_entries', 'api_usage_log', 'square_config', 'stripe_config', 'signwell_config', 'payment_methods', 'pending_payments'],
  'Communications': ['sms_messages', 'telnyx_config', 'inbound_emails', 'pending_email_approvals', 'email_type_approval_config', 'email_templates'],
  'Smart Home': ['govee_config', 'govee_devices', 'govee_models', 'nest_config', 'nest_devices', 'thermostat_rules', 'tesla_accounts', 'vehicles', 'vehicle_drivers', 'vehicle_rentals', 'lg_config', 'lg_appliances', 'push_tokens', 'laundry_watchers', 'anova_config', 'anova_ovens', 'glowforge_config', 'glowforge_machines', 'printer_config', 'printer_devices', 'camera_streams'],
  'Audio & Media': ['sonos_config', 'sonos_schedules', 'sonos_zones', 'spotify_config'],
  'Property Config': ['brand_config', 'config', 'weather_config', 'r2_config'],
  'AI & Automation': ['prompts', 'image_gen_jobs', 'faq_entries', 'pai_config', 'life_of_pai_backstory', 'pai_email_classifications'],
  'Events': ['events', 'event_applications', 'event_templates', 'event_agreements'],
  'Documents & Legal': ['lease_templates', 'worktrade_templates'],
  'Admin & Audit': ['bug_reports', 'feature_requests', 'work_entries', 'password_vault', 'audit_log'],
};

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  authState = await initAdminPage({
    activeTab: 'inventory',
    requiredRole: 'staff',
    section: 'staff',
    onReady: async () => {
      initSubtabs();
    }
  });
});

// ── Subtab routing ──
function initSubtabs() {
  const hash = location.hash.replace('#', '');
  if (hash && document.getElementById(`inv-panel-${hash}`)) activeSubtab = hash;

  document.querySelectorAll('.inv-subtab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      switchSubtab(btn.dataset.tab);
    });
  });
  switchSubtab(activeSubtab);
}

function switchSubtab(tab) {
  activeSubtab = tab;
  location.hash = tab === 'dashboard' ? '' : tab;

  document.querySelectorAll('.inv-subtab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  document.querySelectorAll('.inv-panel').forEach(p => {
    p.style.display = p.id === `inv-panel-${tab}` ? '' : 'none';
  });

  if (!loadedTabs.has(tab)) {
    loadedTabs.add(tab);
    const loaders = {
      dashboard: loadDashboard,
      infrastructure: loadInfrastructure,
      data: loadData,
      software: loadSoftware,
      services: loadServices,
      cloud: loadCloud,
      devices: loadDevices,
      codebase: loadCodebase,
    };
    loaders[tab]?.();
  }
}

// ══════════════════════════════════════════════════════════════
// TAB LOADERS
// ══════════════════════════════════════════════════════════════

async function loadDashboard() {
  // Fetch live Supabase table count
  try {
    const tables = ['spaces', 'people', 'assignments', 'payments', 'media', 'events', 'sms_messages', 'bug_reports'];
    const results = await Promise.all(
      tables.map(t => supabase.from(t).select('*', { count: 'exact', head: true }).then(r => ({ table: t, count: r.count ?? '?' })).catch(() => ({ table: t, count: '?' })))
    );
    const total = results.reduce((s, r) => s + (typeof r.count === 'number' ? r.count : 0), 0);
    const el = document.getElementById('statTables');
    if (el) el.textContent = `70+ (${total.toLocaleString()} rows)`;
  } catch (e) {
    console.error('Dashboard stats error:', e);
  }
}

function loadInfrastructure() {
  const el = document.getElementById('infraContent');
  el.innerHTML = INFRASTRUCTURE.map(i => detailsBlock(i.name, i.meta, i.body)).join('');
}

function loadData() {
  const el = document.getElementById('dataContent');
  el.innerHTML = DATA_ASSETS.map(d => detailsBlock(d.name, d.meta, d.body)).join('');
}

function loadSoftware() {
  const el = document.getElementById('softwareContent');
  el.innerHTML = `<div class="inv-card-grid">${SOFTWARE.map(s => `
    <div class="inv-card">
      <h4>${esc(s.name)}</h4>
      <div class="inv-card-sub">${esc(s.where)}</div>
      <p>${s.desc}</p>
      <div>${s.tags.map(t => `<span class="inv-tag">${esc(t)}</span>`).join('')}</div>
    </div>
  `).join('')}</div>`;
}

function loadServices() {
  const el = document.getElementById('servicesContent');

  const agentRows = SERVICES_AGENTS.map(s => [
    `<strong>${esc(s.name)}</strong>`,
    s.port ? `<code>${s.port}</code>` : '<span style="color:#9ca3af">—</span>',
    `<code style="font-size:0.7rem">${esc(s.plist)}</code>`,
    esc(s.desc),
  ]);

  const cronRows = CRON_JOBS.map(c => [
    `<strong>${esc(c.schedule)}</strong>`,
    `<code>${esc(c.cmd)}</code>`,
    esc(c.desc),
  ]);

  el.innerHTML = `
    <div class="inv-section">
      <h3 class="inv-section-title">LaunchAgents <span class="inv-badge inv-badge-blue">${SERVICES_AGENTS.length}</span></h3>
      <p class="inv-section-sub">Background services that auto-start on boot via macOS LaunchAgents/LaunchDaemons.</p>
      ${tableHtml(['Service', 'Port', 'Plist', 'Description'], agentRows)}
    </div>
    <div class="inv-section" style="margin-top: 2rem;">
      <h3 class="inv-section-title">Cron Jobs <span class="inv-badge inv-badge-blue">${CRON_JOBS.length}</span></h3>
      <p class="inv-section-sub">Scheduled tasks running via crontab on the Alpuca Mac.</p>
      ${tableHtml(['Schedule', 'Command', 'Description'], cronRows)}
    </div>

    <div class="inv-section" style="margin-top: 2rem;">
      <h3 class="inv-section-title">Supabase pg_cron</h3>
      <p class="inv-section-sub">Server-side scheduled jobs running inside the Supabase PostgreSQL database.</p>
      ${tableHtml(['Schedule', 'Job', 'Description'], [
        ['Every 5 min', '<code>sonos-schedule-runner</code>', 'Checks and executes Sonos music schedules'],
        ['Scheduled', '<code>nest-token-refresh</code>', 'Refreshes Google SDM OAuth tokens before expiry'],
        ['Daily', '<code>event-payment-reminder</code>', 'Sends payment reminders for upcoming events'],
      ])}
    </div>
  `;
}

function loadCloud() {
  const el = document.getElementById('cloudContent');
  el.innerHTML = Object.entries(CLOUD_SERVICES).map(([group, items]) => `
    <div class="inv-section">
      <h3 class="inv-section-title">${esc(group)}</h3>
      ${tableHtml(['Service', 'Description', 'Status'], items.map(i => [
        `<strong>${esc(i.name)}</strong>`,
        esc(i.desc),
        i.badge,
      ]))}
    </div>
  `).join('');
}

function loadDevices() {
  const el = document.getElementById('devicesContent');
  el.innerHTML = Object.entries(DEVICES).map(([group, items]) => {
    const totalCount = items.reduce((s, i) => s + i.count, 0);
    return `<details class="inv-details" open>
      <summary>${esc(group)} <span class="inv-summary-meta">${totalCount} total</span></summary>
      <div class="inv-details-body">
        ${tableHtml(['Device', 'Count', 'Description'], items.map(i => [
          `<strong>${esc(i.name)}</strong>`,
          String(i.count),
          esc(i.desc),
        ]))}
      </div>
    </details>`;
  }).join('');
}

function loadCodebase() {
  const el = document.getElementById('codebaseContent');

  const repoCards = REPOS.map(r => `
    <div class="inv-card">
      <h4>${esc(r.name)} ${r.url ? `<a href="${r.url}" target="_blank" style="font-size:0.75rem;color:var(--accent,#b8a88a)">GitHub</a>` : ''}</h4>
      <div class="inv-card-sub">${esc(r.tech)}</div>
      <p>${esc(r.desc)}</p>
      <p style="margin-top:0.5rem;font-size:0.75rem;color:#6b7280">${esc(r.stats)}</p>
      ${r.live ? `<p style="margin-top:0.25rem"><a href="${r.live}" target="_blank" style="font-size:0.75rem;color:var(--accent,#b8a88a)">${r.live}</a></p>` : ''}
    </div>
  `).join('');

  const fnSection = Object.entries(EDGE_FUNCTION_GROUPS).map(([group, fns]) =>
    detailsBlock(group, `${fns.length} functions`, `<p>${fns.map(f => `<code style="font-size:0.75rem;margin:0.125rem;display:inline-block;padding:0.125rem 0.375rem;background:#f3f4f6;border-radius:4px">${esc(f)}</code>`).join(' ')}</p>`)
  ).join('');

  const dbSection = Object.entries(DB_TABLE_GROUPS).map(([group, tables]) =>
    detailsBlock(group, `${tables.length} tables`, `<p>${tables.map(t => `<code style="font-size:0.75rem;margin:0.125rem;display:inline-block;padding:0.125rem 0.375rem;background:#f3f4f6;border-radius:4px">${esc(t)}</code>`).join(' ')}</p>`)
  ).join('');

  el.innerHTML = `
    <div class="inv-section">
      <h3 class="inv-section-title">Repositories</h3>
      <div class="inv-card-grid">${repoCards}</div>
    </div>
    <div class="inv-section">
      <h3 class="inv-section-title">Edge Functions <span class="inv-badge inv-badge-blue">66</span></h3>
      <p class="inv-section-sub">Supabase Deno edge functions organized by domain.</p>
      ${fnSection}
    </div>
    <div class="inv-section">
      <h3 class="inv-section-title">Database Tables <span class="inv-badge inv-badge-blue">70+</span></h3>
      <p class="inv-section-sub">Supabase PostgreSQL tables grouped by domain.</p>
      ${dbSection}
    </div>
  `;
}
