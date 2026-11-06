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
  const params = new URL(_req.url).searchParams;
  const preview = params.get("preview") === "true";
  // Admin preview only: report a chosen window, and optionally email it to the
  // admin inbox (no snapshot is written, so the daily schedule is unaffected).
  const sinceParam = preview ? params.get("since") : null;
  const untilParam = preview ? params.get("until") : null;
  const sendPreview = preview && params.get("send") === "true";
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
    const since = sinceParam || delivered?.[0]?.checked_at || prev?.checked_at ||
      new Date(Date.now() - 86400000).toISOString();
    const until = untilParam || new Date().toISOString();
    const report = await collectOutgoing(
      sb,
      stripeKey,
      since,
      until,
      Boolean(cfg.test_mode),
    );
    const details = renderOutgoing(report, since, until);
    let notified = false;
    let emailStatus: string | null = null;
    // Notify on balance changes or outgoing/pending activity, including unchanged net balance.
    if (
      changed || report.outgoing.length > 0 || report.pending.length > 0 ||
      preview
    ) {
      const changeLine = (label: string, prevV: number | null, v: number) =>
        prevV === null || prevV === v
          ? ""
          : `<span style="color:${v < prevV ? "#b5340c" : "#1f7a3a"};">${
            delta(prevV, v)
          }</span> ${label}`;
      const availChange = changeLine("since last report", prevAvail, available);
      const paidOutCents = report.outgoing.reduce((t, r) => t + r.cents, 0);
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1618;max-width:560px;">
          <p style="margin:0 0 4px;color:#7a7072;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Stripe balance</p>
          <p style="margin:0;font-size:32px;font-weight:700;line-height:1.2;">${
        fmt(available)
      } <span style="font-size:15px;font-weight:400;color:#7a7072;">available</span></p>
          <p style="margin:6px 0 0;font-size:14px;color:#7a7072;">${
        [
          availChange,
          pending ? `${fmt(pending)} incoming, not settled yet` : "",
        ].filter(Boolean).join(" · ")
      }</p>
          ${details.html}
          <p style="margin:28px 0 4px;color:#777;font-size:12px;">
            <a href="https://dashboard.stripe.com/balance" style="color:#1c1618;">Open Stripe balance</a>
          </p>
          <p style="margin:0;color:#aaa;font-size:11px;">Daily check, 5:00 PM Central · stripe-balance-monitor</p>
        </div>
      `;
      if (preview && !sendPreview) {
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
        const text = `Stripe balance: ${fmt(available)} available` +
          (prevAvail !== null && prevAvail !== available
            ? ` (${delta(prevAvail, available)} since last report)`
            : "") +
          (pending ? `\n${fmt(pending)} incoming, not settled yet` : "") +
          `\n\n` + details.text +
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
            subject: `Stripe: ${fmt(available)} available${
              paidOutCents ? ` · ${fmt(paidOutCents)} paid out` : ""
            }`,
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
    if (preview) {
      return new Response(JSON.stringify({ success: true, emailStatus }), {
        headers: { "Content-Type": "application/json" },
      });
    }
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
