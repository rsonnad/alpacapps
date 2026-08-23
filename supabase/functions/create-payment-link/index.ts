import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

import { getCorsHeaders } from "../_shared/api-helpers.ts";
import { requireFunctionRoles } from "../_shared/require-auth.ts";
const STRIPE_API_BASE = "https://api.stripe.com/v1";

interface PaymentLinkRequest {
  amount: number;          // Amount in dollars (e.g., 299.00)
  description: string;     // e.g., "Weekly Rent - Feb 2, 2026"
  person_id?: string;      // Optional: link to person
  person_name?: string;    // Optional: prefill name
  person_email?: string;   // Optional: prefill email
  category?: string;       // Ledger category (rent, security_deposit, etc.)
  assignment_id?: string;  // Optional: link to assignment
  metadata?: Record<string, string>; // Optional extra metadata
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const auth = await requireFunctionRoles(req, supabase, ["admin", "oracle", "staff"]);
    if (auth.response) return auth.response;
    const appUser = auth.caller?.appUser;

    const body: PaymentLinkRequest = await req.json();
    const { amount, description, person_id, person_name, person_email, category, assignment_id, metadata } = body;

    if (!Number.isFinite(amount) || amount < 0.50 || amount > 100_000 || !description || description.length > 500) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: amount, description" }),
        { status: 400, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    // Get Stripe secret key from DB
    const { data: stripeConfig } = await supabase
      .from("stripe_config")
      .select("secret_key, sandbox_secret_key, is_active, test_mode")
      .eq("id", 1)
      .single();

    const activeConfig = stripeConfig;
    const activeStripeKey = activeConfig?.test_mode ? activeConfig?.sandbox_secret_key : activeConfig?.secret_key;
    if (!activeConfig || !activeStripeKey || !activeConfig.is_active) {
      return new Response(
        JSON.stringify({ error: "Stripe is not configured or inactive" }),
        { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    // Build Stripe Payment Link request
    const amountCents = Math.round(amount * 100);

    const params = new URLSearchParams();
    params.append("line_items[0][price_data][currency]", "usd");
    params.append("line_items[0][price_data][unit_amount]", amountCents.toString());
    params.append("line_items[0][price_data][product_data][name]", description);
    params.append("line_items[0][quantity]", "1");

    // ACH only — low fees (0.8% capped at $5) vs card (2.9% + $0.30)
    params.append("payment_method_types[0]", "us_bank_account");

    // Add metadata for tracking. Stripe stores this on BOTH the Payment Link AND on
    // each PaymentIntent it creates (via payment_intent_data[metadata]). The webhook
    // fires on payment_intent.* events and reads the PI's metadata to link the
    // charge back to a person/assignment in our DB. Without payment_intent_data
    // mirroring, the PI arrives with metadata={} and the webhook can't tie it back.
    const mirrorMeta = (key: string, value: string) => {
      params.append(`metadata[${key}]`, value);
      params.append(`payment_intent_data[metadata][${key}]`, value);
    };
    if (person_id) mirrorMeta("person_id", person_id);
    if (person_name) mirrorMeta("person_name", person_name);
    if (category) mirrorMeta("payment_type", category);
    if (assignment_id) {
      mirrorMeta("assignment_id", assignment_id);
      mirrorMeta("reference_type", "assignment");
      mirrorMeta("reference_id", assignment_id);
    }
    if (metadata) {
      for (const [k, v] of Object.entries(metadata)) {
        mirrorMeta(k, v);
      }
    }

    // After payment, redirect to the public pay success screen.
    // Payment links are often sent to past residents or guests who do not have
    // an active resident portal session.
    params.append("after_completion[type]", "redirect");
    params.append("after_completion[redirect][url]", "https://alpacaplayhouse.com/pay/?success=true");

    // Create Payment Link via Stripe API
    const stripeResponse = await fetch(`${STRIPE_API_BASE}/payment_links`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${activeStripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const stripeResult = await stripeResponse.json();

    if (!stripeResponse.ok) {
      console.error("Stripe API error:", stripeResult);
      return new Response(
        JSON.stringify({ error: "Failed to create payment link", details: stripeResult.error?.message }),
        { status: stripeResponse.status, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
      );
    }

    // Log to api_usage_log (fire-and-forget)
    supabase.from("api_usage_log").insert({
      vendor: "stripe",
      category: "payment_link_creation",
      endpoint: "POST /v1/payment_links",
      units: 1,
      unit_type: "api_calls",
      estimated_cost_usd: 0, // No cost to create links, only on payment
      metadata: {
        payment_link_id: stripeResult.id,
        amount,
        description,
        person_name,
        url: stripeResult.url,
      },
          app_user_id: auth.caller?.authUserId || null,
    }).then(() => {});

    console.log("Payment link created:", { id: stripeResult.id, url: stripeResult.url, amount });

    return new Response(
      JSON.stringify({
        success: true,
        payment_link_id: stripeResult.id,
        url: stripeResult.url,
        amount,
        description,
      }),
      { status: 200, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...getCorsHeaders(req), "Content-Type": "application/json" } }
    );
  }
});
