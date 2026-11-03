import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { requireFunctionRoles } from "../_shared/require-auth.ts";
import { collectOutgoing, renderOutgoing } from "./outgoing.ts";
const SENDER_MAP = {
  pai: {
    from: "PAI at the Alpaca Playhouse <pai@alpacaplayhouse.com>",
    reply_to: "pai@alpacaplayhouse.com",
  },
};
const ADMIN_EMAIL = "alpacaplayhouse@gmail.com";
function sumUsd(buckets: { currency: string; amount: number }[] | undefined) {
  if (!buckets) return 0;
  return buckets.filter((b) => b.currency === "usd").reduce(
    (s, b) => s + b.amount,
    0,
  );
}
function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
function delta(prev: number | null, next: number) {
  if (prev === null) return "—";
  const d = next - prev;
  if (d === 0) return "no change";
  const sign = d > 0 ? "+" : "−";
  return `${sign}${fmt(Math.abs(d))}`;
}
export async function handler(_req: Request) {
  const preview = new URL(_req.url).searchParams.get("preview") === "true";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, supabaseKey);
  try {
    if (preview) {
      const auth = await requireFunctionRoles(_req, sb, ["admin", "oracle"]);
      if (auth.response) return auth.response;
    }
    // 1. Load Stripe secret from stripe_config (same pattern as stripe-payout)
    const { data: cfg, error: cfgErr } = await sb.from("stripe_config").select(
      "secret_key, sandbox_secret_key, is_active, test_mode",
    ).eq("is_active", true).single();
    if (cfgErr || !cfg) {
      throw new Error(
        `stripe_config load failed: ${cfgErr?.message ?? "no active row"}`,
      );
    }
    const stripeKey = cfg.test_mode ? cfg.sandbox_secret_key : cfg.secret_key;
    if (!stripeKey) throw new Error("No Stripe secret key in stripe_config");
    // 2. Fetch current balance from Stripe
    const balRes = await fetch("https://api.stripe.com/v1/balance", {
      headers: {
        Authorization: `Bearer ${stripeKey}`,
      },
    });
    if (!balRes.ok) {
      const body = await balRes.text();
      throw new Error(
        `Stripe /v1/balance ${balRes.status}: ${body.slice(0, 300)}`,
      );
    }
    const bal = await balRes.json();
    const available = sumUsd(bal.available);
    const pending = sumUsd(bal.pending);
    const instant = sumUsd(bal.instant_available);
    // 3. Read most recent prior snapshot
    const { data: prevRows, error: prevErr } = await sb.from(
      "stripe_balance_snapshots",
    ).select(
      "checked_at, available_cents, pending_cents, instant_available_cents",
    ).order("checked_at", {
      ascending: false,
    }).limit(1);
    if (prevErr) throw new Error(`prev snapshot load: ${prevErr.message}`);
    const prev = prevRows && prevRows.length > 0 ? prevRows[0] : null;
    const prevAvail = prev ? Number(prev.available_cents) : null;
    const prevPending = prev ? Number(prev.pending_cents) : null;
    const prevInstant = prev ? Number(prev.instant_available_cents) : null;
    const changed = prev === null || prevAvail !== available ||
      prevPending !== pending || prevInstant !== instant;
    // Cover activity since the last delivered report, so a failed email is retried.
    const { data: delivered, error: deliveredErr } = await sb.from(
      "stripe_balance_snapshots",
    )
      .select("checked_at").eq("notified", true).order("checked_at", {
        ascending: false,
      }).limit(1);
    if (deliveredErr) {
      throw new Error(`delivered snapshot load: ${deliveredErr.message}`);
    }
    const since = delivered?.[0]?.checked_at || prev?.checked_at ||
      new Date(Date.now() - 86400000).toISOString();
    const until = new Date().toISOString();
    const report = await collectOutgoing(
      sb,
      stripeKey,
      since,
      until,
      Boolean(cfg.test_mode),
    );
    const details = renderOutgoing(report, since, until);
    const title = changed
      ? "Stripe balance changed"
      : "Stripe outgoing payment update";
    let notified = false;
    let emailStatus: string | null = null;
    // Notify on balance changes or outgoing/pending activity, including unchanged net balance.
    if (
      changed || report.outgoing.length > 0 || report.pending.length > 0 ||
      preview
    ) {
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1618;max-width:560px;">
          <h2 style="margin:0 0 16px;font-size:20px;">${title}</h2>
          <p style="margin:0 0 16px;color:#555;">Daily Stripe balance and outgoing payment check (5:00 PM Central).</p>
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
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">${
        prevAvail === null ? "—" : fmt(prevAvail)
      }</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">${
        fmt(available)
      }</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;color:${
        prevAvail !== null && available - prevAvail < 0 ? "#b5340c" : "#1f7a3a"
      };">${delta(prevAvail, available)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:600;">Pending</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">${
        prevPending === null ? "—" : fmt(prevPending)
      }</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;">${
        fmt(pending)
      }</td>
                <td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;color:${
        prevPending !== null && pending - prevPending < 0
          ? "#b5340c"
          : "#1f7a3a"
      };">${delta(prevPending, pending)}</td>
              </tr>
              <tr>
                <td style="padding:10px 12px;font-weight:600;">Instant available</td>
                <td style="padding:10px 12px;text-align:right;">${
        prevInstant === null ? "—" : fmt(prevInstant)
      }</td>
                <td style="padding:10px 12px;text-align:right;">${
        fmt(instant)
      }</td>
                <td style="padding:10px 12px;text-align:right;color:${
        prevInstant !== null && instant - prevInstant < 0
          ? "#b5340c"
          : "#1f7a3a"
      };">${delta(prevInstant, instant)}</td>
              </tr>
            </tbody>
          </table>
          ${details.html}
          <p style="margin:0 0 4px;color:#777;font-size:12px;">
            <a href="https://dashboard.stripe.com/balance" style="color:#1c1618;">Open Stripe Dashboard → Balance</a>
          </p>
          <p style="margin:0;color:#aaa;font-size:11px;">Source: stripe-balance-monitor edge function</p>
        </div>
      `;
      if (preview) {
        return new Response(
          JSON.stringify({ html, text: details.text, report }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) {
        emailStatus = "error: RESEND_API_KEY not configured";
        console.error(emailStatus);
      } else {
        const sender = SENDER_MAP.pai;
        const text = `${title}.\n` +
          `Available: ${prevAvail === null ? "—" : fmt(prevAvail)} → ${
            fmt(available)
          } (${delta(prevAvail, available)})\n` +
          `Pending:   ${prevPending === null ? "—" : fmt(prevPending)} → ${
            fmt(pending)
          } (${delta(prevPending, pending)})\n` +
          `Instant:   ${prevInstant === null ? "—" : fmt(prevInstant)} → ${
            fmt(instant)
          } (${delta(prevInstant, instant)})\n\n` + details.text +
          `\nhttps://dashboard.stripe.com/balance`;
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
            subject: `${title} — available now ${fmt(available)}`,
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
    if (emailStatus?.startsWith("error")) throw new Error(emailStatus);
    // 5. Always insert a snapshot row for the audit trail
    const { error: insErr } = await sb.from("stripe_balance_snapshots").insert({
      checked_at: until,
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
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    console.error("stripe-balance-monitor error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }
}
if (import.meta.main) serve(handler);
