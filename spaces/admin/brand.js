/**
 * Brand Style Guide Page
 *
 * Loads brand_config from Supabase and renders a comprehensive
 * visual style guide showing colors, logos, typography, visual elements,
 * and email template previews.
 */

import { initAdminShell, showToast } from '../../shared/admin-shell.js';

let supabase;
let brandConfig = null;

// =============================================
// INIT
// =============================================

async function init() {
  const shell = await initAdminShell({ activeTab: 'brand' });
  supabase = shell.supabase;

  await loadBrandConfig();
  renderAll();
}

async function loadBrandConfig() {
  try {
    const { data, error } = await supabase
      .from('brand_config')
      .select('config, updated_at')
      .eq('id', 1)
      .single();

    if (data && !error) {
      brandConfig = data.config;
      const lastUpdated = document.getElementById('lastUpdated');
      if (lastUpdated) {
        lastUpdated.textContent = new Date(data.updated_at).toLocaleString('en-US', {
          timeZone: 'America/Chicago',
          year: 'numeric', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit',
        });
      }
    } else {
      showToast('Could not load brand config from database', 'error');
    }
  } catch (e) {
    console.error('Failed to load brand config:', e);
    showToast('Failed to load brand config', 'error');
  }
}

function renderAll() {
  if (!brandConfig) return;
  renderBrandNames();
  renderLogos();
  renderLogoSizes();
  renderColors('primaryColors', brandConfig.colors?.primary, 'primary');
  renderColors('statusColors', brandConfig.colors?.status, 'status');
  renderColors('semanticColors', brandConfig.colors?.semantic, 'semantic');
  renderTypography();
  renderTypeScale();
  renderFontWeights();
  renderRadiusDemo();
  renderShadowDemo();
  renderButtonDemo();
  renderEmailPreview();
  renderEmailComponents();
  renderRawJson();
}

// =============================================
// BRAND NAMES
// =============================================

function renderBrandNames() {
  const el = document.getElementById('brandNames');
  if (!el) return;
  const b = brandConfig.brand || {};

  const names = [
    { label: 'Primary Name', value: b.primary_name, usage: 'Headers, verbal references, casual contexts' },
    { label: 'Full Name', value: b.full_name, usage: 'Site header/footer, formal email headers' },
    { label: 'Platform Name', value: b.platform_name, usage: 'Login buttons, app references, technical contexts' },
    { label: 'Legal Name', value: b.legal_name, usage: 'Contracts, lease agreements, legal documents' },
    { label: 'Tagline', value: b.tagline, usage: 'Email footers, marketing materials' },
    { label: 'Address', value: b.address, usage: 'Footers, legal documents, contact pages' },
    { label: 'Website', value: b.website, usage: 'All external-facing materials' },
  ];

  el.innerHTML = names.map(n => `
    <div class="brand-name-item">
      <div class="brand-name-label">${n.label}</div>
      <div class="brand-name-value">${n.value || '—'}</div>
      <div class="brand-name-usage">${n.usage}</div>
    </div>
  `).join('');
}

// =============================================
// LOGOS
// =============================================

function renderLogos() {
  const el = document.getElementById('logoGrid');
  if (!el) return;
  const logos = brandConfig.logos || {};
  const base = logos.base_url || '';

  const items = [
    { name: 'Icon (Dark)', file: logos.icon_dark, bg: '#faf9f6', desc: 'Use on light backgrounds' },
    { name: 'Icon (Light)', file: logos.icon_light, bg: '#1c1618', desc: 'Use on dark backgrounds' },
    { name: 'Wordmark (Dark)', file: logos.wordmark_dark, bg: '#faf9f6', desc: 'Use on light backgrounds', wide: true },
    { name: 'Wordmark (Light)', file: logos.wordmark_light, bg: '#1c1618', desc: 'Use on dark backgrounds', wide: true },
  ];

  el.innerHTML = items.map(item => `
    <div class="brand-logo-item${item.wide ? ' brand-logo-item--wide' : ''}">
      <div class="brand-logo-preview" style="background:${item.bg};">
        <img src="${base}/${item.file}" alt="${item.name}" />
      </div>
      <div class="brand-logo-meta">
        <strong>${item.name}</strong>
        <span>${item.desc}</span>
        <code>${item.file}</code>
      </div>
    </div>
  `).join('');
}

