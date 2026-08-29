/**
 * Stripe Balance Monitor Edge Function
 *
 * Triggered by pg_cron daily at 5:00 PM Central (22:00 UTC).
 * 1. Fetches the platform Stripe balance via /v1/balance
 * 2. Loads the most recent row from stripe_balance_snapshots
 * 3. If available/pending/instant_available changed → inserts a new row
 *    flagged changed=true and emails alpacaplayhouse@gmail.com with the
 *    old vs new figures.
 * 4. If unchanged → inserts a row flagged changed=false (audit trail).
 *
 * Deploy: supabase functions deploy stripe-balance-monitor --no-verify-jwt
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { SENDER_MAP } from "../_shared/template-engine.ts";

const ADMIN_EMAIL = "alpacaplayhouse@gmail.com";

interface StripeBalanceBucket {
  amount: number;
  currency: string;
}

interface StripeBalance {
  available: StripeBalanceBucket[];
  pending: StripeBalanceBucket[];
  instant_available?: StripeBalanceBucket[];
}

function sumUsd(buckets: StripeBalanceBucket[] | undefined): number {
  if (!buckets) return 0;
  return buckets.filter((b) => b.currency === "usd").reduce((s, b) => s + b.amount, 0);
}

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function delta(prev: number | null, next: number): string {
  if (prev === null) return "—";
  const d = next - prev;
  if (d === 0) return "no change";
  const sign = d > 0 ? "+" : "−";
  return `${sign}${fmt(Math.abs(d))}`;
}

serve(async (_req) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Load Stripe secret from stripe_config (same pattern as stripe-payout)
    const { data: cfg, error: cfgErr } = await sb
      .from("stripe_config")
      .select("secret_key, sandbox_secret_key, is_active, test_mode")
      .eq("is_active", true)
      .single();

    if (cfgErr || !cfg) {
      throw new Error(`stripe_config load failed: ${cfgErr?.message ?? "no active row"}`);
    }
    const stripeKey = cfg.test_mode ? cfg.sandbox_secret_key : cfg.secret_key;
    if (!stripeKey) throw new Error("No Stripe secret key in stripe_config");

    // 2. Fetch current balance from Stripe
    const balRes = await fetch("https://api.stripe.com/v1/balance", {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    if (!balRes.ok) {
      const body = await balRes.text();
      throw new Error(`Stripe /v1/balance ${balRes.status}: ${body.slice(0, 300)}`);
    }
    const bal = (await balRes.json()) as StripeBalance;
    const available = sumUsd(bal.available);
    const pending = sumUsd(bal.pending);
    const instant = sumUsd(bal.instant_available);

    // 3. Read most recent prior snapshot
    const { data: prevRows, error: prevErr } = await sb
      .from("stripe_balance_snapshots")
      .select("available_cents, pending_cents, instant_available_cents")
      .order("checked_at", { ascending: false })
      .limit(1);

    if (prevErr) throw new Error(`prev snapshot load: ${prevErr.message}`);

    const prev = prevRows && prevRows.length > 0 ? prevRows[0] : null;
    const prevAvail = prev ? Number(prev.available_cents) : null;
    const prevPending = prev ? Number(prev.pending_cents) : null;
    const prevInstant = prev ? Number(prev.instant_available_cents) : null;

    const changed =
      prev === null ||
      prevAvail !== available ||
      prevPending !== pending ||
      prevInstant !== instant;

    let notified = false;
    let emailStatus: string | null = null;

    // 4. On change, send email via send-email type=custom
    if (changed) {
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1618;max-width:560px;">
          <h2 style="margin:0 0 16px;font-size:20px;">Stripe balance changed</h2>
          <p style="margin:0 0 16px;color:#555;">Daily check at 5:00 PM Central detected a change in the platform balance.</p>
          <table style="border-collapse:collapse;width:100%;margin:0 0 20px;">
            <thead>
              <tr style="background:#f5f1ec;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">
                <th style="text-align:left;padding:10px 12px;">Bucket</th>
                <th style="text-align:right;padding:10px 12px;">Old</th>
                <th style="text-align:right;padding:10px 12px;">New</th>
                <th style="text-align:right;padding:10px 12px;">Δ</th>
              </tr>
            </thead>
            <tbody style="font-size:14px;">
              <tr>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;">Available</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">${prevAvail === null ? "—" : fmt(prevAvail)}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">${fmt(available)}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;color:${prevAvail !== null && available - prevAvail < 0 ? "#b5340c" : "#1f7a3a"};">${delta(prevAvail, available)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;">Pending</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">${prevPending === null ? "—" : fmt(prevPending)}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">${fmt(pending)}</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;color:${prevPending !== null && pending - prevPending < 0 ? "#b5340c" : "#1f7a3a"};">${delta(prevPending, pending)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;font-weight:600;">Instant available</td>
                <td style="padding:10px 12px;text-align:right;">${prevInstant === null ? "—" : fmt(prevInstant)}</td>
                <td style="padding:10px 12px;text-align:right;">${fmt(instant)}</td>
                <td style="padding:10px 12px;text-align:right;color:${prevInstant !== null && instant - prevInstant < 0 ? "#b5340c" : "#1f7a3a"};">${delta(prevInstant, instant)}</td>
              </tr>
            </tbody>
          </table>
          <p style="margin:0 0 4px;color:#777;font-size:12px;">
            <a href="https://dashboard.stripe.com/balance" style="color:#1c1618;">Open Stripe Dashboard → Balance</a>
          </p>
          <p style="margin:0;color:#aaa;font-size:11px;">Source: stripe-balance-monitor edge function</p>
        </div>
      `;

      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) {
        emailStatus = "error: RESEND_API_KEY not configured";
        console.error(emailStatus);
      } else {
        const sender = SENDER_MAP.pai;
        const text = `Stripe balance changed.\n` +
          `Available: ${prevAvail === null ? "—" : fmt(prevAvail)} → ${fmt(available)} (${delta(prevAvail, available)})\n` +
          `Pending:   ${prevPending === null ? "—" : fmt(prevPending)} → ${fmt(pending)} (${delta(prevPending, pending)})\n` +
          `Instant:   ${prevInstant === null ? "—" : fmt(prevInstant)} → ${fmt(instant)} (${delta(prevInstant, instant)})\n\n` +
          `https://dashboard.stripe.com/balance`;

        const sendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: sender.from,
            reply_to: sender.reply_to,
            to: ADMIN_EMAIL,
            subject: `Stripe balance changed — available now ${fmt(available)}`,
            html,
            text,
          }),
        });

        const sendText = await sendRes.text();
        if (sendRes.ok) {
          notified = true;
          emailStatus = `sent (${sendRes.status})`;
        } else {
          emailStatus = `error ${sendRes.status}: ${sendText.slice(0, 200)}`;
          console.error("Resend failed:", emailStatus);
        }
      }
    }

    // 5. Always insert a snapshot row for the audit trail
    const { error: insErr } = await sb.from("stripe_balance_snapshots").insert({
      available_cents: available,
      pending_cents: pending,
      instant_available_cents: instant,
      changed,
      notified,
      prev_available_cents: prevAvail,
      prev_pending_cents: prevPending,
      prev_instant_available_cents: prevInstant,
    });

    if (insErr) throw new Error(`snapshot insert: ${insErr.message}`);

    return new Response(
      JSON.stringify({
        success: true,
        changed,
        notified,
        email_status: emailStatus,
        available_cents: available,
        pending_cents: pending,
        instant_available_cents: instant,
        prev_available_cents: prevAvail,
        prev_pending_cents: prevPending,
        prev_instant_available_cents: prevInstant,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("stripe-balance-monitor error:", err);
    return new Response(
      JSON.stringify({ success: false, error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
