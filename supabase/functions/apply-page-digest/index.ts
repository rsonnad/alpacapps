/**
 * Apply Page Digest
 * Daily metrics email for /rentals/apply/: yesterday's landings, unique visitors,
 * people who started the form, inquiries and full applications, top referrers,
 * and a 7-day trend. Days are Chicago calendar days. Staff visits are excluded.
 *
 * Data: page_events (written by track_page_event() from the apply page) and
 * rental_applications, via apply_page_daily_metrics() / apply_page_top_referrers().
 *
 * Trigger: Daily via pg_cron at 8 AM CT (13:00 UTC during CDT).
 * Deploy: supabase functions deploy apply-page-digest
 * Manual: curl -X POST https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/apply-page-digest \
 *           -H "Authorization: Bearer <service_role_or_anon_key>"
 *
 * Always sends (a zero day is still a data point). Returns {ok, sent, yesterday}.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getCorsHeaders } from '../_shared/api-helpers.ts';

const DIGEST_TO = 'alpacaplayhouse@gmail.com';
const TREND_DAYS = 7;

interface DayRow {
  day: string;
  views: number;
  visitors: number;
  form_started: number;
  step2_views: number;
  inquiries: number;
  applications: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // The edge-function gateway requires a legacy-format JWT (see pending-approvals-digest).
  const legacyJwt = Deno.env.get('LEGACY_SERVICE_ROLE_KEY') || supabaseServiceKey;
  const sb = createClient(supabaseUrl, supabaseServiceKey);

  const [metricsRes, refRes] = await Promise.all([
    sb.rpc('apply_page_daily_metrics', { p_days: TREND_DAYS }),
    sb.rpc('apply_page_top_referrers', { p_limit: 8 }),
  ]);
  if (metricsRes.error) return json({ ok: false, error: metricsRes.error.message }, 500, req);
  if (refRes.error) return json({ ok: false, error: refRes.error.message }, 500, req);

  const days = (metricsRes.data || []) as DayRow[];
  const referrers = (refRes.data || []) as { referrer: string; visitors: number }[];
  const y = days[0];
  if (!y) return json({ ok: false, error: 'no metrics rows' }, 500, req);

  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
  const dayLabel = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

  const stat = (label: string, value: string | number, sub = '') => `
    <td style="padding:10px 8px;text-align:center;vertical-align:top;">
      <div style="font-size:26px;font-weight:700;color:#1c1618;">${value}</div>
      <div style="font-size:12px;color:#6b5e3f;margin-top:2px;">${label}</div>
      ${sub ? `<div style="font-size:11px;color:#888;margin-top:2px;">${sub}</div>` : ''}
    </td>`;

  const th = 'padding:6px 8px;border-bottom:2px solid #eee;text-align:right;font-size:12px;color:#6b5e3f;';
  const td = 'padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-size:13px;color:#1c1618;';
  const trendRows = days.map((d) => `
    <tr>
      <td style="${td}text-align:left;">${dayLabel(d.day)}</td>
      <td style="${td}">${d.visitors}</td>
      <td style="${td}">${d.form_started}</td>
      <td style="${td}">${d.inquiries}</td>
      <td style="${td}">${d.applications}</td>
    </tr>`).join('');

  const totals = days.reduce((a, d) => ({
    visitors: a.visitors + Number(d.visitors),
    form_started: a.form_started + Number(d.form_started),
    inquiries: a.inquiries + Number(d.inquiries),
    applications: a.applications + Number(d.applications),
  }), { visitors: 0, form_started: 0, inquiries: 0, applications: 0 });

  const refRows = referrers.length
    ? referrers.map((r) => `<tr><td style="${td}text-align:left;">${esc(r.referrer)}</td><td style="${td}">${r.visitors}</td></tr>`).join('')
    : `<tr><td style="${td}text-align:left;color:#888;" colspan="2">No visitors yesterday</td></tr>`;

  const subject = `Apply page: ${y.visitors} visitor${Number(y.visitors) === 1 ? '' : 's'}, ${y.inquiries} inquir${Number(y.inquiries) === 1 ? 'y' : 'ies'} (${dayLabel(y.day)})`;
  const html = `
    <h2 style="margin:0 0 4px;color:#1c1618;">Apply page — ${dayLabel(y.day)}</h2>
    <p style="margin:0 0 14px;color:#555;font-size:14px;">Traffic to <a href="https://alpacaplayhouse.com/rentals/apply/" style="color:#d4883a;">/rentals/apply/</a> yesterday (Central time). Staff visits excluded.</p>
    <table style="width:100%;border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#faf7f2;border-radius:8px;">
      <tr>
        ${stat('Visitors', y.visitors, `${y.views} page views`)}
        ${stat('Started form', y.form_started, pct(Number(y.form_started), Number(y.visitors)) + ' of visitors')}
        ${stat('Inquiries', y.inquiries, pct(Number(y.inquiries), Number(y.visitors)) + ' of visitors')}
        ${stat('Full applications', y.applications, `${y.step2_views} step-2 visits`)}
      </tr>
    </table>

    <h3 style="margin:22px 0 6px;color:#1c1618;font-size:15px;">Where yesterday's visitors came from</h3>
    <table style="width:100%;border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <tr><th style="${th}text-align:left;">Source</th><th style="${th}">Visitors</th></tr>
      ${refRows}
    </table>

    <h3 style="margin:22px 0 6px;color:#1c1618;font-size:15px;">Last ${TREND_DAYS} days</h3>
    <table style="width:100%;border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      <tr><th style="${th}text-align:left;">Day</th><th style="${th}">Visitors</th><th style="${th}">Started</th><th style="${th}">Inquiries</th><th style="${th}">Applications</th></tr>
      ${trendRows}
      <tr>
        <td style="${td}text-align:left;font-weight:700;">Total</td>
        <td style="${td}font-weight:700;">${totals.visitors}</td>
        <td style="${td}font-weight:700;">${totals.form_started}</td>
        <td style="${td}font-weight:700;">${totals.inquiries}</td>
        <td style="${td}font-weight:700;">${totals.applications}</td>
      </tr>
    </table>
    <p style="margin-top:18px;color:#888;font-size:12px;">Visitors = unique browser tabs that loaded the page. Started = typed into the form. Source uses <code>utm_source</code> when the link has one, otherwise the referring site. Daily digest from <code>apply-page-digest</code>.</p>
  `;
  const text = `${subject}\n\n` +
    `Visitors: ${y.visitors} (${y.views} views)\nStarted form: ${y.form_started}\nInquiries: ${y.inquiries}\nFull applications: ${y.applications}\n\n` +
    `Sources:\n${referrers.map((r) => `- ${r.referrer}: ${r.visitors}`).join('\n') || '- none'}\n\n` +
    `Last ${TREND_DAYS} days (visitors / started / inquiries / applications):\n` +
    days.map((d) => `${d.day}: ${d.visitors} / ${d.form_started} / ${d.inquiries} / ${d.applications}`).join('\n');

  const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${legacyJwt}` },
    body: JSON.stringify({
      type: 'custom',
      to: DIGEST_TO,
      subject,
      data: { subject, html, text },
    }),
  });

  const sendBody = await sendRes.json().catch(() => ({}));
  return json({ ok: sendRes.ok, sent: sendRes.ok, yesterday: y, status: sendRes.status, send_body: sendBody }, sendRes.ok ? 200 : 500, req);
});

function esc(s: string): string {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function json(body: unknown, status: number, req: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}
