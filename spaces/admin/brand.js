/**
 * Brand Style Guide Page
 *
 * Loads brand_config from Supabase and renders a comprehensive
 * visual style guide showing colors, logos, typography, visual elements,
 * and email template previews.
 */

import { supabase } from '../../shared/supabase.js';
import { initAdminPage, showToast } from '../../shared/admin-shell.js';

let authState = null;
let brandConfig = null;

// =============================================
// INIT
// =============================================

document.addEventListener('DOMContentLoaded', async () => {
  authState = await initAdminPage({
    activeTab: 'brand',
    requiredRole: 'admin',
    section: 'admin',
    onReady: async () => {
      await loadBrandConfig();
      renderAll();
    },
  });
});

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
  renderContrastPairings();
  renderTypography();
  renderTypeScale();
  renderFontWeights();
  renderTypeSpecimen();
  renderRadiusDemo();
  renderShadowDemo();
  renderButtonDemo();
  renderEmailPreview();
  renderEmailComponents();
  renderComponentPlayground();
  renderEmailAnatomy();
  renderEmailDesignGuide();
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

function renderColors(containerId, colors, _label) {
  const el = document.getElementById(containerId);
  if (!el || !colors) return;

  el.innerHTML = Object.entries(colors).map(([key, value]) => {
    const textColor = isLightColor(value) ? '#2a1f23' : '#faf9f6';

    return `
      <div class="brand-swatch" title="Click to copy" onclick="navigator.clipboard.writeText('${value}')">
        <div class="brand-swatch-color" style="background:${value};color:${textColor};" data-color="${value}">
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
// CONTRAST PAIRINGS
// =============================================

function getRelativeLuminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const srgb = [r, g, b].map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function getContrastRatio(hex1, hex2) {
  const l1 = getRelativeLuminance(hex1);
  const l2 = getRelativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return ((lighter + 0.05) / (darker + 0.05)).toFixed(1);
}

function renderContrastPairings() {
  const el = document.getElementById('contrastPairings');
  if (!el) return;
  const c = brandConfig.colors?.primary || {};

  const pairings = [
    { text: c.text || '#2a1f23', bg: c.background || '#faf9f6', label: 'Dark text on cream' },
    { text: c.text_light || '#faf9f6', bg: c.background_dark || '#1c1618', label: 'Light text on dark' },
    { text: c.text_muted || '#7d6f74', bg: c.background || '#faf9f6', label: 'Muted text on cream' },
    { text: c.accent || '#d4883a', bg: c.background || '#faf9f6', label: 'Accent on cream' },
    { text: c.text || '#2a1f23', bg: c.background_muted || '#f2f0e8', label: 'Dark text on muted' },
    { text: '#ffffff', bg: c.accent || '#d4883a', label: 'White on accent (buttons)' },
  ];

  el.innerHTML = `<div class="brand-contrast-grid">${pairings.map(p => {
    const ratio = getContrastRatio(p.text, p.bg);
    const pass = ratio >= 4.5;
    const aaa = ratio >= 7;
    const badge = aaa ? 'AAA' : pass ? 'AA' : 'Fail';
    const badgeClass = aaa ? 'brand-contrast-badge--aaa' : pass ? 'brand-contrast-badge--aa' : 'brand-contrast-badge--fail';

    return `
      <div class="brand-contrast-pair">
        <div class="brand-contrast-preview" style="background:${p.bg};color:${p.text};border:1px solid ${c.border || '#e6e2d9'};">
          <span style="font-size:1.25rem;font-weight:600;">Aa</span>
          <span style="font-size:0.875rem;">The quick brown alpaca</span>
        </div>
        <div class="brand-contrast-meta">
          <span class="brand-contrast-label">${p.label}</span>
          <span class="brand-contrast-badge ${badgeClass}">${badge} ${ratio}:1</span>
        </div>
      </div>`;
  }).join('')}</div>`;
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
// TYPE SPECIMEN
// =============================================

function renderTypeSpecimen() {
  const el = document.getElementById('typeSpecimen');
  if (!el) return;
  const t = brandConfig.typography || {};
  const c = brandConfig.colors?.primary || {};
  const font = t.font_stack || "'DM Sans', sans-serif";

  el.innerHTML = `
    <div class="brand-specimen" style="font-family:${font};">
      <div class="brand-specimen-block" style="background:${c.background || '#faf9f6'};color:${c.text || '#2a1f23'};border:1px solid ${c.border || '#e6e2d9'};border-radius:12px;padding:2rem;margin-bottom:1rem;">
        <h2 style="font-size:1.75rem;font-weight:700;margin:0 0 0.25rem;color:${c.text || '#2a1f23'};">Welcome to Alpaca Playhouse</h2>
        <p style="font-size:0.875rem;color:${c.text_muted || '#7d6f74'};margin:0 0 1rem;font-weight:400;">Where we redefine your idea of what an Alpaca Playhouse can be.</p>
        <p style="font-size:1rem;line-height:1.6;margin:0 0 0.75rem;font-weight:400;">Our property features <strong>six unique living spaces</strong>, each designed with a distinct personality. From the minimalist <em>Spartan Suite</em> to the luxurious <em>Garage Mahal</em>, there's a perfect fit for everyone.</p>
        <p style="font-size:0.875rem;line-height:1.55;color:${c.text_muted || '#7d6f74'};margin:0;">Amenities include high-speed WiFi, smart home controls, a maker space with laser cutter, and our famous alpaca herd on 5 acres of Texas hill country.</p>
      </div>
      <div class="brand-specimen-block" style="background:${c.background_dark || '#1c1618'};color:${c.text_light || '#faf9f6'};border-radius:12px;padding:2rem;">
        <h2 style="font-size:1.75rem;font-weight:700;margin:0 0 0.25rem;">Welcome to Alpaca Playhouse</h2>
        <p style="font-size:0.875rem;opacity:0.7;margin:0 0 1rem;font-weight:400;">Where we redefine your idea of what an Alpaca Playhouse can be.</p>
        <p style="font-size:1rem;line-height:1.6;margin:0 0 0.75rem;font-weight:400;">Our property features <strong>six unique living spaces</strong>, each designed with a distinct personality. From the minimalist <em>Spartan Suite</em> to the luxurious <em>Garage Mahal</em>, there's a perfect fit for everyone.</p>
        <p style="font-size:0.875rem;line-height:1.55;opacity:0.6;margin:0;">Amenities include high-speed WiFi, smart home controls, a maker space with laser cutter, and our famous alpaca herd on 5 acres of Texas hill country.</p>
      </div>
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
// COMPONENT PLAYGROUND
// =============================================

function renderComponentPlayground() {
  const el = document.getElementById('componentPlayground');
  if (!el) return;
  const e = brandConfig.email || {};
  const c = brandConfig.colors?.primary || {};
  const btn = e.button || {};
  const callout = e.callout || {};
  const font = brandConfig.typography?.font_stack || "'DM Sans', sans-serif";

  el.innerHTML = `
    <div class="brand-playground">
      <!-- CTA Buttons -->
      <div class="brand-playground-section">
        <h4>CTA Buttons</h4>
        <p class="brand-hint" style="margin-bottom:12px;">Generated by <code>emailButton(text, url)</code> in the brand wrapper.</p>
        <div style="background:${c.background || '#faf9f6'};border:1px solid ${c.border || '#e6e2d9'};border-radius:8px;padding:24px;text-align:center;">
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 16px;text-align:center;">
            <tr>
              <td style="background:${btn.background || '#d4883a'};border-radius:${btn.border_radius || '8px'};box-shadow:${btn.shadow || 'none'};">
                <a href="#" onclick="return false" style="display:inline-block;padding:${btn.padding || '14px 36px'};color:${btn.text_color || '#fff'};text-decoration:none;font-weight:${btn.font_weight || '600'};font-size:16px;font-family:${font};letter-spacing:0.02em;">View Your Space</a>
              </td>
            </tr>
          </table>
          <table cellpadding="0" cellspacing="0" style="margin:0 auto;text-align:center;">
            <tr>
              <td style="background:${btn.background || '#d4883a'};border-radius:${btn.border_radius || '8px'};box-shadow:${btn.shadow || 'none'};">
                <a href="#" onclick="return false" style="display:inline-block;padding:12px 28px;color:${btn.text_color || '#fff'};text-decoration:none;font-weight:${btn.font_weight || '600'};font-size:14px;font-family:${font};letter-spacing:0.02em;">Pay Online</a>
              </td>
            </tr>
          </table>
        </div>
      </div>

      <!-- Callout Boxes -->
      <div class="brand-playground-section">
        <h4>Callout Boxes</h4>
        <p class="brand-hint" style="margin-bottom:12px;">Generated by <code>emailCallout(innerHtml)</code> in the brand wrapper.</p>
        <div style="background:${c.background || '#faf9f6'};border:1px solid ${c.border || '#e6e2d9'};border-radius:8px;padding:24px;">
          <div style="background:${callout.background || '#f2f0e8'};border:1px solid ${callout.border_color || '#e6e2d9'};border-radius:${callout.border_radius || '8px'};padding:${callout.padding || '20px 24px'};margin-bottom:12px;font-family:${font};">
            <p style="margin:0 0 8px;font-weight:600;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;color:${c.text_muted || '#7d6f74'};">Important Information</p>
            <p style="margin:0;font-size:15px;color:${c.text || '#2a1f23'};line-height:1.5;">Your move-in date is <strong>March 1, 2026</strong>. Please arrive after 3:00 PM. Your door code will be sent separately.</p>
          </div>
          <div style="background:#fdf1e0;border-left:3px solid ${c.accent || '#d4883a'};padding:10px 16px;border-radius:0 8px 8px 0;font-family:${font};">
            <p style="margin:0;color:${c.text_muted || '#7d6f74'};font-size:13px;line-height:1.5;"><strong style="color:${c.text || '#2a1f23'};">Reminder:</strong> Please review the visiting guidelines before sharing the address with guests.</p>
          </div>
        </div>
      </div>

      <!-- Data Table -->
      <div class="brand-playground-section">
        <h4>Info Tables</h4>
        <p class="brand-hint" style="margin-bottom:12px;">Used in move-in emails, payment receipts, and reservation details.</p>
        <div style="background:${c.background || '#faf9f6'};border:1px solid ${c.border || '#e6e2d9'};border-radius:8px;padding:24px;">
          <table style="border-collapse:collapse;width:100%;font-size:14px;border:1px solid ${c.border || '#e6e2d9'};border-radius:8px;overflow:hidden;font-family:${font};">
            <thead>
              <tr style="background:${c.background_dark || '#1c1618'};">
                <th colspan="2" style="padding:10px 12px;text-align:left;color:${c.text_light || '#faf9f6'};font-weight:600;font-size:14px;letter-spacing:0.3px;">Reservation Details</th>
              </tr>
            </thead>
            <tbody>
              <tr style="background:${c.background || '#faf9f6'};">
                <td style="padding:10px 12px;color:${c.text_muted || '#7d6f74'};font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;width:120px;">Space</td>
                <td style="padding:10px 12px;color:${c.accent || '#d4883a'};font-size:15px;font-weight:600;">Spartan Suite</td>
              </tr>
              <tr style="background:${c.background_muted || '#f2f0e8'};">
                <td style="padding:10px 12px;color:${c.text_muted || '#7d6f74'};font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Move-in</td>
                <td style="padding:10px 12px;color:${c.text || '#2a1f23'};font-size:15px;font-weight:600;">March 1, 2026</td>
              </tr>
              <tr style="background:${c.background || '#faf9f6'};">
                <td style="padding:10px 12px;color:${c.text_muted || '#7d6f74'};font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Rate</td>
                <td style="padding:10px 12px;color:${c.text || '#2a1f23'};font-size:15px;font-weight:600;">$1,200/mo</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Payment Badges -->
      <div class="brand-playground-section">
        <h4>Payment Method Badges</h4>
        <p class="brand-hint" style="margin-bottom:12px;">Colored badges for different payment methods shown in move-in and receipt emails.</p>
        <div style="background:${c.background || '#faf9f6'};border:1px solid ${c.border || '#e6e2d9'};border-radius:8px;padding:24px;display:flex;gap:8px;flex-wrap:wrap;font-family:${font};">
          <span style="display:inline-block;background:#3d95ce;color:white;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;">Venmo</span>
          <span style="display:inline-block;background:#6c1cd3;color:white;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;">Zelle</span>
          <span style="display:inline-block;background:#003087;color:white;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;">PayPal</span>
          <span style="display:inline-block;background:#635bff;color:white;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;">Stripe</span>
          <span style="display:inline-block;background:#2e7d32;color:white;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:600;">Bank</span>
        </div>
      </div>
    </div>
  `;
}

// =============================================
// EMAIL ANATOMY
// =============================================

function renderEmailAnatomy() {
  const el = document.getElementById('emailAnatomy');
  if (!el) return;
  const e = brandConfig.email || {};
  const c = brandConfig.colors?.primary || {};

  el.innerHTML = `
    <div class="brand-anatomy">
      <div class="brand-anatomy-diagram">
        <!-- Max width annotation -->
        <div class="brand-anatomy-width">
          <span class="brand-anatomy-arrow">&larr; ${e.max_width || '600px'} max-width &rarr;</span>
        </div>

        <!-- Container -->
        <div class="brand-anatomy-container" style="border:2px dashed ${c.accent || '#d4883a'};border-radius:12px;overflow:hidden;max-width:400px;margin:0 auto;">

          <!-- Header -->
          <div style="background:${c.background_dark || '#1c1618'};padding:20px;text-align:center;position:relative;">
            <span style="color:${c.text_light || '#faf9f6'};font-size:13px;font-weight:600;">HEADER</span>
            <span class="brand-anatomy-label" style="right:-80px;">pad: ${e.header?.padding || '32px'}</span>
          </div>

          <!-- Body -->
          <div style="background:${c.background || '#faf9f6'};padding:20px;position:relative;min-height:100px;display:flex;align-items:center;justify-content:center;">
            <span style="color:${c.text || '#2a1f23'};font-size:13px;font-weight:600;">BODY CONTENT</span>
            <span class="brand-anatomy-label" style="right:-80px;">pad: ${e.body?.padding || '32px'}</span>
          </div>

          <!-- Gallery -->
          <div style="background:${c.background || '#faf9f6'};padding:8px 20px;text-align:center;border-top:1px dashed ${c.border || '#e6e2d9'};position:relative;">
            <span style="color:${c.text_muted || '#7d6f74'};font-size:11px;">IMAGE GALLERY</span>
          </div>

          <!-- Footer -->
          <div style="background:${c.background_muted || '#f2f0e8'};padding:14px 20px;text-align:center;border-top:1px solid ${c.border || '#e6e2d9'};position:relative;">
            <span style="color:${c.text_muted || '#7d6f74'};font-size:13px;font-weight:600;">FOOTER</span>
            <span class="brand-anatomy-label" style="right:-80px;">pad: ${e.footer?.padding || '20px 32px'}</span>
          </div>
        </div>

        <!-- Outer padding annotation -->
        <div class="brand-anatomy-outer">
          <span style="font-size:0.75rem;color:${c.text_muted || '#7d6f74'};">Outer background: <code style="font-size:0.7rem;">${c.background_muted || '#f2f0e8'}</code> &middot; Outer padding: <code style="font-size:0.7rem;">24px 16px</code></span>
        </div>
      </div>

      <!-- Legend -->
      <div class="brand-anatomy-legend">
        <div class="brand-anatomy-legend-item">
          <span class="brand-anatomy-swatch" style="background:${c.background_dark || '#1c1618'};"></span>
          <span>Header: Logo + wordmark on dark bg</span>
        </div>
        <div class="brand-anatomy-legend-item">
          <span class="brand-anatomy-swatch" style="background:${c.background || '#faf9f6'};border:1px solid ${c.border || '#e6e2d9'};"></span>
          <span>Body: Main content area (cream)</span>
        </div>
        <div class="brand-anatomy-legend-item">
          <span class="brand-anatomy-swatch" style="background:${c.background_muted || '#f2f0e8'};border:1px solid ${c.border || '#e6e2d9'};"></span>
          <span>Footer + Outer: Muted background</span>
        </div>
        <div class="brand-anatomy-legend-item">
          <span class="brand-anatomy-swatch" style="background:${c.accent || '#d4883a'};"></span>
          <span>Container outline (12px border-radius)</span>
        </div>
      </div>
    </div>
  `;
}

// =============================================
// EMAIL DESIGN GUIDE
// =============================================

function renderEmailDesignGuide() {
  renderGuideLayout();
  renderGuideTypography();
  renderGuideSpacing();
  renderGuideButtons();
  renderGuideImages();
  renderGuideColors();
  renderGuideMobile();
  renderGuideDarkMode();
  renderGuideClientQuirks();
  renderGuideHelpers();
  renderGuideChecklist();
}

function guideTable(headers, rows) {
  return `<table class="brand-table brand-table--compact">
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
  </table>`;
}

function renderGuideLayout() {
  const el = document.getElementById('guideLayout');
  if (!el) return;
  el.innerHTML = guideTable(
    ['Property', 'Value', 'Why'],
    [
      ['Max width', '<code>600px</code>', 'Fits all preview panes without horizontal scrolling; clean retina math (600/2 = 300px mobile)'],
      ['Outer wrapper', '<code>width:100%</code>', 'Fluid background fills viewport on all screen sizes'],
      ['Inner container', '<code>max-width:600px; width:100%</code>', 'Centered, capped — scales down on mobile without media queries'],
      ['Layout method', 'Table-based (<code>&lt;table role="presentation"&gt;</code>)', 'Required for Outlook desktop (Word rendering engine ignores div layout)'],
      ['Column approach', 'Single-column preferred', '70%+ opens are mobile — multi-column requires complex stacking logic'],
      ['Table attributes', '<code>cellpadding="0" cellspacing="0" border="0"</code>', 'Reset all default table spacing; set on every table element'],
      ['Container radius', '<code>border-radius:12px</code>', 'Gracefully degrades to square in Outlook; looks polished elsewhere'],
      ['Gmail size limit', '<code>&lt; 102KB</code> total HTML', 'Gmail clips emails over 102KB with "Message clipped" link — includes all HTML + inline CSS, excludes images'],
    ]
  );
}

function renderGuideTypography() {
  const el = document.getElementById('guideTypography');
  if (!el) return;
  const c = brandConfig.colors?.primary || {};
  el.innerHTML = `
    ${guideTable(
      ['Element', 'Desktop', 'Mobile (via @media)', 'Line Height'],
      [
        ['H1 / Title', '<code>28px</code>, weight 700', '<code>24px</code>', '<code>34px</code> (1.2&times;)'],
        ['H2 / Subtitle', '<code>22px</code>, weight 600', '<code>20px</code>', '<code>28px</code> (1.27&times;)'],
        ['H3 / Section head', '<code>18px</code>, weight 600', '<code>18px</code>', '<code>24px</code> (1.33&times;)'],
        ['Body text', '<code>16px</code>, weight 400', '<code>16px</code>', '<code>26px</code> (1.6&times;)'],
        ['Small / captions', '<code>13px</code>, weight 400', '<code>13px</code>', '<code>20px</code> (1.5&times;)'],
        ['Footer / legal', '<code>12px</code>, weight 400', '<code>12px</code>', '<code>18px</code> (1.5&times;)'],
        ['Button text', '<code>16px</code>, weight 600', '<code>16px</code>', '<code>1</code> (unitless)'],
      ]
    )}
    <div style="margin-top:16px;">
      ${guideTable(
        ['Property', 'Value'],
        [
          ['Primary font stack', "<code>'DM Sans', Arial, Helvetica, sans-serif</code>"],
          ['Outlook fallback', '<code>Arial, Helvetica, sans-serif</code> (forced via mso conditional)'],
          ['Minimum font size', '<code>13px</code> — iOS auto-zooms text below 13px, breaking layout'],
          ['Letter spacing', 'Avoid except on buttons (<code>0.02em</code>) — Outlook ignores it'],
          ['Line height units', 'Always use <code>px</code> values, not unitless or % — most consistent across clients'],
          ['Link color', `<code>${c.accent || '#d4883a'}</code> (accent) with <code>text-decoration:underline</code>`],
          ['Muted text color', `<code>${c.text_muted || '#7d6f74'}</code> — passes 4.5:1 contrast on cream backgrounds`],
        ]
      )}
    </div>`;
}

function renderGuideSpacing() {
  const el = document.getElementById('guideSpacing');
  if (!el) return;
  el.innerHTML = guideTable(
    ['Area', 'Padding', 'Notes'],
    [
      ['Email body content', '<code>32px</code> all sides', 'Gives 536px content area within 600px container. Reduces to 20px on mobile via @media'],
      ['Header section', '<code>32px</code>', 'Vertically centers logo + wordmark. Reduces to 24px on mobile'],
      ['Footer section', '<code>20px 32px</code>', 'Top/bottom 20px, sides 32px. Reduces to 16px 20px on mobile'],
      ['Between paragraphs', '<code>margin:0 0 16px</code>', 'Bottom margin only — top margin collapses unpredictably in email clients'],
      ['Above headings', '<code>margin:24px 0 8px</code>', '24px above to separate from prior content, 8px below into text'],
      ['Callout box internal', '<code>20px 24px</code>', 'Comfortable reading space inside highlighted boxes'],
      ['Callout box external', '<code>margin:16px 0</code>', 'Vertical separation from surrounding content'],
      ['Above/below CTA button', '<code>margin:24px auto</code>', 'Generous whitespace makes the button a clear visual target'],
      ['Image to text gap', '<code>16px</code> below image', 'Prevents content from feeling cramped against images'],
      ['Spacer rows (Outlook)', '<code>&lt;td style="height:24px; font-size:0; line-height:0;"&gt;&amp;nbsp;&lt;/td&gt;</code>', 'Outlook needs height attribute + style + &amp;nbsp; to prevent row collapse'],
    ]
  );
}

function renderGuideButtons() {
  const el = document.getElementById('guideButtons');
  if (!el) return;
  const btn = brandConfig.email?.button || {};
  el.innerHTML = `
    ${guideTable(
      ['Property', 'Value'],
      [
        ['Background color', `<code>${btn.background || '#d4883a'}</code> (accent amber)`],
        ['Text color', `<code>${btn.text_color || '#ffffff'}</code>`],
        ['Padding', `<code>${btn.padding || '14px 36px'}</code> — gives ~48px height (exceeds 44px WCAG minimum)`],
        ['Font', '<code>16px</code>, weight <code>600</code>, <code>letter-spacing:0.02em</code>'],
        ['Border radius', `<code>${btn.border_radius || '8px'}</code> — ignored in Outlook (square corners), works everywhere else`],
        ['Box shadow', `<code>${btn.shadow || '0 2px 8px rgba(212,136,58,0.30)'}</code>`],
        ['Min-width', '<code>200px</code> recommended for readability'],
        ['Structure', 'Table-based: <code>&lt;table&gt;&lt;td&gt;&lt;a&gt;</code> — the <code>&lt;td&gt;</code> carries the background color'],
        ['Outlook fix', '<code>mso-padding-alt:14px 36px</code> on the <code>&lt;td&gt;</code> for correct padding in Word engine'],
        ['Dark mode tip', 'Use <code>rgba(212,136,58,1)</code> instead of hex — Office 365 dark mode does not invert rgba values'],
      ]
    )}
    <p style="margin-top:12px;font-size:13px;color:var(--aap-text-muted);">Use the <code>emailButton(text, url)</code> helper from <code>email-brand-wrapper.ts</code> — it handles all of the above automatically.</p>`;
}

function renderGuideImages() {
  const el = document.getElementById('guideImages');
  if (!el) return;
  el.innerHTML = guideTable(
    ['Property', 'Value', 'Why'],
    [
      ['Max display width', '<code>600px</code> (full-width) or <code>536px</code> (with body padding)', 'Never exceeds container width'],
      ['Upload resolution', '<code>2&times;</code> display size (e.g. 1200px wide for 600px display)', 'Sharp on retina/HiDPI screens'],
      ['Required attributes', '<code>width="600" style="width:100%; max-width:600px; height:auto; display:block; border:0;"</code>', 'HTML width for Outlook, CSS for responsive, display:block prevents 3-4px gap'],
      ['File size per image', '<code>&lt; 200KB</code> (aim for 50-100KB)', 'Fast loading on mobile connections'],
      ['Total images per email', '<code>&lt; 800KB</code> combined', 'Total weight budget including all images'],
      ['Formats', 'JPEG for photos, PNG-24 for graphics/logos with transparency', 'PNG transparency essential for dark mode logo adaptation'],
      ['Alt text', 'Always provide meaningful descriptions', 'Shown when images are blocked (common in corporate Outlook). Style with font-size, color, font-family'],
      ['Background images', 'Avoid — Outlook requires VML, Gmail strips <code>background-image</code> from entire style blocks', 'Use solid color backgrounds as fallbacks instead'],
    ]
  );
}

function renderGuideColors() {
  const el = document.getElementById('guideColors');
  if (!el) return;
  const c = brandConfig.colors?.primary || {};
  el.innerHTML = `
    <h4 style="margin:0 0 8px;">WCAG 2.2 AA Minimum Contrast Ratios</h4>
    ${guideTable(
      ['Text Type', 'Minimum Ratio', 'Our Value', 'Status'],
      [
        ['Normal text (&lt;18px)', '4.5:1', `<code>${c.text || '#2a1f23'}</code> on <code>${c.background || '#faf9f6'}</code>`, '<span style="color:var(--aap-success);">Passes</span>'],
        ['Large text (&ge;18px bold)', '3:1', `<code>${c.text || '#2a1f23'}</code> on <code>${c.background || '#faf9f6'}</code>`, '<span style="color:var(--aap-success);">Passes</span>'],
        ['Muted text', '4.5:1', `<code>${c.text_muted || '#7d6f74'}</code> on <code>${c.background || '#faf9f6'}</code>`, '<span style="color:var(--aap-success);">Passes</span>'],
        ['Button text', '4.5:1', '<code>#ffffff</code> on <code>' + (c.accent || '#d4883a') + '</code>', '<span style="color:var(--aap-success);">Passes</span>'],
        ['Footer text', '3:1 (large text only)', `<code>${c.text_muted || '#7d6f74'}</code> on <code>${c.background_muted || '#f2f0e8'}</code>`, '<span style="color:var(--aap-success);">Passes</span>'],
      ]
    )}
    <h4 style="margin:16px 0 8px;">Color Usage Rules</h4>
    ${guideTable(
      ['Rule', 'Detail'],
      [
        ['Never use pure black', 'Use <code>' + (c.text || '#2a1f23') + '</code> (brand dark) instead of <code>#000000</code> — reduces eye strain and looks more refined'],
        ['Never use pure white text', 'Use <code>' + (c.text_light || '#faf9f6') + '</code> (cream white) — slightly warm tone matches brand'],
        ['Links must be distinguishable', 'Use <code>' + (c.accent || '#d4883a') + '</code> (accent) with underline — must pass 3:1 against surrounding text color'],
        ['Do not rely on color alone', 'Always pair color with text labels or icons to convey meaning (e.g. "Paid" not just green)'],
        ['Divider lines', 'Use <code>' + (c.border || '#e6e2d9') + '</code> — subtle warm border that complements the cream palette'],
      ]
    )}`;
}

function renderGuideMobile() {
  const el = document.getElementById('guideMobile');
  if (!el) return;
  el.innerHTML = `
    ${guideTable(
      ['Property', 'Value', 'Notes'],
      [
        ['Breakpoint', '<code>@media screen and (max-width:480px)</code>', 'Primary mobile breakpoint; desktop Gmail ignores @media entirely'],
        ['Body padding (mobile)', '<code>24px 20px</code>', 'Reduced from 32px to give more content width on small screens'],
        ['Minimum body font', '<code>16px</code>', 'iOS auto-zooms anything below 13px; 16px is comfortable reading size'],
        ['Minimum any text', '<code>13px</code>', 'Never go below this — iOS zoom will break layout'],
        ['Touch targets', '<code>44&times;44px</code> minimum', 'All tappable elements (buttons, links) — add padding around inline links'],
        ['Layout approach', 'Fluid hybrid (no media query needed)', '<code>max-width</code> on inner container scales down naturally; @media adds refinements'],
        ['Stacking pattern', '<code>width:100% !important; display:block !important</code>', 'Multi-column layouts should stack to single-column on mobile'],
        ['Text size adjust', '<code>-webkit-text-size-adjust:100%</code>', 'Prevents iOS Mail from auto-resizing text; set on body'],
      ]
    )}
    <p style="margin-top:12px;font-size:13px;color:var(--aap-text-muted);"><strong>Our wrapper handles this automatically.</strong> The <code>wrapEmailHtml()</code> function includes responsive <code>@media</code> rules that reduce padding on mobile and the fluid-hybrid container that scales without media queries.</p>`;
}

function renderGuideDarkMode() {
  const el = document.getElementById('guideDarkMode');
  if (!el) return;
  el.innerHTML = `
    <h4 style="margin:0 0 8px;">Client Dark Mode Behavior</h4>
    ${guideTable(
      ['Client', 'Behavior', 'CSS Control'],
      [
        ['Apple Mail (iOS/macOS)', 'Partial inversion; respects <code>prefers-color-scheme</code>', 'Full control via media query'],
        ['Gmail (iOS/Android app)', 'Aggressive full inversion', 'Very limited; ignores most overrides'],
        ['Gmail (web)', 'No dark mode inversion', 'N/A'],
        ['Outlook (iOS)', 'Full inversion', 'Limited support'],
        ['Outlook (desktop/new)', 'Injects <code>data-ogsc</code>/<code>data-ogsb</code> overrides', 'Target with attribute selectors'],
        ['Yahoo Mail', 'No inversion in dark mode', 'N/A'],
      ]
    )}
    <h4 style="margin:16px 0 8px;">Defensive Design Rules</h4>
    ${guideTable(
      ['Rule', 'Detail'],
      [
        ['Use PNG with transparency for logos', 'Adapts to any background color — our logo is white-on-transparent for this reason'],
        ['Add white stroke around dark logos', '1-2px white outline ensures visibility when background is inverted to dark'],
        ['Use <code>rgba()</code> for button backgrounds', '<code>rgba(212,136,58,1)</code> instead of <code>#d4883a</code> — Office 365 dark mode does not invert rgba values'],
        ['Include <code>&lt;meta name="color-scheme" content="light dark"&gt;</code>', 'Tells clients the email supports both modes — our wrapper includes this'],
        ['Do not rely on background color to convey meaning', 'Dark mode may invert or remove background colors entirely'],
        ['Test with inverted colors', 'Manually invert your preview — if critical information disappears, redesign that element'],
      ]
    )}`;
}

function renderGuideClientQuirks() {
  const el = document.getElementById('guideClientQuirks');
  if (!el) return;
  el.innerHTML = `
    <h4 style="margin:0 0 8px;">Outlook Desktop (Word Engine)</h4>
    ${guideTable(
      ['Status', 'CSS Property'],
      [
        ['<span style="color:var(--aap-error);">Not supported</span>', '<code>border-radius</code>, <code>background-image</code> (CSS), <code>max-width</code>, <code>float</code>, <code>flexbox</code>, <code>grid</code>, <code>box-shadow</code>, <code>opacity</code>, CSS <code>width/height</code> on images'],
        ['<span style="color:var(--aap-warning);">Requires workaround</span>', 'Padding (only works on <code>&lt;td&gt;</code>), margins on divs/images, VML for rounded corners'],
        ['<span style="color:var(--aap-success);">Works</span>', 'HTML <code>width/height</code> attributes, <code>background-color</code>, <code>font-*</code>, <code>color</code>, <code>text-align</code>, <code>border</code>'],
      ]
    )}
    <h4 style="margin:16px 0 8px;">Gmail</h4>
    ${guideTable(
      ['Limit', 'Detail'],
      [
        ['HTML size', '<code>102KB</code> — clips email with "Message clipped" link. Includes all HTML + inline CSS, not images'],
        ['<code>&lt;style&gt;</code> block', '<code>8,192</code> characters max. A single syntax error invalidates all styles'],
        ['Stripped properties', '<code>position</code>, <code>float</code>, transforms, animations, <code>box-shadow</code>, <code>filter</code>'],
        ['Background image gotcha', 'If ANY rule in <code>&lt;style&gt;</code> contains <code>background-image:url(...)</code>, Gmail strips the ENTIRE style block'],
        ['Media queries', 'Supported on mobile Gmail apps. Ignored on desktop Gmail web'],
      ]
    )}
    <h4 style="margin:16px 0 8px;">Other Clients</h4>
    ${guideTable(
      ['Client', 'Quirk'],
      [
        ['Apple Mail', 'Most standards-compliant. Supports @font-face, CSS animations, flexbox. Design here first, degrade for others'],
        ['Yahoo Mail', 'Converts <code>height</code> to <code>min-height</code>. Strips <code>!important</code> if there is a space before the <code>!</code>'],
        ['Samsung Mail', 'Respects HTML <code>width</code> attribute literally (ignores CSS <code>max-width</code> on images). Fix: use both HTML and CSS width attributes'],
      ]
    )}`;
}

function renderGuideHelpers() {
  const el = document.getElementById('guideHelpers');
  if (!el) return;
  el.innerHTML = `
    ${guideTable(
      ['Function', 'Usage', 'Description'],
      [
        ['<code>wrapEmailHtml(html, options)</code>', '<code>import { wrapEmailHtml } from "../_shared/email-brand-wrapper.ts";</code>', 'Wraps inner HTML in full branded shell (header, body, footer). Options: <code>showHeader</code>, <code>showFooter</code>, <code>preheader</code>, <code>accentColor</code>'],
        ['<code>emailButton(text, url)</code>', '<code>import { emailButton } from "../_shared/email-brand-wrapper.ts";</code>', 'Generates a table-based CTA button with brand styling and Outlook compatibility. Use inside email body content'],
        ['<code>emailCallout(html)</code>', '<code>import { emailCallout } from "../_shared/email-brand-wrapper.ts";</code>', 'Generates a callout/info box with muted background and border. Use for key information, instructions, or summaries'],
      ]
    )}
    <h4 style="margin:16px 0 8px;">Templates That Skip the Wrapper</h4>
    <p style="font-size:13px;color:var(--aap-text-muted);margin-bottom:8px;">These 4 email types have their own complete HTML layouts and are NOT wrapped by <code>wrapEmailHtml()</code>:</p>
    ${guideTable(
      ['Template', 'Reason'],
      [
        ['<code>custom</code>', 'Raw HTML passthrough — admin provides complete HTML'],
        ['<code>staff_invitation</code>', 'Has its own full branded layout with different header design'],
        ['<code>pai_email_reply</code>', 'PAI-branded layout with PAI-specific styling'],
        ['<code>payment_statement</code>', 'Complex table-heavy layout with gradient header for financial data'],
      ]
    )}
    <p style="font-size:13px;color:var(--aap-text-muted);margin-top:12px;"><strong>All other email types use the wrapper.</strong> When creating a new email template, always use <code>wrapEmailHtml()</code> unless you have a specific reason to build a custom layout.</p>`;
}

function renderGuideChecklist() {
  const el = document.getElementById('guideChecklist');
  if (!el) return;
  const checks = [
    ['Total HTML under 102KB', 'Gmail clips emails over this limit. Check with: <code>new Blob([html]).size</code>'],
    ['All images have alt text', 'Meaningful descriptions for when images are blocked (common in corporate Outlook)'],
    ['All images have explicit width/height', 'Both HTML attributes AND inline CSS — Outlook needs HTML, responsive needs CSS'],
    ['No font size below 13px', 'iOS auto-zooms small text, breaking layout'],
    ['All padding on &lt;td&gt; elements only', 'Outlook strips padding from divs, p, and a elements'],
    ['Tables have cellpadding="0" cellspacing="0" border="0"', 'Reset default browser table spacing'],
    ['Tables have role="presentation"', 'Accessibility: prevents screen readers from announcing table structure'],
    ['CTA button uses table-based pattern', 'Use <code>emailButton()</code> helper — div/a-only buttons break in Outlook'],
    ['Links are underlined with accent color', 'Must be distinguishable from regular text, even without color vision'],
    ['Preheader text is 70-100 characters', 'Preview text in inbox — too short pulls in body text, too long gets cut off'],
    ['Tested on mobile viewport (375px)', 'Open the HTML file locally and resize browser to ~375px width'],
    ['Button/link touch targets &ge; 44px', 'WCAG minimum for comfortable mobile tapping'],
    ['No background-image in &lt;style&gt; block', 'Gmail strips entire style block if any rule contains background-image:url(...)'],
    ['Colors pass WCAG AA contrast', 'Normal text: 4.5:1, large text: 3:1, UI components: 3:1'],
    ['Footer includes address + platform name', 'CAN-SPAM compliance requires physical mailing address'],
  ];
  el.innerHTML = `<div class="brand-checklist">${checks.map(([item, detail]) =>
    `<div class="brand-checklist-item">
      <div class="brand-checklist-check">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" ry="3"/></svg>
      </div>
      <div>
        <div style="font-weight:500;">${item}</div>
        <div style="font-size:12px;color:var(--aap-text-muted);">${detail}</div>
      </div>
    </div>`
  ).join('')}</div>`;
}

// =============================================
// RAW JSON
// =============================================

function renderRawJson() {
  const el = document.getElementById('rawJson');
  if (!el || !brandConfig) return;
  el.textContent = JSON.stringify(brandConfig, null, 2);
}
