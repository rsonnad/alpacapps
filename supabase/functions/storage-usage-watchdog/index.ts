/**
 * Storage Usage Watchdog
 *
 * Runs weekly through pg_cron. Sends Rahul an email only when Supabase Storage
 * approaches the Free plan's 1 GB hard limit, so the app can be cleaned up
 * before Supabase restricts login and API traffic.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FREE_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;
const ALERT_THRESHOLD = 0.8;
const ALERT_EMAIL = "rahulioson@gmail.com";

function formatBytes(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

serve(async (request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !serviceRoleKey || !resendKey) {
    return new Response(JSON.stringify({ ok: false, error: "Required storage-watchdog secrets are missing" }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: objects, error } = await supabase
    .schema("storage")
    .from("objects")
    .select("bucket_id, metadata");
  if (error) {
    console.error("Unable to inspect storage usage:", error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  const byBucket: Record<string, number> = {};
  let totalBytes = 0;
  for (const object of objects || []) {
    const bytes = Number(object.metadata?.size || 0);
    totalBytes += bytes;
    byBucket[object.bucket_id] = (byBucket[object.bucket_id] || 0) + bytes;
  }

  const percentUsed = totalBytes / FREE_STORAGE_LIMIT_BYTES;
  const dryRun = new URL(request.url).searchParams.get("dry_run") === "1";
  const shouldAlert = percentUsed >= ALERT_THRESHOLD;
  if (shouldAlert && !dryRun) {
    const bucketRows = Object.entries(byBucket)
      .sort((a, b) => b[1] - a[1])
      .map(([bucket, bytes]) => `<li><strong>${bucket}</strong>: ${formatBytes(bytes)}</li>`)
      .join("");
    const email = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Alpaca Playhouse <noreply@alpacaplayhouse.com>",
        to: [ALERT_EMAIL],
        subject: `Storage alert: ${(percentUsed * 100).toFixed(1)}% of the Free limit used`,
        html: `<p>Supabase Storage is using <strong>${formatBytes(totalBytes)}</strong> of its 1 GB Free-plan limit (${(percentUsed * 100).toFixed(1)}%).</p><p>Clean up or move files before the service is restricted.</p><ul>${bucketRows}</ul>`,
      }),
    });
    if (!email.ok) {
      const body = await email.text();
      console.error("Storage alert email failed:", email.status, body);
      return new Response(JSON.stringify({ ok: false, error: `Email failed: ${email.status}` }), { status: 502 });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    total_bytes: totalBytes,
    percent_used: Number((percentUsed * 100).toFixed(2)),
    alert_threshold_percent: ALERT_THRESHOLD * 100,
    should_alert: shouldAlert,
    emailed: shouldAlert && !dryRun,
    buckets: byBucket,
  }), { headers: { "Content-Type": "application/json" } });
});
