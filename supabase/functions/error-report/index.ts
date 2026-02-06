/**
 * Error Report Edge Function
 *
 * Receives client-side error reports and:
 * 1. Stores them in the database for analysis
 * 2. Sends a daily digest email when triggered
 *
 * Deploy with: supabase functions deploy error-report
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Email configuration
const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') || 'alpacaautomatic@gmail.com';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const FROM_EMAIL = 'Alpaca Automaton Errors <auto@alpacaplayhouse.com>';

interface ErrorEntry {
  id: string;
  category: string;
  code: string;
  message: string;
  details: Record<string, unknown>;
  severity: 'critical' | 'error' | 'warning' | 'info';
  environment: {
    userAgent: string;
    url: string;
    timestamp: string;
    sessionId: string;
    [key: string]: unknown;
  };
  user: Record<string, unknown>;
  stack?: string;
}

interface ErrorReport {
  errors: ErrorEntry[];
  summary: {
    count: number;
    categories?: string[];
    severities?: Record<string, number>;
    isUnloadFlush?: boolean;
  };
}

interface DigestRequest {
  action: 'send_digest';
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();

    // Check if this is a digest request
    if (body.action === 'send_digest') {
      return await handleDigestRequest();
    }

    // Otherwise handle as error report
    return await handleErrorReport(body as ErrorReport);
  } catch (err) {
    console.error('Error processing request:', err);
    return new Response(
      JSON.stringify({ success: false, error: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

async function handleErrorReport(report: ErrorReport) {
  const { errors, summary } = report;

  if (!errors || errors.length === 0) {
    return new Response(
      JSON.stringify({ success: true, message: 'No errors to process' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  console.log(`Processing ${errors.length} errors`);

  // Initialize Supabase client
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Store errors in database
  const errorRecords = errors.map((e) => ({
    error_id: e.id,
    category: e.category,
    code: e.code,
    message: e.message,
    severity: e.severity,
    details: e.details,
    environment: e.environment,
    user_context: e.user,
    stack_trace: e.stack,
    session_id: e.environment?.sessionId,
    page_url: e.environment?.url,
    user_agent: e.environment?.userAgent,
    created_at: e.environment?.timestamp || new Date().toISOString(),
  }));

  const { error: insertError } = await supabase
    .from('error_logs')
    .insert(errorRecords);

  if (insertError) {
    console.error('Failed to store errors:', insertError);
  } else {
    console.log(`Stored ${errors.length} errors in database`);
  }

  return new Response(
    JSON.stringify({
      success: true,
      stored: errors.length,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

async function handleDigestRequest() {
  console.log('Processing daily digest request');

  // Initialize Supabase client
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check when we last sent a digest
  const { data: lastDigest } = await supabase
    .from('error_digest_log')
    .select('sent_at')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single();

  const lastSentAt = lastDigest?.sent_at ? new Date(lastDigest.sent_at) : null;
  const now = new Date();

  // Only send once per day (24 hours)
  if (lastSentAt && (now.getTime() - lastSentAt.getTime()) < 24 * 60 * 60 * 1000) {
    console.log('Digest already sent within last 24 hours, skipping');
    return new Response(
      JSON.stringify({ success: true, skipped: true, reason: 'Already sent today' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Get errors since last digest (or last 24 hours if no previous digest)
  const sinceDate = lastSentAt || new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const { data: errors, error: fetchError } = await supabase
    .from('error_logs')
    .select('*')
    .gte('created_at', sinceDate.toISOString())
    .order('created_at', { ascending: false });

  if (fetchError) {
    console.error('Failed to fetch errors:', fetchError);
    return new Response(
      JSON.stringify({ success: false, error: 'Failed to fetch errors' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  if (!errors || errors.length === 0) {
    console.log('No errors to report');

    // Still log that we checked
    await supabase.from('error_digest_log').insert({
      sent_at: now.toISOString(),
      error_count: 0,
      email_sent: false,
    });

    return new Response(
      JSON.stringify({ success: true, errorCount: 0, emailSent: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Group errors by category and code
  const grouped = errors.reduce((acc, e) => {
    const key = `${e.category}:${e.code}`;
    if (!acc[key]) {
      acc[key] = { count: 0, message: e.message, severity: e.severity, examples: [] };
    }
    acc[key].count++;
    if (acc[key].examples.length < 3) {
      acc[key].examples.push({
        url: e.page_url,
        timestamp: e.created_at,
        details: e.details,
      });
    }
    return acc;
  }, {} as Record<string, { count: number; message: string; severity: string; examples: any[] }>);

  // Count by severity
  const severityCounts = errors.reduce((acc, e) => {
    acc[e.severity] = (acc[e.severity] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Build email content
  const errorList = Object.entries(grouped)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([key, val]) => {
      const exampleList = val.examples
        .map(ex => `    - ${ex.url} (${new Date(ex.timestamp).toLocaleString()})`)
        .join('\n');
      return `[${val.severity.toUpperCase()}] ${key}: ${val.message}
  Count: ${val.count}
  Examples:
${exampleList}`;
    })
    .join('\n\n');

  const emailBody = `
GenAlpaca Daily Error Digest
============================
Period: ${sinceDate.toLocaleString()} to ${now.toLocaleString()}
Total Errors: ${errors.length}

Severity Breakdown:
- Critical: ${severityCounts.critical || 0}
- Error: ${severityCounts.error || 0}
- Warning: ${severityCounts.warning || 0}
- Info: ${severityCounts.info || 0}

Error Details:
--------------
${errorList}

---
View the error_logs table in Supabase for full details.
  `.trim();

  let emailSent = false;

  if (RESEND_API_KEY) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: ADMIN_EMAIL,
          subject: `[GenAlpaca] Daily Error Digest: ${errors.length} error(s)`,
          text: emailBody,
        }),
      });

      if (response.ok) {
        emailSent = true;
        console.log('Digest email sent successfully');
      } else {
        const errorText = await response.text();
        console.error('Failed to send email:', errorText);
      }
    } catch (err) {
      console.error('Email send error:', err);
    }
  } else {
    console.log('RESEND_API_KEY not configured, skipping email');
  }

  // Log that we sent (or attempted to send) digest
  await supabase.from('error_digest_log').insert({
    sent_at: now.toISOString(),
    error_count: errors.length,
    email_sent: emailSent,
  });

  return new Response(
    JSON.stringify({
      success: true,
      errorCount: errors.length,
      emailSent,
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
