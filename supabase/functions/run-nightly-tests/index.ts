/**
 * Run Nightly Tests
 * Executes a suite of automated health checks and stores results in nightly_test_runs.
 * Trigger: Nightly via pg_cron or Hermes agent, or manually from Test Suite admin page.
 *
 * Deploy: supabase functions deploy run-nightly-tests
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getCorsHeaders } from "../_shared/api-helpers.ts";
import { SENDER_MAP } from "../_shared/template-engine.ts";
import { wrapEmailHtml } from "../_shared/email-brand-wrapper.ts";
import { ROUTES, absoluteUrl } from "../_shared/routes.ts";

interface TestResult {
  test_name: string;
  test_category: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
  details?: Record<string, any>;
  duration_ms: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

  // Parse optional body for selective test running
  let requestedTests: string[] | null = null;
  try {
    const body = await req.json();
    if (body?.tests && Array.isArray(body.tests)) {
      requestedTests = body.tests;
    }
  } catch { /* no body or invalid JSON — run all tests */ }

  const runId = crypto.randomUUID();
  const results: TestResult[] = [];

  // ─── Test Definitions ──────────────────────────────────────────────

  const allTests: Array<{ name: string; category: string; fn: () => Promise<TestResult> }> = [
    {
      name: 'GitHub Pages Live',
      category: 'infra',
      fn: async () => {
        const start = Date.now();
        try {
          const res = await fetch('https://alpacaplayhouse.com/', { method: 'HEAD', redirect: 'follow' });
          const ms = Date.now() - start;
          if (res.ok) {
            return { test_name: 'GitHub Pages Live', test_category: 'infra', status: 'pass', message: `HTTP ${res.status} in ${ms}ms`, duration_ms: ms };
          }
          return { test_name: 'GitHub Pages Live', test_category: 'infra', status: 'fail', message: `HTTP ${res.status}`, duration_ms: ms };
        } catch (e) {
          return { test_name: 'GitHub Pages Live', test_category: 'infra', status: 'fail', message: `Fetch error: ${e.message}`, duration_ms: Date.now() - start };
        }
      },
    },
    {
      name: 'Supabase API Reachable',
      category: 'infra',
      fn: async () => {
        const start = Date.now();
        try {
          const { data, error } = await supabase.from('spaces').select('id').limit(1);
          const ms = Date.now() - start;
          if (error) return { test_name: 'Supabase API Reachable', test_category: 'infra', status: 'fail', message: error.message, duration_ms: ms };
          return { test_name: 'Supabase API Reachable', test_category: 'infra', status: 'pass', message: `Query OK in ${ms}ms`, duration_ms: ms };
        } catch (e) {
          return { test_name: 'Supabase API Reachable', test_category: 'infra', status: 'fail', message: e.message, duration_ms: Date.now() - start };
        }
      },
    },
    {
      name: 'Uptime Kuma (Oracle Phoenix)',
      category: 'infra',
      fn: async () => {
        const start = Date.now();
        try {
          const res = await fetch('http://144.24.51.48:3001/', { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000) });
          const ms = Date.now() - start;
          if (res.ok) return { test_name: 'Uptime Kuma (Oracle Phoenix)', test_category: 'infra', status: 'pass', message: `HTTP ${res.status} in ${ms}ms`, duration_ms: ms };
          return { test_name: 'Uptime Kuma (Oracle Phoenix)', test_category: 'infra', status: 'fail', message: `HTTP ${res.status}`, duration_ms: ms };
        } catch (e) {
          return { test_name: 'Uptime Kuma (Oracle Phoenix)', test_category: 'infra', status: 'fail', message: `Unreachable: ${e.message}`, duration_ms: Date.now() - start };
        }
      },
    },
    {
      name: 'Montreal Provision Script Running',
      category: 'infra',
      fn: async () => {
        // Check if the Montreal instance has been provisioned (flag row in DB)
        // or if the provision script logged activity recently.
        // Since the script runs locally, we check for a heartbeat row
        // that the script (or a wrapper) could insert. For now, check if
        // the Montreal Oracle instance exists via a config check.
        const start = Date.now();
        try {
          // Check the nightly_test_runs table for a recent heartbeat from the provision script
          // The provision script should POST a heartbeat to this function periodically
          const { data: heartbeat } = await supabase
            .from('nightly_test_runs')
            .select('created_at')
            .eq('test_name', 'montreal-provision-heartbeat')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          const ms = Date.now() - start;
          if (heartbeat) {
            const age = Date.now() - new Date(heartbeat.created_at).getTime();
            const ageHrs = Math.round(age / 3600000 * 10) / 10;
            if (age < 86400000) { // 24 hours
              return { test_name: 'Montreal Provision Script Running', test_category: 'infra', status: 'pass', message: `Heartbeat ${ageHrs}h ago`, duration_ms: ms };
            }
            return { test_name: 'Montreal Provision Script Running', test_category: 'infra', status: 'warn', message: `Last heartbeat ${ageHrs}h ago (stale)`, duration_ms: ms };
          }
          return { test_name: 'Montreal Provision Script Running', test_category: 'infra', status: 'warn', message: 'No heartbeat found — script may not be reporting', duration_ms: ms, details: { hint: 'Add heartbeat POST to oracle-montreal-provision.sh' } };
        } catch (e) {
          return { test_name: 'Montreal Provision Script Running', test_category: 'infra', status: 'fail', message: e.message, duration_ms: Date.now() - start };
        }
      },
    },
    {
      name: 'Resend Email Forwarding',
      category: 'email',
      fn: async () => {
        const start = Date.now();
        try {
          // Check inbound_emails table for recent activity (last 48h)
          const cutoff = new Date(Date.now() - 48 * 3600000).toISOString();
          const { data: recentEmails, error } = await supabase
            .from('inbound_emails')
            .select('id, created_at, from_address, to_address, route_action')
            .gte('created_at', cutoff)
            .order('created_at', { ascending: false })
            .limit(5);

          const ms = Date.now() - start;
          if (error) return { test_name: 'Resend Email Forwarding', test_category: 'email', status: 'fail', message: `DB error: ${error.message}`, duration_ms: ms };

          if (recentEmails?.length) {
            const latest = recentEmails[0];
            const forwarded = recentEmails.filter(e => e.route_action === 'forward').length;
            return {
              test_name: 'Resend Email Forwarding',
              test_category: 'email',
              status: 'pass',
              message: `${recentEmails.length} emails in 48h (${forwarded} forwarded)`,
              duration_ms: ms,
              details: { latest_from: latest.from_address, latest_to: latest.to_address, latest_at: latest.created_at },
            };
          }
          // No emails in 48h — warn (might just be low traffic)
          return { test_name: 'Resend Email Forwarding', test_category: 'email', status: 'warn', message: 'No inbound emails in 48h — may be normal or broken', duration_ms: ms };
        } catch (e) {
          return { test_name: 'Resend Email Forwarding', test_category: 'email', status: 'fail', message: e.message, duration_ms: Date.now() - start };
        }
      },
    },
    {
      name: 'Resend Outbound Email',
      category: 'email',
      fn: async () => {
        const start = Date.now();
        if (!RESEND_API_KEY) {
          return { test_name: 'Resend Outbound Email', test_category: 'email', status: 'skip', message: 'RESEND_API_KEY not set', duration_ms: 0 };
        }
        try {
          // Just check the API key is valid by listing recent emails (limit 1)
          const res = await fetch('https://api.resend.com/emails?limit=1', {
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` },
          });
          const ms = Date.now() - start;
          if (res.ok) return { test_name: 'Resend Outbound Email', test_category: 'email', status: 'pass', message: `API key valid (${ms}ms)`, duration_ms: ms };
          const body = await res.text();
          return { test_name: 'Resend Outbound Email', test_category: 'email', status: 'fail', message: `HTTP ${res.status}: ${body.slice(0, 100)}`, duration_ms: ms };
        } catch (e) {
          return { test_name: 'Resend Outbound Email', test_category: 'email', status: 'fail', message: e.message, duration_ms: Date.now() - start };
        }
      },
    },
    {
      name: 'Tesla Poller Active',
      category: 'devices',
      fn: async () => {
        const start = Date.now();
        try {
          const { data: vehicles, error } = await supabase
            .from('vehicles')
            .select('name, last_synced_at')
            .eq('is_active', true)
            .not('last_synced_at', 'is', null)
            .order('last_synced_at', { ascending: false })
            .limit(1);

          const ms = Date.now() - start;
          if (error) return { test_name: 'Tesla Poller Active', test_category: 'devices', status: 'fail', message: error.message, duration_ms: ms };

          if (vehicles?.length) {
            const v = vehicles[0];
            const age = Date.now() - new Date(v.last_synced_at).getTime();
            const ageMins = Math.round(age / 60000);
            if (age < 3600000) { // 1 hour
              return { test_name: 'Tesla Poller Active', test_category: 'devices', status: 'pass', message: `${v.name} synced ${ageMins}m ago`, duration_ms: ms };
            }
            return { test_name: 'Tesla Poller Active', test_category: 'devices', status: 'warn', message: `${v.name} last sync ${ageMins}m ago`, duration_ms: ms, details: { vehicle: v.name, last_synced: v.last_synced_at } };
          }
          return { test_name: 'Tesla Poller Active', test_category: 'devices', status: 'warn', message: 'No active vehicles with sync data', duration_ms: ms };
        } catch (e) {
          return { test_name: 'Tesla Poller Active', test_category: 'devices', status: 'fail', message: e.message, duration_ms: Date.now() - start };
        }
      },
    },
    {
      name: 'Edge Functions Healthy',
      category: 'infra',
      fn: async () => {
        const start = Date.now();
        // Ping the API edge function with a simple health check
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/api`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ resource: 'spaces', action: 'list', limit: 1 }),
          });
          const ms = Date.now() - start;
          if (res.ok) return { test_name: 'Edge Functions Healthy', test_category: 'infra', status: 'pass', message: `API edge function OK (${ms}ms)`, duration_ms: ms };
          return { test_name: 'Edge Functions Healthy', test_category: 'infra', status: 'fail', message: `HTTP ${res.status}`, duration_ms: ms };
        } catch (e) {
          return { test_name: 'Edge Functions Healthy', test_category: 'infra', status: 'fail', message: e.message, duration_ms: Date.now() - start };
        }
      },
    },
    {
      name: 'Error Digest (24h)',
      category: 'app',
      fn: async () => {
        const start = Date.now();
        try {
          const cutoff = new Date(Date.now() - 24 * 3600000).toISOString();
          const { count, error } = await supabase
            .from('error_logs')
            .select('id', { count: 'exact', head: true })
            .gte('created_at', cutoff);

          const ms = Date.now() - start;
          if (error) return { test_name: 'Error Digest (24h)', test_category: 'app', status: 'fail', message: error.message, duration_ms: ms };

          if ((count || 0) === 0) return { test_name: 'Error Digest (24h)', test_category: 'app', status: 'pass', message: 'No errors in 24h', duration_ms: ms };
          if ((count || 0) <= 5) return { test_name: 'Error Digest (24h)', test_category: 'app', status: 'pass', message: `${count} errors in 24h (low)`, duration_ms: ms };
          if ((count || 0) <= 20) return { test_name: 'Error Digest (24h)', test_category: 'app', status: 'warn', message: `${count} errors in 24h`, duration_ms: ms };
          return { test_name: 'Error Digest (24h)', test_category: 'app', status: 'fail', message: `${count} errors in 24h (high!)`, duration_ms: ms, details: { count } };
        } catch (e) {
          return { test_name: 'Error Digest (24h)', test_category: 'app', status: 'fail', message: e.message, duration_ms: Date.now() - start };
        }
      },
    },
    {
      name: 'PAI Chat Functional',
      category: 'ai',
      fn: async () => {
        const start = Date.now();
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/alpaca-pai`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: 'ping', conversation_id: 'nightly-test' }),
          });
          const ms = Date.now() - start;
          if (res.ok) return { test_name: 'PAI Chat Functional', test_category: 'ai', status: 'pass', message: `PAI responded (${ms}ms)`, duration_ms: ms };
          return { test_name: 'PAI Chat Functional', test_category: 'ai', status: 'fail', message: `HTTP ${res.status}`, duration_ms: ms };
        } catch (e) {
          return { test_name: 'PAI Chat Functional', test_category: 'ai', status: 'fail', message: e.message, duration_ms: Date.now() - start };
        }
      },
    },
    {
      name: 'SSL Certificate Valid',
      category: 'infra',
      fn: async () => {
        const start = Date.now();
        try {
          // Verify HTTPS works and doesn't error
          const res = await fetch('https://alpacaplayhouse.com/version.json', { signal: AbortSignal.timeout(10000) });
          const ms = Date.now() - start;
          if (res.ok) {
            const version = await res.json();
            return { test_name: 'SSL Certificate Valid', test_category: 'infra', status: 'pass', message: `HTTPS OK, version ${version.version || 'unknown'}`, duration_ms: ms, details: version };
          }
          return { test_name: 'SSL Certificate Valid', test_category: 'infra', status: 'fail', message: `HTTP ${res.status}`, duration_ms: ms };
        } catch (e) {
          return { test_name: 'SSL Certificate Valid', test_category: 'infra', status: 'fail', message: `SSL/fetch error: ${e.message}`, duration_ms: Date.now() - start };
        }
      },
    },
  ];

  // ─── Run Tests ─────────────────────────────────────────────────────

  const testsToRun = requestedTests
    ? allTests.filter(t => requestedTests!.includes(t.name))
    : allTests;

  // Run all tests concurrently
  const testPromises = testsToRun.map(async (test) => {
    try {
      return await test.fn();
    } catch (e) {
      return {
        test_name: test.name,
        test_category: test.category,
        status: 'fail' as const,
        message: `Uncaught: ${e.message}`,
        duration_ms: 0,
      };
    }
  });

  const testResults = await Promise.all(testPromises);
  results.push(...testResults);

  // ─── Store Results ─────────────────────────────────────────────────

  const rows = results.map(r => ({
    run_id: runId,
    test_name: r.test_name,
    test_category: r.test_category,
    status: r.status,
    message: r.message,
    details: r.details || null,
    duration_ms: r.duration_ms,
  }));

  const { error: insertErr } = await supabase.from('nightly_test_runs').insert(rows);
  if (insertErr) console.error('Failed to store test results:', insertErr);

  // ─── Summary ───────────────────────────────────────────────────────

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warned = results.filter(r => r.status === 'warn').length;
  const skipped = results.filter(r => r.status === 'skip').length;

  // Send email summary if any failures
  if (failed > 0 && RESEND_API_KEY) {
    const failedTests = results.filter(r => r.status === 'fail');
    const warnTests = results.filter(r => r.status === 'warn');

    const failRows = failedTests.map(t =>
      `<tr><td style="padding:6px 12px;border-bottom:1px solid #e6e2d9;color:#c53030;font-weight:600">FAIL</td><td style="padding:6px 12px;border-bottom:1px solid #e6e2d9">${t.test_name}</td><td style="padding:6px 12px;border-bottom:1px solid #e6e2d9">${t.message}</td></tr>`
    ).join('');

    const warnRows = warnTests.map(t =>
      `<tr><td style="padding:6px 12px;border-bottom:1px solid #e6e2d9;color:#d69e2e;font-weight:600">WARN</td><td style="padding:6px 12px;border-bottom:1px solid #e6e2d9">${t.test_name}</td><td style="padding:6px 12px;border-bottom:1px solid #e6e2d9">${t.message}</td></tr>`
    ).join('');

    const html = `
      <h2 style="margin:0 0 16px">Nightly Test Report</h2>
      <p><strong>${passed}</strong> passed, <strong style="color:#c53030">${failed}</strong> failed, <strong style="color:#d69e2e">${warned}</strong> warnings</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead><tr style="background:#f6f5f0"><th style="padding:8px 12px;text-align:left">Status</th><th style="padding:8px 12px;text-align:left">Test</th><th style="padding:8px 12px;text-align:left">Message</th></tr></thead>
        <tbody>${failRows}${warnRows}</tbody>
      </table>
      <p style="margin-top:16px"><a href="${absoluteUrl(ROUTES.admin.testSuite)}">View full results</a></p>
    `;

    const sender = SENDER_MAP['system'] || { from: 'Alpaca Automaton <auto@alpacaplayhouse.com>', reply_to: '' };
    const wrappedHtml = await wrapEmailHtml(html, supabase);

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: sender.from,
        to: ['alpacaautomatic@gmail.com'],
        subject: `Nightly Tests: ${failed} failed, ${warned} warnings`,
        html: wrappedHtml,
      }),
    }).catch(e => console.error('Failed to send test report email:', e));
  }

  const response = {
    run_id: runId,
    total: results.length,
    passed,
    failed,
    warned,
    skipped,
    results,
  };

  return new Response(JSON.stringify(response), {
    headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' },
  });
});
