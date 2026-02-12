/**
 * Email Brand Wrapper
 *
 * Wraps email HTML content in a consistent branded shell with:
 * - Branded header (dark background, alpaca icon + wordmark)
 * - Consistent body styling (fonts, colors, spacing)
 * - Branded footer (address, tagline)
 * - Inline styles for email client compatibility
 *
 * Usage in send-email/index.ts:
 *   import { wrapEmailHtml } from '../_shared/email-brand-wrapper.ts';
 *   const wrappedHtml = wrapEmailHtml(innerHtml, { showHeader: true });
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

// In-memory cache for brand config
let _brandCache: { config: any; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 min

// Hardcoded fallback (matches DB seed)
const FALLBACK = {
  brand: {
    primary_name: 'Alpaca Playhouse',
    full_name: 'Alpaca Playhouse Austin',
    platform_name: 'AlpacApps',
    tagline: 'Where the herd gathers',
    address: '160 Still Forest Dr, Cedar Creek, TX 78612',
    website: 'https://alpacaplayhouse.com',
  },
  colors: {
    primary: {
      background: '#faf9f6',
      background_muted: '#f2f0e8',
      background_dark: '#1c1618',
      text: '#2a1f23',
      text_light: '#faf9f6',
      text_muted: '#7d6f74',
      accent: '#d4883a',
      border: '#e6e2d9',
    },
  },
  typography: {
    font_family: 'DM Sans',
    font_stack: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  logos: {
    base_url: 'https://aphrrfprbixmhissnjfn.supabase.co/storage/v1/object/public/housephotos/logos',
    icon_light: 'alpaca-head-white-transparent.png',
    wordmark_light: 'wordmark-white-transparent.png',
  },
  email: {
    max_width: '600px',
    header: { background: '#1c1618', text_color: '#faf9f6', padding: '32px', logo_height: '40px', wordmark_height: '20px' },
    body: { background: '#faf9f6', text_color: '#2a1f23', text_muted: '#7d6f74', padding: '32px', line_height: '1.6' },
    callout: { background: '#f2f0e8', border_color: '#e6e2d9', border_radius: '8px', padding: '20px 24px' },
    button: { background: '#d4883a', text_color: '#ffffff', border_radius: '8px', padding: '14px 36px', font_weight: '600', shadow: '0 2px 8px rgba(212, 136, 58, 0.30)' },
    footer: { background: '#f2f0e8', text_color: '#7d6f74', border_top: '1px solid #e6e2d9', padding: '20px 32px' },
  },
};

/**
 * Load brand config from DB (cached).
 */
async function loadBrandConfig(): Promise<any> {
  if (_brandCache && Date.now() - _brandCache.fetchedAt < CACHE_TTL) {
    return _brandCache.config;
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await sb
      .from("brand_config")
      .select("config")
      .eq("id", 1)
      .single();

    if (data && !error) {
      _brandCache = { config: data.config, fetchedAt: Date.now() };
      return data.config;
    }
  } catch (e) {
    console.warn("Failed to load brand_config, using fallback:", e);
  }

  _brandCache = { config: FALLBACK, fetchedAt: Date.now() };
  return FALLBACK;
}

export interface WrapOptions {
  /** Show the branded header with logo (default: true) */
  showHeader?: boolean;
  /** Show the branded footer with address (default: true) */
  showFooter?: boolean;
  /** Custom preheader text (hidden preview text in email clients) */
  preheader?: string;
  /** Override accent color for the CTA button */
  accentColor?: string;
}

/**
 * Wrap inner HTML content in the branded email shell.
 *
 * @param innerHtml - The email body content (already rendered with data)
 * @param options - Display options
 * @returns Full HTML document string for the email
 */
