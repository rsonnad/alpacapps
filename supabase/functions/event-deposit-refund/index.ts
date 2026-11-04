/**
 * Event Deposit Refund
 *
 * After the cleaning inspection, sends the host their cleaning deposit minus charges
 * (event_cleaning_charges: $35 missing-photo penalty + failed-clean charge) through Stripe Connect.
 *
 * Unlike stripe-payout this is not wages: no ID/W-9 gate, ledger category 'refund',
 * and payouts.event_request_id is set so 1099 reporting skips it.
 * One refund per event: event_hosting_requests.refund_payout_id is claimed before money moves.
 *
 * POST { event_request_id }   Auth: staff/admin/oracle.
 * Deploy: supabase functions deploy event-deposit-refund
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders } from "../_shared/api-helpers.ts";
import { requireFunctionRoles } from "../_shared/require-auth.ts";

class StripeApiError extends Error {}

function formEncode(obj: Record<string, string | number>): string {
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}

async function createStripeTransfer(secretKey: string, amountCents: number, destination: string,
  description: string, metadata: Record<string, string>, idempotencyKey: string): Promise<{ id: string }> {
  const res = await fetch("https://api.stripe.com/v1/transfers", {
    method: "POST",
    headers: { Authorization: `Bearer ${secretKey}`, "Idempotency-Key": idempotencyKey, "Content-Type": "application/x-www-form-urlencoded" },
    body: formEncode({
      amount: amountCents, currency: "usd", destination, description: description.slice(0, 500),
      ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => [`metadata[${k}]`, v])),
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try { message = JSON.parse(text)?.error?.message || text; } catch { /* keep text */ }
    throw res.status < 500 ? new StripeApiError(message) : new Error(`Stripe ${res.status}: ${message}`);
  }
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const auth = await requireFunctionRoles(req, sb, ["admin", "oracle", "staff"]);
  if (auth.response) return auth.response;

  try {
    const { event_request_id: requestId } = await req.json().catch(() => ({}));
    if (!/^[0-9a-f-]{36}$/i.test(String(requestId || ""))) return json({ error: "event_request_id required" }, 400);

    const { data: r }: { data: any } = await sb.from("event_hosting_requests")
      .select("id, event_name, inspection_status, refund_payout_id, associate_profile_id, is_test, person:person_id(first_name, last_name, email)")
      .eq("id", requestId).single();
    if (!r) return json({ error: "Event request not found" }, 404);
    if (r.inspection_status === "pending") return json({ error: "Inspect the cleaning first" }, 409);
    if (r.refund_payout_id) return json({ error: "This deposit was already refunded" }, 409);

    const { data: chargeRows, error: chErr } = await sb.rpc("event_cleaning_charges", { p_request_id: requestId });
    if (chErr || !chargeRows?.[0]) throw new Error(`Could not compute charges: ${chErr?.message}`);
    const c = chargeRows[0];
    const amount = Number(c.refund);
    const chargeNote = `Deposit $${c.deposit} − photo penalty $${c.photo_penalty} − cleaning $${c.cleaning_charge}`;

    const now = new Date().toISOString();
    if (amount <= 0) {
      await sb.from("event_hosting_requests").update({
        deposit_refunded_at: now, deposit_refund_amount: 0, deposit_refund_notes: `${chargeNote}. Nothing to refund.`, updated_at: now,
      }).eq("id", requestId);
      return json({ success: true, amount: 0, message: "Charges used the whole deposit; nothing to refund." });
    }

    const { data: assoc }: { data: any } = await sb.from("associate_profiles")
      .select("id, stripe_connect_account_id, app_user:app_user_id(display_name, first_name, last_name, person_id)")
      .eq("id", r.associate_profile_id).maybeSingle();
    if (!assoc?.stripe_connect_account_id) {
      return json({ error: "The host hasn't set up their payout yet. They can do it from the link in their cleaning email." }, 409);
    }

    const { data: config } = await sb.from("stripe_config").select("*").single();
    if (!config?.is_active || !config?.connect_enabled) return json({ error: "Stripe Connect is not enabled" }, 400);
    const isTest = !!config.test_mode || !!r.is_test;
    const secretKey = config.test_mode ? config.sandbox_secret_key : config.secret_key;
    if (!secretKey) return json({ error: "Missing Stripe secret key" }, 400);

    const personName = assoc.app_user?.display_name
      || `${r.person?.first_name || ""} ${r.person?.last_name || ""}`.trim() || "Event host";
    const notes = `Event deposit refund: ${r.event_name}. ${chargeNote}.`;

    const { data: payout, error: pErr } = await sb.from("payouts").insert({
      associate_id: assoc.id, person_id: assoc.app_user?.person_id || null, person_name: personName,
      amount, payment_method: "stripe", payment_handle: assoc.stripe_connect_account_id, status: "pending",
      notes: isTest ? `[TEST MODE] ${notes}` : notes, is_test: isTest, event_request_id: requestId,
    }).select().single();
    if (pErr || !payout) throw new Error(`Could not create payout record: ${pErr?.message}`);

    // Claim the event before money moves, so two clicks can't refund twice.
    const { data: claimed } = await sb.from("event_hosting_requests")
      .update({ refund_payout_id: payout.id, updated_at: now })
      .eq("id", requestId).is("refund_payout_id", null).select("id");
    if (!claimed?.length) {
      await sb.from("payouts").delete().eq("id", payout.id);
      return json({ error: "Another refund for this event just started" }, 409);
    }

    let transferId: string;
    if (isTest) {
      transferId = `TEST-tr_${Date.now()}`;
    } else {
      try {
        const t = await createStripeTransfer(secretKey, Math.round(amount * 100), assoc.stripe_connect_account_id,
          `Alpaca Playhouse deposit refund: ${r.event_name}`,
          { event_request_id: requestId, payout_id: payout.id, source: "event-deposit-refund" },
          `event-refund-${requestId}`);
        transferId = t.id;
      } catch (e) {
        if (e instanceof StripeApiError) {
          // Stripe refused, no money moved: release so staff can retry
          await sb.from("event_hosting_requests").update({ refund_payout_id: null }).eq("id", requestId);
          await sb.from("payouts").update({ status: "failed", error_message: (e as Error).message }).eq("id", payout.id);
          return json({ error: `Stripe refused the transfer: ${(e as Error).message}` }, 400);
        }
        await sb.from("payouts").update({
          status: "failed",
          error_message: `Outcome unknown — check Stripe for metadata.payout_id=${payout.id} before retrying: ${(e as Error).message}`,
        }).eq("id", payout.id);
        throw new Error("Stripe did not respond. Check the Stripe dashboard before retrying; the refund stays locked to this payout.");
      }
    }

    const { data: ledger } = await sb.from("ledger").insert({
      direction: "expense", category: "refund", amount, payment_method: "stripe",
      transaction_date: now.split("T")[0], person_id: assoc.app_user?.person_id || null, person_name: personName,
      status: isTest ? "completed" : "pending", description: `Event deposit refund to ${personName}`,
      notes: `${notes} Transfer ${transferId}.`, recorded_by: "system:event-deposit-refund", is_test: isTest,
    }).select("id").single();

    await sb.from("payouts").update({
      status: isTest ? "completed" : "processing", external_payout_id: transferId, ledger_id: ledger?.id ?? null,
    }).eq("id", payout.id);
    await sb.from("event_hosting_requests").update({
      deposit_refunded_at: now, deposit_refund_amount: amount, deposit_refund_notes: chargeNote, updated_at: now,
    }).eq("id", requestId);

    if (r.person?.email) {
      const lines = [`Cleaning deposit: $${c.deposit}`];
      if (Number(c.photo_penalty)) lines.push(`Missing before/after photos: −$${c.photo_penalty}`);
      if (Number(c.cleaning_charge)) lines.push(`Extra cleaning: −$${c.cleaning_charge}`);
      lines.push(`Refund: $${amount.toFixed(2)}`);
      await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          type: "event_notification", to: r.person.email,
          subject: `Your deposit refund for ${r.event_name}`,
          data: {
            subject: `Your deposit refund for ${r.event_name}`,
            _raw_html: `<p>Hi ${r.person.first_name || "there"},</p><p>Thanks for taking care of the house. Your refund is on its way to your bank through Stripe (usually 2 business days).</p><p>${lines.join("<br>")}</p>`,
            text: lines.join("\n"),
          },
        }),
      }).catch(() => {});
    }

    return json({ success: true, test_mode: isTest, amount, payout_id: payout.id, transfer_id: transferId });
  } catch (e) {
    console.error("event-deposit-refund error", e);
    return json({ error: (e as Error).message }, 500);
  }
});
