/**
 * Pending Email-Approvals Digest
 * Daily heads-up to alpacaplayhouse@gmail.com listing every email that has
 * been sitting in `pending_email_approvals` (status='pending') for more
 * than STUCK_THRESHOLD_HOURS — with one-click Approve / Approve-type links
 * for each row. The initial approval-request email already fires at queue
 * time; this digest is the safety net for when that first ping is missed.
 *
 * Trigger: Daily via pg_cron at 8 AM CT (13:00 UTC during CDT — see DEPLOY note).
 * Deploy: supabase functions deploy pending-approvals-digest
 * Manual: curl -X POST https://aphrrfprbixmhissnjfn.supabase.co/functions/v1/pending-approvals-digest \
 *           -H "Authorization: Bearer <service_role_or_anon_key>"
 *
 * Returns {ok, stuck_count, sent} — no email sent when stuck_count=0.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getCorsHeaders } from '../_shared/api-helpers.ts';

const STUCK_THRESHOLD_HOURS = 1;
const DIGEST_TO = 'alpacaplayhouse@gmail.com';

interface StuckRow {
  id: string;
  email_type: string;
  to_addresses: string[];
  subject: string;
  created_at: string;
  expires_at: string;
  approval_token: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // The edge-function gateway requires a legacy-format JWT, not the newer
  // sb_secret_* secret key. SUPABASE_SERVICE_ROLE_KEY may be either depending
  // on project config — LEGACY_SERVICE_ROLE_KEY is the JWT explicitly.
  const legacyJwt = Deno.env.get('LEGACY_SERVICE_ROLE_KEY') || supabaseServiceKey;
  const sb = createClient(supabaseUrl, supabaseServiceKey);

  const cutoffIso = new Date(Date.now() - STUCK_THRESHOLD_HOURS * 60 * 60 * 1000).toISOString();
  const { data: stuck, error } = await sb
    .from('pending_email_approvals')
    .select('id, email_type, to_addresses, subject, created_at, expires_at, approval_token')
    .eq('status', 'pending')
    .lt('created_at', cutoffIso)
    .order('created_at', { ascending: true });

  if (error) {
    return json({ ok: false, error: error.message }, 500, req);
  }

  const rows = (stuck || []) as StuckRow[];
  if (rows.length === 0) {
    return json({ ok: true, stuck_count: 0, sent: false }, 200, req);
  }

  const approveBase = `${supabaseUrl}/functions/v1/approve-email`;
  const tableRows = rows.map((s) => {
    const approveOne = `${approveBase}?token=${s.approval_token}&action=approve_one`;
    const approveAll = `${approveBase}?token=${s.approval_token}&action=approve_all`;
    const typeLabel = s.email_type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const recipients = (s.to_addresses || []).join(', ');
    const expiresIn = hoursUntil(s.expires_at);
    const expiresLabel = expiresIn <= 0
      ? '<span style="color:#c62828;">expired</span>'
      : expiresIn < 24
        ? `<span style="color:#c62828;">expires in ${Math.max(1, expiresIn)}h</span>`
        : `expires in ${Math.floor(expiresIn / 24)}d`;

    return `
      <tr>
        <td style="padding:12px 8px;border-bottom:1px solid #eee;vertical-align:top;">
          <span style="background:#d4883a;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;letter-spacing:0.3px;">${esc(typeLabel)}</span>
          <div style="margin-top:6px;font-size:14px;color:#1c1618;font-weight:600;">${esc(s.subject)}</div>
          <div style="margin-top:3px;font-size:12px;color:#6b5e3f;">${esc(recipients)}</div>
          <div style="margin-top:3px;font-size:12px;color:#888;">stuck ${ageLabel(s.created_at)} · ${expiresLabel}</div>
        </td>
        <td style="padding:12px 8px;border-bottom:1px solid #eee;vertical-align:top;text-align:right;white-space:nowrap;">
          <a href="${approveOne}" style="display:inline-block;padding:8px 14px;background:#54a326;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:13px;margin-bottom:4px;">Approve</a>
          <br>
          <a href="${approveAll}" style="display:inline-block;padding:6px 12px;background:#fff;color:#d4883a;border:1px solid #d4883a;text-decoration:none;border-radius:6px;font-weight:600;font-size:12px;margin-top:4px;">Approve type</a>
        </td>
      </tr>
    `;
  }).join('');

  const subject = `${rows.length} stuck approval${rows.length === 1 ? '' : 's'} in the queue`;
  const html = `
    <h2 style="margin:0 0 6px;color:#1c1618;">${rows.length} email${rows.length === 1 ? '' : 's'} stuck in the approval queue</h2>
    <p style="margin:0 0 16px;color:#555;font-size:14px;">These have been waiting more than ${STUCK_THRESHOLD_HOURS}h. <strong>Approve</strong> sends just that one. <strong>Approve type</strong> sends it and auto-approves all future emails of that type.</p>
    <table style="width:100%;border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
      ${tableRows}
    </table>
    <p style="margin-top:18px;color:#888;font-size:12px;">Daily digest from <code>pending-approvals-digest</code>. Threshold ${STUCK_THRESHOLD_HOURS}h. Queue lives in <code>pending_email_approvals</code>.</p>
  `;
  const text = `${rows.length} stuck approval${rows.length === 1 ? '' : 's'}:\n\n` +
    rows.map((s) => `- ${s.email_type} → ${(s.to_addresses || []).join(', ')}\n  ${s.subject}\n  Approve: ${approveBase}?token=${s.approval_token}&action=approve_one`).join('\n\n');

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
  return json({ ok: sendRes.ok, stuck_count: rows.length, sent: sendRes.ok, status: sendRes.status, send_body: sendBody }, sendRes.ok ? 200 : 500, req);
});

function esc(s: string): string {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function ageLabel(createdIso: string): string {
  const hrs = Math.floor((Date.now() - new Date(createdIso).getTime()) / 36e5);
  if (hrs < 1) return '<1h ago';
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function hoursUntil(iso: string): number {
  return Math.floor((new Date(iso).getTime() - Date.now()) / 36e5);
}

function json(body: unknown, status: number, req: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}
