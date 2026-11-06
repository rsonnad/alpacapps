/**
 * Stripe Payout Confirm
 *
 * Marks Stripe Connect payouts paid once the worker's bank payout arrives.
 * stripe-payout saves rows as "processing"; Stripe never sends the
 * `transfer.paid` event the webhook waited for, so this runs on a schedule.
 *
 * POST                 → check and write (completed / returned)
 * POST ?dry=true       → check only; returns every decision
 * Caller: service-role key (pg_cron) or an admin/oracle user.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { requireFunctionRoles } from "../_shared/require-auth.ts";
import {
  applyConfirmations,
  checkProcessingStripePayouts,
} from "../_shared/stripe-payout-confirm.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function handler(req: Request) {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const auth = await requireFunctionRoles(req, sb, ["admin", "oracle"]);
  if (auth.response) return auth.response;
  const dry = new URL(req.url).searchParams.get("dry") === "true";
  try {
    const { data: cfg, error } = await sb.from("stripe_config")
      .select("secret_key, sandbox_secret_key, test_mode")
      .eq("is_active", true).single();
    if (error || !cfg) throw new Error(`stripe_config: ${error?.message ?? "no active row"}`);
    const key = cfg.test_mode ? cfg.sandbox_secret_key : cfg.secret_key;
    if (!key) throw new Error("No Stripe secret key in stripe_config");
    const decisions = await checkProcessingStripePayouts(sb, key, Boolean(cfg.test_mode));
    const counts = decisions.reduce<Record<string, number>>((c, d) => {
      c[d.decision] = (c[d.decision] ?? 0) + 1;
      return c;
    }, {});
    const written = dry ? null : await applyConfirmations(sb, decisions);
    console.log("stripe-payout-confirm", { dry, counts, written });
    return json({ success: true, dry, counts, written, decisions });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("stripe-payout-confirm error:", message);
    return json({ success: false, error: message }, 500);
  }
}

if (import.meta.main) serve(handler);