function renderLogoSizes() {
  const el = document.getElementById('logoSizes');
  if (!el) return;
  const sizes = brandConfig.logos?.sizes || {};

  el.innerHTML = `
    <table class="brand-table">
      <thead><tr><th>Context</th><th>Size</th></tr></thead>
      <tbody>
        ${Object.entries(sizes).map(([key, val]) => `
          <tr>
            <td>${key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</td>
            <td><code>${val}</code></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

// =============================================
// COLORS
// =============================================

function renderColors(containerId, colors, label) {
  const el = document.getElementById(containerId);
  if (!el || !colors) return;

  el.innerHTML = Object.entries(colors).map(([key, value]) => {
    const isTransparent = String(value).startsWith('rgba');
    const displayColor = value;
    const textColor = isLightColor(value) ? '#2a1f23' : '#faf9f6';

    return `
      <div class="brand-swatch" title="Click to copy">
        <div class="brand-swatch-color" style="background:${displayColor};color:${textColor};" data-color="${value}" onclick="navigator.clipboard.writeText('${value}')">
          <span class="brand-swatch-hex">${value}</span>
        </div>
        <div class="brand-swatch-label">${key.replace(/_/g, ' ')}</div>
      </div>
    `;
  }).join('');
}

function isLightColor(color) {
  if (!color || color.startsWith('rgba')) return true;
  const hex = color.replace('#', '');
  if (hex.length !== 6) return true;
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

// =============================================
// TYPOGRAPHY
// =============================================

function renderTypography() {
  const el = document.getElementById('fontFamily');
  if (!el) return;
  const t = brandConfig.typography || {};

  el.innerHTML = `
    <div class="brand-font-display">
      <div class="brand-font-sample" style="font-family:${t.font_stack || 'DM Sans, sans-serif'};">
        <span style="font-size:3rem;font-weight:700;">Aa</span>
        <span style="font-size:1.5rem;font-weight:400;">The quick brown alpaca jumps over the lazy fence.</span>
      </div>
      <div class="brand-font-meta">
        <div><strong>Family:</strong> <code>${t.font_family || 'DM Sans'}</code></div>
        <div><strong>Stack:</strong> <code>${t.font_stack || ''}</code></div>
        <div><strong>Mono:</strong> <code>${t.font_stack_mono || ''}</code></div>
        <div><strong>Import:</strong> <a href="${t.font_import || '#'}" target="_blank" style="word-break:break-all;">${t.font_import || '—'}</a></div>
      </div>
    </div>
  `;
}

function renderTypeScale() {
  const el = document.getElementById('typeScale');
  if (!el) return;
  const scale = brandConfig.typography?.scale || {};

  el.innerHTML = `
    <div class="brand-type-scale">
      ${Object.entries(scale).map(([key, size]) => `
        <div class="brand-type-row">
          <span class="brand-type-label">${key.toUpperCase()}</span>
          <span class="brand-type-sample" style="font-size:${size};font-weight:${key.startsWith('h') ? '600' : '400'};">The quick brown alpaca</span>
          <code class="brand-type-size">${size}</code>
        </div>
      `).join('')}
    </div>
  `;
}

function renderFontWeights() {
  const el = document.getElementById('fontWeights');
  if (!el) return;
  const weights = brandConfig.typography?.weights || {};

  el.innerHTML = `
    <div class="brand-weights">
      ${Object.entries(weights).map(([key, w]) => `
        <div class="brand-weight-row">
          <span class="brand-weight-sample" style="font-weight:${w};font-size:1.25rem;">Alpaca Playhouse</span>
          <span class="brand-weight-label">${key} (${w})</span>
        </div>
      `).join('')}
    </div>
  `;
}

// =============================================
// VISUAL ELEMENTS
// =============================================

function renderRadiusDemo() {
  const el = document.getElementById('radiusDemo');
  if (!el) return;
  const radii = brandConfig.visual?.border_radius || {};

  el.innerHTML = Object.entries(radii).map(([key, val]) => `
    <div class="brand-radius-item">
      <div class="brand-radius-box" style="border-radius:${val};"></div>
      <div><strong>${key}</strong></div>
      <code>${val}</code>
    </div>
  `).join('');
}

function renderShadowDemo() {
  const el = document.getElementById('shadowDemo');
  if (!el) return;
  const shadows = brandConfig.visual?.shadows || {};

  el.innerHTML = Object.entries(shadows).map(([key, val]) => `
    <div class="brand-shadow-item">
      <div class="brand-shadow-box" style="box-shadow:${val};"></div>
      <div><strong>${key.replace(/_/g, ' ')}</strong></div>
      <code style="font-size:0.7em;word-break:break-all;">${val}</code>
    </div>
  `).join('');
}

function renderButtonDemo() {
  const el = document.getElementById('buttonDemo');
  if (!el) return;
  const btn = brandConfig.email?.button || {};
  const c = brandConfig.colors?.primary || {};

  el.innerHTML = `
    <div class="brand-button-row">
      <div class="brand-button-example">
        <button style="background:${btn.background || '#d4883a'};color:${btn.text_color || '#fff'};border:none;border-radius:${btn.border_radius || '8px'};padding:${btn.padding || '14px 36px'};font-weight:${btn.font_weight || '600'};font-size:16px;cursor:pointer;box-shadow:${btn.shadow || 'none'};font-family:'DM Sans',sans-serif;letter-spacing:0.02em;">Primary Button</button>
        <span class="brand-button-label">Primary / CTA</span>
      </div>
      <div class="brand-button-example">
        <button style="background:transparent;color:${c.text || '#2a1f23'};border:1.5px solid ${c.border || '#e6e2d9'};border-radius:${btn.border_radius || '8px'};padding:12px 24px;font-weight:500;font-size:14px;cursor:pointer;font-family:'DM Sans',sans-serif;">Outline Button</button>
        <span class="brand-button-label">Secondary / Outline</span>
      </div>
      <div class="brand-button-example">
        <button style="background:${c.background_dark || '#1c1618'};color:${c.text_light || '#faf9f6'};border:1.5px solid rgba(255,255,255,0.2);border-radius:${btn.border_radius || '8px'};padding:12px 24px;font-weight:500;font-size:14px;cursor:pointer;font-family:'DM Sans',sans-serif;">Dark Button</button>
        <span class="brand-button-label">Dark variant</span>
      </div>
    </div>
  `;
}

// =============================================
// EMAIL PREVIEW
// =============================================

function renderEmailPreview() {
  const el = document.getElementById('emailPreview');
  if (!el) return;

  const e = brandConfig.email || {};
  const c = brandConfig.colors?.primary || {};
  const logos = brandConfig.logos || {};
  const brand = brandConfig.brand || {};
  const base = logos.base_url || '';
  const iconUrl = `${base}/${logos.icon_light}`;
  const wordmarkUrl = `${base}/${logos.wordmark_light}`;
  const btn = e.button || {};
  const callout = e.callout || {};

  const previewHtml = `
    <div style="background:${c.background_muted || '#f2f0e8'};padding:24px 16px;border-radius:8px;">
      <table cellpadding="0" cellspacing="0" style="max-width:${e.max_width || '600px'};width:100%;margin:0 auto;background:${c.background || '#faf9f6'};border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(42,31,35,0.06);">
        <!-- Header -->
        <tr>
          <td style="background:${e.header?.background || '#1c1618'};padding:${e.header?.padding || '32px'};text-align:center;">
            <table cellpadding="0" cellspacing="0" style="margin:0 auto;">
              <tr>
                <td style="padding-right:12px;vertical-align:middle;">
                  <img src="${iconUrl}" alt="" height="40" style="height:${e.header?.logo_height || '40px'};width:auto;" />
                </td>
                <td style="vertical-align:middle;">
                  <img src="${wordmarkUrl}" alt="${brand.full_name}" height="20" style="height:${e.header?.wordmark_height || '20px'};width:auto;" />
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:${e.body?.padding || '32px'};color:${e.body?.text_color || '#2a1f23'};font-size:16px;line-height:${e.body?.line_height || '1.6'};font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
            <p style="margin:0 0 16px;">Hi there,</p>
            <p style="margin:0 0 16px;">This is an example of the <strong>standard email template</strong> used across all Alpaca Playhouse communications. It demonstrates the branded header, body formatting, components, and footer.</p>

            <!-- Callout -->
            <div style="background:${callout.background || '#f2f0e8'};border:1px solid ${callout.border_color || '#e6e2d9'};border-radius:${callout.border_radius || '8px'};padding:${callout.padding || '20px 24px'};margin:16px 0;">
              <p style="margin:0;font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:${e.body?.text_muted || '#7d6f74'};margin-bottom:8px;">Important Information</p>
              <p style="margin:0;">Callout boxes use the muted background color and border for visual distinction. Use them for key information, instructions, or summaries.</p>
            </div>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" style="margin:24px auto;text-align:center;">
              <tr>
                <td style="background:${btn.background || '#d4883a'};border-radius:${btn.border_radius || '8px'};box-shadow:${btn.shadow || 'none'};">
                  <a href="#" style="display:inline-block;padding:${btn.padding || '14px 36px'};color:${btn.text_color || '#fff'};text-decoration:none;font-weight:${btn.font_weight || '600'};font-size:16px;font-family:'DM Sans',sans-serif;letter-spacing:0.02em;">Call to Action</a>
                </td>
              </tr>
            </table>

            <p style="margin:0;color:${e.body?.text_muted || '#7d6f74'};font-size:13px;text-align:center;">Questions? Just reply to this email.</p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:${e.footer?.background || '#f2f0e8'};padding:${e.footer?.padding || '20px 32px'};text-align:center;border-top:${e.footer?.border_top || '1px solid #e6e2d9'};">
            <p style="margin:0;color:${e.footer?.text_color || '#7d6f74'};font-size:12px;">${brand.address || ''}</p>
            <p style="margin:6px 0 0;color:${e.footer?.text_color || '#7d6f74'};font-size:11px;opacity:0.7;">${brand.platform_name || 'AlpacApps'} &bull; ${brand.tagline || ''}</p>
          </td>
        </tr>
      </table>
    </div>
  `;

  el.innerHTML = previewHtml;
}

function renderEmailComponents() {
  const el = document.getElementById('emailComponents');
  if (!el) return;
  const e = brandConfig.email || {};

  const sections = [
    { label: 'Header', data: e.header },
    { label: 'Body', data: e.body },
    { label: 'Callout Box', data: e.callout },
    { label: 'CTA Button', data: e.button },
    { label: 'Footer', data: e.footer },
  ];

  el.innerHTML = sections.map(s => {
    if (!s.data) return '';
    return `
      <div class="brand-email-component">
        <h4>${s.label}</h4>
        <table class="brand-table brand-table--compact">
          <tbody>
            ${Object.entries(s.data).map(([k, v]) => `
              <tr>
                <td>${k.replace(/_/g, ' ')}</td>
                <td>
                  <code>${v}</code>
                  ${String(v).startsWith('#') ? `<span class="brand-inline-swatch" style="background:${v};"></span>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }).join('');
}

// =============================================
// RAW JSON
// =============================================

function renderRawJson() {
  const el = document.getElementById('rawJson');
  if (!el || !brandConfig) return;
  el.textContent = JSON.stringify(brandConfig, null, 2);
}

// =============================================
// BOOTSTRAP
// =============================================

init().catch(err => {
  console.error('Brand page init failed:', err);
});