export async function wrapEmailHtml(
  innerHtml: string,
  options: WrapOptions = {}
): Promise<string> {
  const { showHeader = true, showFooter = true, preheader = '', accentColor } = options;
  const b = await loadBrandConfig();

  const c = b.colors?.primary || FALLBACK.colors.primary;
  const e = b.email || FALLBACK.email;
  const logos = b.logos || FALLBACK.logos;
  const brand = b.brand || FALLBACK.brand;
  const typo = b.typography || FALLBACK.typography;

  const logoBase = logos.base_url;
  const iconUrl = `${logoBase}/${logos.icon_light}`;
  const wordmarkUrl = `${logoBase}/${logos.wordmark_light}`;
  const fontFamily = typo.font_stack || FALLBACK.typography.font_stack;

  const accent = accentColor || c.accent;

  const headerHtml = showHeader ? `
    <!-- Header -->
    <tr>
      <td style="background:${e.header.background};padding:${e.header.padding};text-align:center;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
          <tr>
            <td style="padding-right:12px;vertical-align:middle;">
              <img src="${iconUrl}" alt="" width="40" height="40" style="display:block;height:${e.header.logo_height};width:auto;" />
            </td>
            <td style="vertical-align:middle;">
              <img src="${wordmarkUrl}" alt="${brand.full_name}" height="20" style="display:block;height:${e.header.wordmark_height};width:auto;" />
            </td>
          </tr>
        </table>
      </td>
    </tr>` : '';

  const footerHtml = showFooter ? `
    <!-- Footer -->
    <tr>
      <td style="background:${e.footer.background};padding:${e.footer.padding};text-align:center;border-top:${e.footer.border_top};">
        <p style="margin:0;color:${e.footer.text_color};font-size:12px;font-family:${fontFamily};">${brand.address}</p>
        <p style="margin:6px 0 0;color:${e.footer.text_color};font-size:11px;font-family:${fontFamily};opacity:0.7;">${brand.platform_name} &bull; ${brand.tagline}</p>
      </td>
    </tr>` : '';

  const preheaderHtml = preheader
    ? `<div style="display:none;font-size:1px;color:#faf9f6;line-height:1px;max-height:0;overflow:hidden;">${preheader}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${brand.full_name}</title>
  <!--[if mso]><style>body,table,td{font-family:Arial,Helvetica,sans-serif!important}</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${c.background_muted};font-family:${fontFamily};-webkit-font-smoothing:antialiased;">
  ${preheaderHtml}
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${c.background_muted};">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <!-- Email Container -->
        <table role="presentation" cellpadding="0" cellspacing="0" width="${e.max_width}" style="max-width:${e.max_width};width:100%;background:${c.background};border-radius:12px;overflow:hidden;box-shadow:${FALLBACK.email.body.background === c.background ? '0 2px 12px rgba(42,31,35,0.06)' : 'none'};">
          ${headerHtml}
          <!-- Body -->
          <tr>
            <td style="padding:${e.body.padding};color:${e.body.text_color};font-size:16px;line-height:${e.body.line_height};font-family:${fontFamily};">
              ${innerHtml}
            </td>
          </tr>
          ${footerHtml}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Generate a branded CTA button HTML string.
 * Use inside email body content.
 */
export function emailButton(text: string, url: string, config?: any): string {
  const e = config?.email?.button || FALLBACK.email.button;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto;text-align:center;">
    <tr>
      <td style="background:${e.background};border-radius:${e.border_radius};box-shadow:${e.shadow};">
        <a href="${url}" style="display:inline-block;padding:${e.padding};color:${e.text_color};text-decoration:none;font-weight:${e.font_weight};font-size:16px;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:0.02em;" target="_blank">${text}</a>
      </td>
    </tr>
  </table>`;
}

/**
 * Generate a branded callout/info box HTML string.
 * Use inside email body content.
 */
export function emailCallout(innerHtml: string, config?: any): string {
  const e = config?.email?.callout || FALLBACK.email.callout;
  return `<div style="background:${e.background};border:1px solid ${e.border_color};border-radius:${e.border_radius};padding:${e.padding};margin:16px 0;">
    ${innerHtml}
  </div>`;
}

/**
 * Get the brand config synchronously (from cache or fallback).
 * Call loadBrandConfig() first if you need fresh data.
 */
export function getBrandConfigSync(): any {
  return _brandCache?.config || FALLBACK;
}

export { loadBrandConfig };
